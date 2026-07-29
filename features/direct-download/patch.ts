import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { addJavaImport, editDeclarationBody, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const operationFile = "TMessagesProj/src/main/java/org/telegram/messenger/FileLoadOperation.java";

async function install(root: string, relative: string, changedFiles: string[]): Promise<void> {
  const source = await readUtf8(path.join(featureRoot, "files", "java", relative));
  const target = path.join(root, "TMessagesProj/src/main/java", relative);
  if (await writeUtf8IfChanged(target, source)) changedFiles.push(path.relative(root, target));
}

export function patchFileLoadOperation(initial: string): string {
  let source = addJavaImport(
    initial,
    "org.telegram.messenger.crossgram_direct.CrossgramDirectDownload",
    operationFile,
  );
  source = replaceRegexOnce(
    source,
    /(^[ \t]*protected\s+boolean\s+requestingReference;[ \t]*$)/m,
    `$1
    private String crossgramDirectUrl;
    private long crossgramDirectUrlExpiresAt;
    private boolean crossgramDirectResolving;
    private boolean crossgramDirectDisabled;
    private String crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_RELAY;`,
    "private String crossgramDirectUrl;",
    operationFile,
    "add per-download direct transport state",
  );
  source = editDeclarationBody(
    source,
    /protected\s+void\s+startDownloadRequest\s*\(/,
    operationFile,
    "FileLoadOperation.startDownloadRequest",
    (body) => {
      let updated = replaceRegexOnce(
        body,
        /(^[ \t]*int\s+count\s*=\s*1;[ \t]*$)/m,
        `        if (!crossgramDirectDisabled && CrossgramDirectDownload.supports(location)
                && (crossgramDirectUrl == null || crossgramDirectUrlExpiresAt <= System.currentTimeMillis())) {
            if (!crossgramDirectResolving) {
                crossgramDirectResolving = true;
                CrossgramDirectDownload.resolve(currentAccount, datacenterId, location, (resolved, error) -> {
                    crossgramDirectResolving = false;
                    if (resolved != null) {
                        crossgramDirectUrl = resolved.url;
                        crossgramDirectUrlExpiresAt = resolved.expiresAt;
                        crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_DIRECT;
                        CrossgramDirectDownload.report(fileName, crossgramDownloadTransport, "url_resolved");
                    } else {
                        crossgramDirectDisabled = true;
                        crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_RELAY;
                        CrossgramDirectDownload.report(fileName, crossgramDownloadTransport, error != null ? error : "rpc_unavailable");
                    }
                    startDownloadRequest(useConnectionType);
                });
            }
            return;
        }
$1`,
        "crossgramDirectResolving = true;",
        operationFile,
        "resolve a direct URL before scheduling file chunks",
      );
      updated = replaceRegexOnce(
        updated,
        /\}\s+else\s+\{\s*TLRPC\.TL_upload_getFile req = new TLRPC\.TL_upload_getFile\(\);([\s\S]*?)request = req;\s*\}/,
        `} else if (crossgramDirectUrl == null) {
                    TLRPC.TL_upload_getFile req = new TLRPC.TL_upload_getFile();$1request = req;
                } else {
                    request = null;
                }`,
        "request = null;",
        operationFile,
        "select direct HTTP instead of upload.getFile",
      );
      updated = replaceRegexOnce(
        updated,
        /(^[ \t]*final\s+int\s+requestToken\s*=\s*requestInfo\.requestToken\s*=\s*ConnectionsManager)/m,
        `            if (request == null) {
                final int directToken = requestInfo.requestToken = CrossgramDirectDownload.loadRange(
                        crossgramDirectUrl, requestInfo.offset, requestInfo.chunkSize, (bytes, directError) -> {
                    if (requestInfo.cancelled || state != stateDownloading) return;
                    if (directError != null || bytes == null || bytes.length == 0) {
                        requestInfos.remove(requestInfo);
                        AndroidUtilities.runOnUIThread(() -> uiRequestTokens.remove((Integer) requestInfo.requestToken));
                        requestedBytesCount -= requestInfo.chunkSize;
                        requestsCount--;
                        removePart(notRequestedBytesRanges, requestInfo.offset, requestInfo.offset + requestInfo.chunkSize);
                        crossgramDirectDisabled = true;
                        crossgramDirectUrl = null;
                        crossgramDownloadTransport = CrossgramDirectDownload.TRANSPORT_RELAY;
                        CrossgramDirectDownload.report(fileName, crossgramDownloadTransport,
                                directError != null ? directError : "empty_http_response");
                        startDownloadRequest(connectionType);
                        return;
                    }
                    requestInfo.response = new TLRPC.TL_upload_file();
                    try {
                        NativeByteBuffer buffer = new NativeByteBuffer(bytes.length);
                        buffer.writeBytes(bytes);
                        buffer.position(0);
                        requestInfo.response.bytes = buffer;
                        processRequestResult(requestInfo, null);
                    } catch (Exception exception) {
                        FileLog.e(exception);
                        onFail(false, 0);
                    } finally {
                        if (requestInfo.response != null) requestInfo.response.freeResources();
                    }
                });
                AndroidUtilities.runOnUIThread(() -> uiRequestTokens.add(directToken));
                requestsCount++;
                continue;
            }
$1`,
        "CrossgramDirectDownload.loadRange(",
        operationFile,
        "feed direct HTTP chunks into the existing file assembler",
      );
      return updated;
    },
  );
  source = replaceRegexOnce(
    source,
    /(NativeByteBuffer buffer = new NativeByteBuffer\(bytes\.length\);\s*buffer\.writeBytes\(bytes\);)/,
    `$1
                        buffer.position(0);`,
    "buffer.writeBytes(bytes);\n                        buffer.position(0);",
    operationFile,
    "rewind direct HTTP chunks before file assembly",
  );
  source = source.replaceAll(
    "ConnectionsManager.getInstance(currentAccount).cancelRequest(",
    "CrossgramDirectDownload.cancelRequest(currentAccount, ",
  ).replaceAll(
    "ConnectionsManager.getInstance(currentAccount).failNotRunningRequest(",
    "CrossgramDirectDownload.failNotRunningRequest(currentAccount, ",
  );
  source = replaceRegexOnce(
    source,
    /(?=^[ \t]*public\s+void\s+setDelegate\s*\()/m,
    `
    /** Observable transport selected for this operation: direct or relay. */
    public String getCrossgramDownloadTransport() {
        return crossgramDownloadTransport;
    }

`,
    "getCrossgramDownloadTransport()",
    operationFile,
    "expose the selected download transport",
  );
  return source;
}

export async function applyDirectDownload(root: string, _upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  await install(root, "org/telegram/messenger/crossgram_direct/CrossgramDirectHttp.java", changedFiles);
  await install(root, "org/telegram/messenger/crossgram_direct/CrossgramDirectDownload.java", changedFiles);
  const target = path.join(root, operationFile);
  const source = await readUtf8(target);
  if (await writeUtf8IfChanged(target, patchFileLoadOperation(source))) changedFiles.push(operationFile);
  return changedFiles;
}
