import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { addJavaImport, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const sendHelperFile = "TMessagesProj/src/main/java/org/telegram/messenger/SendMessagesHelper.java";
const messageObjectFile = "TMessagesProj/src/main/java/org/telegram/messenger/MessageObject.java";
const splitUpdateFile = "TMessagesProj/src/main/java/org/telegram/tgnet/tl/TL_update.java";

export function adaptSendCancellationRuntime(initial: string, hasSplitUpdateClasses: boolean): string {
  if (hasSplitUpdateClasses) return initial;
  return initial
    .replace(/^import org\.telegram\.tgnet\.tl\.TL_update;\r?\n/m, "")
    .replaceAll("TL_update.TL_", "TLRPC.TL_");
}

export function topicIdFallbackArgument(messageObjectSource: string): "0" | "false" {
  const prefix = String.raw`(?:public|protected|private)\s+static\s+long\s+getTopicId\s*\(\s*int\s+\w+\s*,\s*TLRPC\.Message\s+\w+\s*,\s*`;
  if (new RegExp(`${prefix}int\\s+\\w+\\s*\\)`, "m").test(messageObjectSource)) return "0";
  if (new RegExp(`${prefix}boolean\\s+\\w+\\s*\\)`, "m").test(messageObjectSource)) return "false";
  throw new Error(`${messageObjectFile}: unsupported MessageObject.getTopicId signature`);
}

export function patchSendMessagesHelper(
  initial: string,
  topicIdFallback: "0" | "false" = "0",
): string {
  let source = addJavaImport(
    initial,
    "org.telegram.messenger.crossgram_send.CrossgramSendCancellation",
    sendHelperFile,
  );
  source = replaceRegexOnce(
    source,
    /(^[ \t]*TLRPC\.Updates updates = \(TLRPC\.Updates\) response;[ \t]*$)/m,
    `$1
                                ArrayList<Long> crossgramCancelledRandomIds =
                                        CrossgramSendCancellation.takeCancelledRandomIds(req.random_id, updates);
                                if (!crossgramCancelledRandomIds.isEmpty()) {
                                    cancelCrossgramSendingPlaceholders(
                                            crossgramCancelledRandomIds, newMsgObjArr, newMsgArr, scheduleDate);
                                }`,
    "cancelCrossgramSendingPlaceholders(",
    sendHelperFile,
    "consume explicit send-cancellation confirmations",
  );
  source = replaceRegexOnce(
    source,
    /(?=^[ \t]*protected\s+void\s+processSentMessage\s*\()/m,
    `    private void cancelCrossgramSendingPlaceholders(
            ArrayList<Long> cancelledRandomIds,
            ArrayList<TLRPC.Message> pendingMessages,
            ArrayList<MessageObject> pendingObjects,
            int scheduleDate) {
        if (cancelledRandomIds.isEmpty() || pendingMessages.size() != pendingObjects.size()) return;
        ArrayList<Integer> removedIds = new ArrayList<>();
        long dialogId = 0;
        int topicId = 0;
        for (int index = pendingMessages.size() - 1; index >= 0; index--) {
            TLRPC.Message message = pendingMessages.get(index);
            if (!cancelledRandomIds.contains(message.random_id)) continue;
            if (dialogId == 0) {
                dialogId = MessageObject.getDialogId(message);
                topicId = (int) MessageObject.getTopicId(currentAccount, message, ${topicIdFallback});
            }
            removedIds.add(message.id);
            pendingMessages.remove(index);
            pendingObjects.remove(index);
        }
        if (removedIds.isEmpty()) return;
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
            FileLog.d("crossgram_send_cancelled removed=" + removedIds.size());
            android.util.Log.d("CrossgramSendCancellation", "cancelled removed=" + removedIds.size());
        });
    }

`,
    "private void cancelCrossgramSendingPlaceholders(",
    sendHelperFile,
    "remove placeholders acknowledged as intentionally cancelled",
  );
  return source;
}

export async function applySendCancellation(root: string, _upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  const runtimeRelative = "org/telegram/messenger/crossgram_send/CrossgramSendCancellation.java";
  const runtimeSource = await readUtf8(path.join(featureRoot, "files", "java", runtimeRelative));
  const runtimeTarget = path.join(root, "TMessagesProj/src/main/java", runtimeRelative);
  const hasSplitUpdateClasses = await access(path.join(root, splitUpdateFile))
    .then(() => true, () => false);
  if (await writeUtf8IfChanged(
    runtimeTarget,
    adaptSendCancellationRuntime(runtimeSource, hasSplitUpdateClasses),
  )) {
    changedFiles.push(path.relative(root, runtimeTarget));
  }

  const topicIdFallback = topicIdFallbackArgument(await readUtf8(path.join(root, messageObjectFile)));
  const sendTarget = path.join(root, sendHelperFile);
  if (await writeUtf8IfChanged(
    sendTarget,
    patchSendMessagesHelper(await readUtf8(sendTarget), topicIdFallback),
  )) {
    changedFiles.push(sendHelperFile);
  }
  return changedFiles;
}
