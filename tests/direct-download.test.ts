import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyDirectDownload, patchFileLoadOperation } from "../features/direct-download/patch.js";
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

describe("Android direct-download patch", () => {
  it("injects URL resolution, HTTP chunks, fallback, cancellation, and observability idempotently", () => {
    const patched = patchFileLoadOperation(fixture);
    expect(patched).toContain("CrossgramDirectDownload.resolve(currentAccount, datacenterId, location");
    expect(patched).toContain("CrossgramDirectDownload.loadRange(");
    expect(patched).toContain("buffer.position(0);");
    expect(patched).toContain("request = null;");
    expect(patched).toContain("crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_RELAY;");
    expect(patched).toContain("public String getCrossgramDownloadTransport()");
    expect(patched).toContain("CrossgramDirectDownload.cancelRequest(currentAccount, token, true)");
    expect(patched).toContain("CrossgramDirectDownload.failNotRunningRequest(currentAccount, token)");
    expect(patchFileLoadOperation(patched)).toBe(patched);
  });

  it("keeps the RPC constructor and transport diagnostic marker stable", async () => {
    const runtime = await readFile(path.resolve(
      "features/direct-download/files/java/org/telegram/messenger/crossgram_direct/CrossgramDirectDownload.java",
    ), "utf8");
    expect(runtime).toContain("GET_FILE_URL_CONSTRUCTOR = 0x7520f6ea");
    expect(runtime).toContain('"crossgram_download_transport=" + transport');
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

  it("installs both Java runtime files from the packaged template tree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgram-direct-install-"));
    const operation = path.join(root,
      "TMessagesProj/src/main/java/org/telegram/messenger/FileLoadOperation.java");
    try {
      await mkdir(path.dirname(operation), { recursive: true });
      await writeFile(operation, fixture, "utf8");
      const changed = await applyDirectDownload(root, getUpstream("telegram"));
      expect(changed).toContain(path.join(
        "TMessagesProj/src/main/java/org/telegram/messenger/crossgram_direct/CrossgramDirectHttp.java",
      ));
      expect(await readFile(path.join(path.dirname(operation),
        "crossgram_direct/CrossgramDirectDownload.java"), "utf8"))
        .toContain("GET_FILE_URL_CONSTRUCTOR = 0x7520f6ea");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
