import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { addJavaImport, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const sendHelperFile = "TMessagesProj/src/main/java/org/telegram/messenger/SendMessagesHelper.java";
const browserFile = "TMessagesProj/src/main/java/org/telegram/messenger/browser/Browser.java";

async function install(root: string, relative: string, changedFiles: string[]): Promise<void> {
  const source = await readUtf8(path.join(featureRoot, "files", "java", relative));
  const target = path.join(root, "TMessagesProj/src/main/java", relative);
  if (await writeUtf8IfChanged(target, source)) changedFiles.push(path.relative(root, target));
}

export function patchSendMessagesHelper(initial: string): string {
  let source = addJavaImport(
    initial,
    "org.telegram.messenger.crossgram_merged.CrossgramMergedForward",
    sendHelperFile,
  );
  source = replaceRegexOnce(
    source,
    /(^[ \t]*TLRPC\.Updates updates = \(TLRPC\.Updates\) response;[ \t]*$)/m,
    `$1
                                long crossgramMergedRandomId =
                                        CrossgramMergedForward.confirmedRandomId(req, updates);
                                if (crossgramMergedRandomId != 0) {
                                    collapseCrossgramMergedForwardPlaceholders(
                                            crossgramMergedRandomId, newMsgObjArr, newMsgArr, scheduleDate);
                                }`,
    "collapseCrossgramMergedForwardPlaceholders(",
    sendHelperFile,
    "collapse extra placeholders after a many-to-one merged forward",
  );
  source = replaceRegexOnce(
    source,
    /(?=^[ \t]*protected\s+void\s+processSentMessage\s*\()/m,
    `    private void collapseCrossgramMergedForwardPlaceholders(
            long confirmedRandomId,
            ArrayList<TLRPC.Message> pendingMessages,
            ArrayList<MessageObject> pendingObjects,
            int scheduleDate) {
        if (pendingMessages.size() <= 1 || pendingMessages.size() != pendingObjects.size()) return;
        ArrayList<Integer> removedIds = new ArrayList<>();
        long dialogId = 0;
        int topicId = 0;
        for (int index = pendingMessages.size() - 1; index >= 0; index--) {
            TLRPC.Message message = pendingMessages.get(index);
            if (message.random_id == confirmedRandomId) continue;
            if (dialogId == 0) {
                dialogId = MessageObject.getDialogId(message);
                topicId = (int) MessageObject.getTopicId(currentAccount, message, 0);
            }
            removedIds.add(message.id);
            pendingMessages.remove(index);
            pendingObjects.remove(index);
        }
        if (removedIds.isEmpty() || pendingMessages.size() != 1) return;
        final long targetDialogId = dialogId;
        final int targetTopicId = topicId;
        final int mode = scheduleDate != 0 ? ChatActivity.MODE_SCHEDULED : ChatActivity.MODE_DEFAULT;
        AndroidUtilities.runOnUIThread(() -> {
            getMessagesController().deleteMessages(
                    removedIds, null, null, targetDialogId, targetTopicId, false, mode, true);
            for (Integer id : removedIds) {
                processSentMessage(id);
                removeFromSendingMessages(id, scheduleDate != 0);
            }
            FileLog.d("crossgram_merged_forward_collapsed removed=" + removedIds.size()
                    + " confirmed_random_id=" + confirmedRandomId);
            android.util.Log.d("CrossgramMergedForward", "collapsed removed=" + removedIds.size());
        });
    }

`,
    "private void collapseCrossgramMergedForwardPlaceholders(",
    sendHelperFile,
    "remove merged-forward placeholders that cannot share one server message id",
  );
  return source;
}

export function patchBrowser(initial: string): string {
  let source = addJavaImport(
    initial,
    "org.telegram.messenger.crossgram_merged.CrossgramMergedForward",
    browserFile,
  );
  source = replaceRegexOnce(
    source,
    /(^[ \t]*if \(context == null \|\| uri == null\) \{\r?\n[ \t]*return;\r?\n[ \t]*\}[ \t]*$)/m,
    `$1
        if (CrossgramMergedForward.openUrl(context, uri)) {
            return;
        }`,
    "CrossgramMergedForward.openUrl(context, uri)",
    browserFile,
    "open synthetic merged-forward chats before generic t.me routing",
  );
  return source;
}

export async function applyMergedForward(root: string, _upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  await install(
    root,
    "org/telegram/messenger/crossgram_merged/CrossgramMergedForward.java",
    changedFiles,
  );
  const sendTarget = path.join(root, sendHelperFile);
  if (await writeUtf8IfChanged(sendTarget, patchSendMessagesHelper(await readUtf8(sendTarget)))) {
    changedFiles.push(sendHelperFile);
  }
  const browserTarget = path.join(root, browserFile);
  if (await writeUtf8IfChanged(browserTarget, patchBrowser(await readUtf8(browserTarget)))) {
    changedFiles.push(browserFile);
  }
  return changedFiles;
}
