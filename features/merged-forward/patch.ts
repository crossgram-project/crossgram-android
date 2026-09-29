import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { addJavaImport, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const browserFile = "TMessagesProj/src/main/java/org/telegram/messenger/browser/Browser.java";
const controllerFile = "TMessagesProj/src/main/java/org/telegram/messenger/MessagesController.java";

/**
 * A transcript chat is a history-only peer: the relay answers
 * `messages.getPeerDialogs` for it with the chat entity but no dialog, so
 * clients never list it.  Android opens a chat around the anchored message by
 * asking for its dialog first and only loads history from that dialog's top
 * message; with no dialog the history request is never sent and the
 * transcript stays on skeleton placeholders.  Skip that prefetch for the
 * transcript chats the client opened, so history loads straight around the
 * anchor like any peer whose dialog is already known.
 */
export function patchMessagesController(initial: string): string {
  let source = addJavaImport(
    initial,
    "org.telegram.messenger.crossgram_merged.CrossgramMergedForward",
    controllerFile,
  );
  source = replaceRegexOnce(
    source,
    /(^[ \t]*if \()((?:!ChatObject\.isMonoForum\(chat\) && )?loadDialog && \(load_type == LOAD_AROUND_MESSAGE \|\| load_type == LOAD_FROM_UNREAD\) && last_message_id == 0)(\) \{[ \t]*$)/m,
    "$1$2 && !CrossgramMergedForward.isTranscriptDialog(dialogId)$3",
    "!CrossgramMergedForward.isTranscriptDialog(dialogId)",
    controllerFile,
    "load transcript history without waiting for a dialog the relay never lists",
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
  const runtimeRelative = "org/telegram/messenger/crossgram_merged/CrossgramMergedForward.java";
  const runtimeSource = await readUtf8(path.join(featureRoot, "files", "java", runtimeRelative));
  const runtimeTarget = path.join(root, "TMessagesProj/src/main/java", runtimeRelative);
  if (await writeUtf8IfChanged(runtimeTarget, runtimeSource)) {
    changedFiles.push(path.relative(root, runtimeTarget));
  }

  const browserTarget = path.join(root, browserFile);
  if (await writeUtf8IfChanged(browserTarget, patchBrowser(await readUtf8(browserTarget)))) {
    changedFiles.push(browserFile);
  }
  const controllerTarget = path.join(root, controllerFile);
  if (await writeUtf8IfChanged(controllerTarget, patchMessagesController(await readUtf8(controllerTarget)))) {
    changedFiles.push(controllerFile);
  }
  return changedFiles;
}
