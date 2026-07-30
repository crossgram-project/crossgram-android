import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { addJavaImport, editDeclarationBody, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const operationFile = "TMessagesProj/src/main/java/org/telegram/messenger/FileLoadOperation.java";
const messageCellFile = "TMessagesProj/src/main/java/org/telegram/ui/Cells/ChatMessageCell.java";

async function install(root: string, relative: string, changedFiles: string[]): Promise<void> {
  let source = await readUtf8(path.join(featureRoot, "files", "java", relative));
  if (relative.endsWith("CrossgramDirectDownload.java")) {
    const splitInputApi = path.join(
      root,
      "TMessagesProj/src/main/java/org/telegram/tgnet/InputSerializedData.java",
    );
    try {
      await access(splitInputApi);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      source = source
        .replace(
          /import org\.telegram\.tgnet\.InputSerializedData;\r?\nimport org\.telegram\.tgnet\.OutputSerializedData;/,
          "import org.telegram.tgnet.AbstractSerializedData;",
        )
        .replaceAll("InputSerializedData stream", "AbstractSerializedData stream")
        .replaceAll("OutputSerializedData stream", "AbstractSerializedData stream");
    }
  }
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
                CrossgramDirectDownload.begin(fileName);
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
                        clearOperation(requestInfo, false, false);
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
    /(^[ \t]*crossgramDirectResolving = true;[ \t]*$)/m,
    `$1
                CrossgramDirectDownload.begin(fileName);`,
    "CrossgramDirectDownload.begin(fileName);",
    operationFile,
    "expose URL resolution to the transport indicator",
  );
  source = source.replace(
    `                        requestInfos.remove(requestInfo);
                        AndroidUtilities.runOnUIThread(() -> uiRequestTokens.remove((Integer) requestInfo.requestToken));
                        requestedBytesCount -= requestInfo.chunkSize;
                        requestsCount--;
                        removePart(notRequestedBytesRanges, requestInfo.offset, requestInfo.offset + requestInfo.chunkSize);`,
    "                        clearOperation(requestInfo, false, false);",
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

export function patchChatMessageCell(initial: string): string {
  let source = addJavaImport(
    initial,
    "org.telegram.messenger.crossgram_direct.CrossgramDirectDownload",
    messageCellFile,
  );
  source = source
    .replace("useCrossgramStrippedLoadingThumb(Object parentObject)",
      "useCrossgramStrippedLoadingThumb(TLObject parentObject)")
    .replace("getCrossgramLoadingThumbLocation(Object parentObject)",
      "getCrossgramLoadingThumbLocation(TLObject parentObject)")
    .replace("getCrossgramLoadingThumbFilter(Object parentObject)",
      "getCrossgramLoadingThumbFilter(TLObject parentObject)");

  const originalThumb = "ImageLocation.getForObject(currentPhotoObjectThumb, photoParentObject), currentPhotoFilterThumb, currentPhotoObjectThumbStripped, currentPhotoObject.size";
  const strippedThumb = "getCrossgramLoadingThumbLocation(photoParentObject), getCrossgramLoadingThumbFilter(photoParentObject), currentPhotoObjectThumbStripped, currentPhotoObject.size";
  if (!source.includes(strippedThumb)) {
    const count = source.split(originalThumb).length - 1;
    if (count < 1) {
      throw new Error(`${messageCellFile}: photo loading image anchor was not found`);
    }
    source = source.replaceAll(originalThumb, strippedThumb);
  }

  const legacyTransportBadgePlacement = `        float height = dp(20);
        float centerX = progressRect.centerX();
        float top = progressRect.bottom + dp(5);
        AndroidUtilities.rectTmp.set(centerX - width / 2f, top, centerX + width / 2f, top + height);`;
  const transportBadgePlacement = `        float height;
        float centerX;
        if (documentAttachType == DOCUMENT_ATTACH_TYPE_DOCUMENT && !drawPhotoImage) {
            height = dp(18);
            StaticLayout statusLayout = buttonState == 1 && loadingProgressLayout != null
                    ? loadingProgressLayout : infoLayout;
            float statusWidth = statusLayout != null && statusLayout.getLineCount() > 0
                    ? statusLayout.getLineWidth(0) : 0;
            float left = buttonX + dp(53) + statusWidth + dp(6);
            float maxRight = buttonX + backgroundWidth
                    - dp(currentMessageObject.type == MessageObject.TYPE_TEXT ? 60 : 50)
                    - dp(hasLinkPreview ? 24 : 0);
            left = Math.min(left, maxRight - width);
            float top = buttonY + dp(24);
            if (docTitleLayout != null && docTitleLayout.getLineCount() > 1) {
                top += (docTitleLayout.getLineCount() - 1) * dp(16) + dp(2);
            }
            AndroidUtilities.rectTmp.set(left, top, left + width, top + height);
            centerX = AndroidUtilities.rectTmp.centerX();
        } else {
            height = dp(20);
            centerX = progressRect.centerX();
            float top = progressRect.bottom + dp(5);
            AndroidUtilities.rectTmp.set(centerX - width / 2f, top, centerX + width / 2f, top + height);
        }`;
  source = source.replace(legacyTransportBadgePlacement, transportBadgePlacement);

  source = replaceRegexOnce(
    source,
    /(?=^[ \t]*private Paint clipPaint;[ \t]*$)/m,
    `    private Paint crossgramTransportBackgroundPaint;
    private TextPaint crossgramTransportTextPaint;
    private String crossgramLastDrawnTransport;
    private String crossgramLastDrawnTransportFile;

    private boolean useCrossgramStrippedLoadingThumb(TLObject parentObject) {
        return currentMessageObject != null
                && !currentMessageObject.mediaExists
                && currentPhotoObjectThumbStripped != null
                && CrossgramDirectDownload.supports(parentObject);
    }

    private ImageLocation getCrossgramLoadingThumbLocation(TLObject parentObject) {
        return useCrossgramStrippedLoadingThumb(parentObject)
                ? null
                : ImageLocation.getForObject(currentPhotoObjectThumb, parentObject);
    }

    private String getCrossgramLoadingThumbFilter(TLObject parentObject) {
        return useCrossgramStrippedLoadingThumb(parentObject) ? null : currentPhotoFilterThumb;
    }

    private String getCrossgramDownloadFileName() {
        if (currentMessageObject == null) return null;
        if (currentMessageObject.type == MessageObject.TYPE_PHOTO && currentPhotoObject != null) {
            return FileLoader.getAttachFileName(currentPhotoObject);
        }
        TLRPC.Document document = documentAttach != null ? documentAttach : currentMessageObject.getDocument();
        return document == null ? null : FileLoader.getAttachFileName(document);
    }

    private void drawCrossgramTransportBadge(Canvas canvas) {
        if (buttonState != 1 || currentMessageObject == null) return;
        String fileName = getCrossgramDownloadFileName();
        String transport = CrossgramDirectDownload.getReportedTransport(fileName);
        if (transport == null) return;

        String label;
        int backgroundColor;
        if (CrossgramDirectDownload.TRANSPORT_DIRECT.equals(transport)) {
            label = "直连";
            backgroundColor = 0xE02EAD66;
        } else if (CrossgramDirectDownload.TRANSPORT_RELAY.equals(transport)) {
            label = "中转";
            backgroundColor = 0xE0E08A24;
        } else {
            label = "连接中";
            backgroundColor = 0xD9707070;
            postInvalidateDelayed(100);
        }

        if (crossgramTransportTextPaint == null) {
            crossgramTransportTextPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
            crossgramTransportTextPaint.setColor(Color.WHITE);
            crossgramTransportTextPaint.setTextSize(dp(11));
            crossgramTransportTextPaint.setTypeface(Typeface.DEFAULT_BOLD);
            crossgramTransportTextPaint.setTextAlign(Paint.Align.CENTER);
            crossgramTransportBackgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        }
        crossgramTransportBackgroundPaint.setColor(backgroundColor);
        RectF progressRect = radialProgress.getProgressRect();
        float width = crossgramTransportTextPaint.measureText(label) + dp(12);
${transportBadgePlacement}
        canvas.drawRoundRect(AndroidUtilities.rectTmp, height / 2f, height / 2f, crossgramTransportBackgroundPaint);
        Paint.FontMetrics metrics = crossgramTransportTextPaint.getFontMetrics();
        float baseline = AndroidUtilities.rectTmp.centerY() - (metrics.ascent + metrics.descent) / 2f;
        canvas.drawText(label, centerX, baseline, crossgramTransportTextPaint);

        if (!transport.equals(crossgramLastDrawnTransport) || !fileName.equals(crossgramLastDrawnTransportFile)) {
            crossgramLastDrawnTransport = transport;
            crossgramLastDrawnTransportFile = fileName;
            FileLog.d("crossgram_transport_badge=" + transport + " file=" + fileName);
        }
    }

`,
    "drawCrossgramTransportBadge(Canvas canvas)",
    messageCellFile,
    "add direct/relay download badge and stripped loading preview helpers",
  );

  source = editDeclarationBody(
    source,
    /protected\s+void\s+drawRadialProgress\s*\(/,
    messageCellFile,
    "ChatMessageCell.drawRadialProgress",
    (body) => replaceRegexOnce(
      body,
      /(^[ \t]*radialProgress\.draw\(canvas\);[ \t]*$)/m,
      `$1
        drawCrossgramTransportBadge(canvas);`,
      "drawCrossgramTransportBadge(canvas);",
      messageCellFile,
      "draw transport badge after media progress",
    ),
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
  const messageCellTarget = path.join(root, messageCellFile);
  const messageCellSource = await readUtf8(messageCellTarget);
  if (await writeUtf8IfChanged(messageCellTarget, patchChatMessageCell(messageCellSource))) {
    changedFiles.push(messageCellFile);
  }
  return changedFiles;
}
