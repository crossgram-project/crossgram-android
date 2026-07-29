import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyDirectDownload,
  patchChatMessageCell,
  patchFileLoadOperation,
} from "../features/direct-download/patch.js";
import { getUpstream } from "../src/upstreams.js";

const fixture = `package org.telegram.messenger;

import org.telegram.tgnet.ConnectionsManager;
import org.telegram.tgnet.TLObject;
import org.telegram.tgnet.TLRPC;

public class FileLoadOperation {
    protected boolean requestingReference;

    protected void startDownloadRequest(int useConnectionType) {
        if (paused || state != stateDownloading || requestingReference) {
            return;
        }
        int count = 1;
        for (int a = 0; a < count; a++) {
            final TLObject request;
            int connectionType = useConnectionType;
            if (isCdn) {
                request = cdnRequest;
            } else {
                if (webLocation != null) {
                    request = webRequest;
                } else {
                    TLRPC.TL_upload_getFile req = new TLRPC.TL_upload_getFile();
                    req.location = location;
                    req.offset = downloadOffset;
                    req.limit = currentDownloadChunkSize;
                    req.cdn_supported = true;
                    request = req;
                }
            }
            final RequestInfo requestInfo = new RequestInfo();
            requestInfo.offset = downloadOffset;
            requestInfo.chunkSize = currentDownloadChunkSize;
            final int requestToken = requestInfo.requestToken = ConnectionsManager.getInstance(currentAccount).sendRequestSync(request, callback);
        }
    }

    void cancelOne(int token) {
        ConnectionsManager.getInstance(currentAccount).cancelRequest(token, true);
        ConnectionsManager.getInstance(currentAccount).failNotRunningRequest(token);
    }

    public void setDelegate(Object delegate) {}
}
`;

const messageCellFixture = `package org.telegram.ui.Cells;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.TextPaint;

import org.telegram.messenger.AndroidUtilities;
import org.telegram.messenger.FileLoader;
import org.telegram.messenger.FileLog;
import org.telegram.messenger.ImageLocation;
import org.telegram.messenger.MessageObject;
import org.telegram.tgnet.TLObject;
import org.telegram.tgnet.TLRPC;

public class ChatMessageCell {
    void bindPhoto() {
        photoImage.setImage(ImageLocation.getForObject(currentPhotoObject, photoParentObject), currentPhotoFilter, ImageLocation.getForObject(currentPhotoObjectThumb, photoParentObject), currentPhotoFilterThumb, currentPhotoObjectThumbStripped, currentPhotoObject.size, null, currentMessageObject, cacheType);
    }

    void pressPhoto() {
        photoImage.setImage(ImageLocation.getForObject(currentPhotoObject, photoParentObject), currentPhotoFilter, ImageLocation.getForObject(currentPhotoObjectThumb, photoParentObject), currentPhotoFilterThumb, currentPhotoObjectThumbStripped, currentPhotoObject.size, null, currentMessageObject, cacheType);
    }

    private Paint clipPaint;
    protected void drawRadialProgress(Canvas canvas) {
        radialProgress.draw(canvas);
    }
}
`;

describe("Android direct-download patch", () => {
  it("injects URL resolution, HTTP chunks, fallback, cancellation, and observability idempotently", () => {
    const patched = patchFileLoadOperation(fixture);
    expect(patched).toContain("CrossgramDirectDownload.resolve(currentAccount, datacenterId, location");
    expect(patched).toContain("CrossgramDirectDownload.begin(fileName);");
    expect(patched).toContain("CrossgramDirectDownload.loadRange(");
    expect(patched).toContain("clearOperation(requestInfo, false, false);");
    expect(patched).toContain("buffer.position(0);");
    expect(patched).toContain("request = null;");
    expect(patched).toContain("crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_RELAY;");
    expect(patched).toContain("public String getCrossgramDownloadTransport()");
    expect(patched).toContain("CrossgramDirectDownload.cancelRequest(currentAccount, token, true)");
    expect(patched).toContain("CrossgramDirectDownload.failNotRunningRequest(currentAccount, token)");
    expect(patchFileLoadOperation(patched)).toBe(patched);
  });

  it("uses stripped previews while Crossgram photos load and draws a visible transport badge", () => {
    const patched = patchChatMessageCell(messageCellFixture);
    expect(patched).toContain("CrossgramDirectDownload.supports(parentObject)");
    expect(patched).toContain("getCrossgramLoadingThumbLocation(photoParentObject)");
    expect(patched).not.toContain(
      "ImageLocation.getForObject(currentPhotoObjectThumb, photoParentObject), currentPhotoFilterThumb, currentPhotoObjectThumbStripped, currentPhotoObject.size",
    );
    expect(patched).toContain('label = "直连";');
    expect(patched).toContain('label = "中转";');
    expect(patched).toContain("drawCrossgramTransportBadge(canvas);");
    expect(patched).toContain('FileLog.d("crossgram_transport_badge=" + transport');
    expect(patchChatMessageCell(patched)).toBe(patched);
  });

  it("migrates the initial loading helper to the upstream TLObject signature", () => {
    const previous = patchChatMessageCell(messageCellFixture)
      .replaceAll("TLObject parentObject", "Object parentObject");
    const migrated = patchChatMessageCell(previous);

    expect(migrated).not.toMatch(/\bObject parentObject/);
    expect(migrated.match(/TLObject parentObject/g)).toHaveLength(3);
  });

  it("keeps the RPC constructor and transport diagnostic marker stable", async () => {
    const runtime = await readFile(path.resolve(
      "features/direct-download/files/java/org/telegram/messenger/crossgram_direct/CrossgramDirectDownload.java",
    ), "utf8");
    expect(runtime).toContain("GET_FILE_URL_CONSTRUCTOR = 0x7520f6ea");
    expect(runtime).toContain('"crossgram_download_transport=" + transport');
    expect(runtime).toContain("REPORTED_TRANSPORTS");
    expect(runtime).toContain("supports(Object parentObject)");
    expect(runtime).toContain('"m".equals(location.thumb_size)');
  });

  it("migrates an already-patched direct download buffer to a readable position", () => {
    const previous = patchFileLoadOperation(fixture).replace(
      "                        buffer.position(0);\n",
      "",
    );

    expect(patchFileLoadOperation(previous)).toContain(
      "buffer.writeBytes(bytes);\n                        buffer.position(0);",
    );
  });

  it("migrates an already-patched operation to publish the resolving state", () => {
    const previous = patchFileLoadOperation(fixture).replace(
      "                CrossgramDirectDownload.begin(fileName);\n",
      "",
    );

    expect(patchFileLoadOperation(previous)).toContain(
      "crossgramDirectResolving = true;\n                CrossgramDirectDownload.begin(fileName);",
    );
  });

  it("migrates per-chunk fallback to an atomic operation reset", () => {
    const current = patchFileLoadOperation(fixture);
    const previous = current.replace(
      "                        clearOperation(requestInfo, false, false);",
      `                        requestInfos.remove(requestInfo);
                        AndroidUtilities.runOnUIThread(() -> uiRequestTokens.remove((Integer) requestInfo.requestToken));
                        requestedBytesCount -= requestInfo.chunkSize;
                        requestsCount--;
                        removePart(notRequestedBytesRanges, requestInfo.offset, requestInfo.offset + requestInfo.chunkSize);`,
    );

    const migrated = patchFileLoadOperation(previous);
    expect(migrated).toContain("clearOperation(requestInfo, false, false);");
    expect(migrated).not.toContain("requestedBytesCount -= requestInfo.chunkSize;");
  });

  it("installs both Java runtime files from the packaged template tree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgram-direct-install-"));
    const operation = path.join(root,
      "TMessagesProj/src/main/java/org/telegram/messenger/FileLoadOperation.java");
    try {
      await mkdir(path.dirname(operation), { recursive: true });
      await writeFile(operation, fixture, "utf8");
      const messageCell = path.join(root,
        "TMessagesProj/src/main/java/org/telegram/ui/Cells/ChatMessageCell.java");
      await mkdir(path.dirname(messageCell), { recursive: true });
      await writeFile(messageCell, messageCellFixture, "utf8");
      const changed = await applyDirectDownload(root, getUpstream("telegram"));
      expect(changed).toContain(path.join(
        "TMessagesProj/src/main/java/org/telegram/messenger/crossgram_direct/CrossgramDirectHttp.java",
      ));
      expect(await readFile(path.join(path.dirname(operation),
        "crossgram_direct/CrossgramDirectDownload.java"), "utf8"))
        .toContain("GET_FILE_URL_CONSTRUCTOR = 0x7520f6ea");
      expect(changed).toContain(
        "TMessagesProj/src/main/java/org/telegram/ui/Cells/ChatMessageCell.java",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
