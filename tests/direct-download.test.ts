import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

    private void cleanup() {
        closeFiles();
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

const exec = promisify(execFile);

describe("Android direct-download patch", () => {
  it("injects URL resolution, one HTTP transfer, fallback, cancellation, and observability idempotently", () => {
    const patched = patchFileLoadOperation(fixture);
    expect(patched).toContain("CrossgramDirectDownload.resolve(currentAccount, datacenterId, location");
    expect(patched).toContain("CrossgramDirectDownload.begin(fileName);");
    expect(patched).toContain("CrossgramDirectDownload.open(resolved.url)");
    expect(patched).toContain("CrossgramDirectDownload.read(");
    expect(patched).not.toContain("CrossgramDirectDownload.loadRange(");
    expect(patched).toContain("clearOperation(requestInfo, false, false);");
    expect(patched).toContain("buffer.position(0);");
    expect(patched).toContain("request = null;");
    expect(patched).toContain("crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_RELAY;");
    expect(patched).toContain("public String getCrossgramDownloadTransport()");
    expect(patched).toContain("CrossgramDirectDownload.cancelRequest(currentAccount, token, true)");
    expect(patched).toContain("CrossgramDirectDownload.failNotRunningRequest(currentAccount, token)");
    expect(patched).toContain("CrossgramDirectDownload.close(crossgramDirectTransfer);");
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
    expect(patched).toContain("documentAttachType == DOCUMENT_ATTACH_TYPE_DOCUMENT && !drawPhotoImage");
    expect(patched).toContain("statusLayout.getLineWidth(0)");
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

  it("migrates the transport badge from below a file icon into its status row", () => {
    const previous = patchChatMessageCell(messageCellFixture).replace(
      /        float height;\n        float centerX;\n        if \(documentAttachType[\s\S]*?^        }\n(?=        canvas\.drawRoundRect)/m,
      `        float height = dp(20);
        float centerX = progressRect.centerX();
        float top = progressRect.bottom + dp(5);
        AndroidUtilities.rectTmp.set(centerX - width / 2f, top, centerX + width / 2f, top + height);\n`,
    );
    const migrated = patchChatMessageCell(previous);

    expect(migrated).toContain("documentAttachType == DOCUMENT_ATTACH_TYPE_DOCUMENT && !drawPhotoImage");
    expect(migrated).not.toContain("float top = progressRect.bottom + dp(5);\n        AndroidUtilities.rectTmp.set");
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
    expect(runtime).toContain("CrossgramBridgeFileReference.supports(reference)");
    expect(runtime).not.toContain('optBoolean("supportsRange"');
  });

  it("recognizes media, raw sticker, and raw reaction references without accepting malformed input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgram-direct-reference-"));
    const packageDir = path.join(root, "org/telegram/messenger/crossgram_direct");
    try {
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, "CrossgramBridgeFileReference.java"), await readFile(path.resolve(
        "features/direct-download/files/java/org/telegram/messenger/crossgram_direct/CrossgramBridgeFileReference.java",
      ), "utf8"), "utf8");
      await writeFile(path.join(packageDir, "Harness.java"), `package org.telegram.messenger.crossgram_direct;
import java.nio.charset.StandardCharsets;
public final class Harness {
  public static void main(String[] args) {
    for (String value : args) {
      System.out.print(CrossgramBridgeFileReference.supports(value.getBytes(StandardCharsets.UTF_8)) ? "1" : "0");
    }
  }
}`, "utf8");
      await exec("javac", [
        path.join(packageDir, "CrossgramBridgeFileReference.java"),
        path.join(packageDir, "Harness.java"),
      ]);
      const values = [
        "bridge-media:42",
        "bridge-sticker:qq:favorites/abc:0",
        "bridge-sticker:qqnt:stickers:favorite:direct:7",
        "bridge-reaction-resource:7002:1",
        "bridge-media:0",
        "bridge-sticker:qq::1",
        "bridge-sticker:qq:item:-1",
        "bridge-reaction-resource:0:1",
        "bridge-reaction-resource:7002:x",
        "bridge-unknown:1",
      ];
      const result = await exec("java", ["-cp", root,
        "org.telegram.messenger.crossgram_direct.Harness", ...values]);
      expect(result.stdout).toBe("1111000000");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

  it("migrates the old per-range HTTP shim to one normal transfer", () => {
    const current = patchFileLoadOperation(fixture);
    const previous = current
      .replace("    private CrossgramDirectDownload.Transfer crossgramDirectTransfer;\n", "")
      .replace(
        "&& crossgramDirectTransfer == null\n                && (crossgramDirectUrl == null || crossgramDirectUrlExpiresAt <= System.currentTimeMillis())) {",
        "&& (crossgramDirectUrl == null || crossgramDirectUrlExpiresAt <= System.currentTimeMillis())) {",
      )
      .replace(
        `                        crossgramDirectTransfer = CrossgramDirectDownload.open(resolved.url);
                        if (crossgramDirectTransfer != null) {
                            crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_DIRECT;
                            CrossgramDirectDownload.report(fileName, crossgramDownloadTransport, "http_transfer_started");
                        } else {
                            crossgramDirectDisabled = true;
                            crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_RELAY;
                            CrossgramDirectDownload.report(fileName, crossgramDownloadTransport, "http_transfer_open_failed");
                        }`,
        `                        crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_DIRECT;
                        CrossgramDirectDownload.report(fileName, crossgramDownloadTransport, "url_resolved");`,
      )
      .replace("} else if (crossgramDirectTransfer == null) {", "} else if (crossgramDirectUrl == null) {")
      .replace(
        "CrossgramDirectDownload.read(\n                        crossgramDirectTransfer,",
        "CrossgramDirectDownload.loadRange(\n                        crossgramDirectUrl,",
      )
      .replace(
        "if (directError != null || bytes == null) {\n                        clearOperation(requestInfo, false, false);\n                        crossgramDirectTransfer = null;",
        "if (directError != null || bytes == null || bytes.length == 0) {\n                        clearOperation(requestInfo, false, false);",
      );

    const migrated = patchFileLoadOperation(previous);
    expect(migrated).toContain("CrossgramDirectDownload.open(resolved.url)");
    expect(migrated).toContain("CrossgramDirectDownload.read(");
    expect(migrated).not.toContain("CrossgramDirectDownload.loadRange(");
  });

  it("installs all Java runtime files from the packaged template tree", async () => {
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
      expect(changed).toContain(path.join(
        "TMessagesProj/src/main/java/org/telegram/messenger/crossgram_direct/CrossgramBridgeFileReference.java",
      ));
      const runtime = await readFile(path.join(path.dirname(operation),
        "crossgram_direct/CrossgramDirectDownload.java"), "utf8");
      expect(runtime).toContain("import org.telegram.tgnet.AbstractSerializedData;");
      expect(runtime).toContain("AbstractSerializedData stream");
      expect(runtime).not.toContain("InputSerializedData");
      expect(runtime).not.toContain("OutputSerializedData");
      expect(changed).toContain(
        "TMessagesProj/src/main/java/org/telegram/ui/Cells/ChatMessageCell.java",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the split serialization API on current Telegram-family sources", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgram-direct-split-api-"));
    const operation = path.join(root,
      "TMessagesProj/src/main/java/org/telegram/messenger/FileLoadOperation.java");
    try {
      await mkdir(path.dirname(operation), { recursive: true });
      await writeFile(operation, fixture, "utf8");
      const messageCell = path.join(root,
        "TMessagesProj/src/main/java/org/telegram/ui/Cells/ChatMessageCell.java");
      await mkdir(path.dirname(messageCell), { recursive: true });
      await writeFile(messageCell, messageCellFixture, "utf8");
      const tgnet = path.join(root, "TMessagesProj/src/main/java/org/telegram/tgnet");
      await mkdir(tgnet, { recursive: true });
      await writeFile(path.join(tgnet, "InputSerializedData.java"), "", "utf8");

      await applyDirectDownload(root, getUpstream("nagram"));
      const runtime = await readFile(path.join(path.dirname(operation),
        "crossgram_direct/CrossgramDirectDownload.java"), "utf8");
      expect(runtime).toContain("InputSerializedData stream");
      expect(runtime).toContain("OutputSerializedData stream");
      expect(runtime).not.toContain("AbstractSerializedData");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
