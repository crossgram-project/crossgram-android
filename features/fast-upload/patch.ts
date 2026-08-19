import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { addJavaImport, editDeclarationBody, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const uploadFile = "TMessagesProj/src/main/java/org/telegram/messenger/FileUploadOperation.java";
const sendFile = "TMessagesProj/src/main/java/org/telegram/messenger/SendMessagesHelper.java";

async function install(root: string, relative: string, changedFiles: string[]): Promise<void> {
  let source = await readUtf8(path.join(featureRoot, "files", "java", relative));
  if (relative.endsWith("CrossgramFastUpload.java")) {
    try {
      await access(path.join(root, "TMessagesProj/src/main/java/org/telegram/tgnet/InputSerializedData.java"));
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

export function patchFileUploadOperation(initial: string): string {
  let source = addJavaImport(initial,
    "org.telegram.messenger.crossgram_upload.CrossgramFastUpload", uploadFile);
  source = replaceRegexOnce(source,
    /(^[ \t]*protected\s+long\s+lastProgressUpdateTime;[ \t]*$)/m,
    `$1
    private boolean crossgramFastUploadChecked;`,
    "crossgramFastUploadChecked", uploadFile, "add hash-first upload state");
  source = editDeclarationBody(source, /public\s+void\s+start\s*\(/, uploadFile,
    "FileUploadOperation.start", (body) => body.replace(
      `            slowNetwork = ApplicationLoader.isConnectionSlow();
            if (BuildVars.LOGS_ENABLED) {
                FileLog.d("start upload on slow network = " + slowNetwork);
            }
            for (int a = 0, count = (slowNetwork ? initialRequestsSlowNetworkCount : initialRequestsCount); a < count; a++) {
                startUploadRequest();
            }`,
      `            if (!isEncrypted && estimatedSize == 0 && !crossgramFastUploadChecked) {
                crossgramFastUploadChecked = true;
                long crossgramFileId = Utilities.random.nextLong();
                if (CrossgramFastUpload.prepare(currentAccount, uploadingFilePath, crossgramFileId, currentType,
                        result -> {
                    if (state != 1) return;
                    if (result != null) {
                        finishCrossgramFastUpload(result);
                    } else {
                        startCrossgramUploadRequests();
                    }
                })) {
                    return;
                }
            }
            startCrossgramUploadRequests();`,
    ));
  source = replaceRegexOnce(source,
    /(?=^[ \t]*protected\s+void\s+onNetworkChanged\s*\()/m,
    `    private void startCrossgramUploadRequests() {
        slowNetwork = ApplicationLoader.isConnectionSlow();
        if (BuildVars.LOGS_ENABLED) {
            FileLog.d("start upload on slow network = " + slowNetwork);
        }
        for (int a = 0, count = (slowNetwork ? initialRequestsSlowNetworkCount : initialRequestsCount); a < count; a++) {
            startUploadRequest();
        }
    }

    private void finishCrossgramFastUpload(CrossgramFastUpload.Result fast) {
        currentFileId = fast.fileId;
        totalFileSize = fast.size;
        totalPartsCount = 1;
        uploadedBytesCount = fast.size;
        state = 3;
        TLRPC.InputFile result;
        if (fast.big) {
            result = new TLRPC.TL_inputFileBig();
        } else {
            result = new TLRPC.TL_inputFile();
            result.md5_checksum = "";
        }
        result.parts = 1;
        result.id = fast.fileId;
        result.name = fast.name;
        delegate.didChangedUploadProgress(this, fast.size, fast.size);
        delegate.didFinishUploadingFile(this, result, null, null, null);
        cleanup();
    }

`, "private void finishCrossgramFastUpload", uploadFile, "finish a server-confirmed rapid upload");
  return source;
}

export function patchSendMessagesHelper(initial: string): string {
  let source = addJavaImport(initial,
    "org.telegram.messenger.crossgram_upload.CrossgramFastUpload", sendFile);
  source = editDeclarationBody(source,
    /private\s+void\s+putToDelayedMessages\s*\(/,
    sendFile, "SendMessagesHelper.putToDelayedMessages", (body) =>
      body.includes("CrossgramFastUpload.bind(") ? body : `
        if (message != null && message.obj != null) {
            CrossgramFastUpload.bind(location, currentAccount, message.obj.getDialogId());
        }${body}`);
  return source;
}

export async function applyFastUpload(root: string, _upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  await install(root, "org/telegram/messenger/crossgram_upload/CrossgramFastUploadHash.java", changedFiles);
  await install(root, "org/telegram/messenger/crossgram_upload/CrossgramFastUpload.java", changedFiles);
  for (const [relative, patch] of [[uploadFile, patchFileUploadOperation], [sendFile, patchSendMessagesHelper]] as const) {
    const target = path.join(root, relative);
    const source = await readUtf8(target);
    if (await writeUtf8IfChanged(target, patch(source))) changedFiles.push(relative);
  }
  return changedFiles;
}
