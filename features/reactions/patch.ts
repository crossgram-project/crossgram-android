import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import {
  addJavaImport,
  replaceExactlyOnce,
  replaceRegexOnce,
} from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const javaRoot = "TMessagesProj/src/main/java";
const reactionsFile = `${javaRoot}/org/telegram/messenger/crossgram_reactions/CrossgramReactions.java`;
const chatActivityFile = `${javaRoot}/org/telegram/ui/ChatActivity.java`;
const pollItemMenuFile = `${javaRoot}/org/telegram/ui/PollItemMenu.java`;
const todoItemMenuFile = `${javaRoot}/org/telegram/ui/TodoItemMenu.java`;
const selectionOverlayFile =
  `${javaRoot}/org/telegram/ui/Components/Reactions/ChatSelectionReactionMenuOverlay.java`;

const reactionsImport = "org.telegram.messenger.crossgram_reactions.CrossgramReactions";
const requestMarker = "CrossgramReactions.requestConversation(";
const guardMarker = "CrossgramReactions.allowsConversation(";

/** Stop the chat menu from advertising reactions the relay refuses. */
export function patchChatActivity(initial: string): string {
  let source = addJavaImport(initial, reactionsImport, chatActivityFile);
  source = replaceRegexOnce(
    source,
    /(^[ \t]*public\s+void\s+onResume\s*\(\s*\)\s*\{[\r\n\s]*super\.onResume\(\);[ \t]*$)/m,
    "$1\n        CrossgramReactions.requestConversation(currentAccount, dialog_id);",
    requestMarker,
    chatActivityFile,
    "warm the reaction support query when a chat is opened",
  );
  // Private chats bypass the available_reactions check with `currentUser != null`,
  // which is exactly what keeps the reaction row in a QQ one-to-one chat.
  source = replaceRegexOnce(
    source,
    /^([ \t]*)\|\| currentUser != null$/m,
    "$1|| (currentUser != null && CrossgramReactions.allowsConversation(currentAccount, dialog_id))",
    guardMarker,
    chatActivityFile,
    "honour the relay's reaction refusal for private chats",
  );
  return source;
}

/** The poll and todo item menus duplicate the same private-chat bypass. */
export function patchMenuItem(initial: string, file: string): string {
  let source = addJavaImport(initial, reactionsImport, file);
  source = replaceExactlyOnce(
    source,
    "|| chatActivity.currentUser != null ||",
    "|| (chatActivity.currentUser != null && CrossgramReactions.allowsConversation(chatActivity.getCurrentAccount(), chatActivity.dialog_id)) ||",
    file,
    "honour the relay's reaction refusal in the item menu",
  );
  return source;
}

/** The multi-select reaction overlay only consults the group's own reactions. */
export function patchSelectionOverlay(initial: string): string {
  let source = addJavaImport(initial, reactionsImport, selectionOverlayFile);
  source = replaceExactlyOnce(
    source,
    "available_reactions instanceof TLRPC.TL_chatReactionsNone) {",
    "available_reactions instanceof TLRPC.TL_chatReactionsNone || !CrossgramReactions.allowsConversation(parentFragment.getCurrentAccount(), parentFragment.getDialogId())) {",
    selectionOverlayFile,
    "honour the relay's reaction refusal in the selection overlay",
  );
  return source;
}

async function installHelper(root: string, changedFiles: string[]): Promise<void> {
  let source = await readUtf8(path.join(
    featureRoot,
    "files/java/org/telegram/messenger/crossgram_reactions/CrossgramReactions.java",
  ));
  try {
    await access(path.join(root, `${javaRoot}/org/telegram/tgnet/InputSerializedData.java`));
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
  if (await writeUtf8IfChanged(path.join(root, reactionsFile), source)) changedFiles.push(reactionsFile);
}

export async function applyReactions(root: string, _upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  await installHelper(root, changedFiles);
  // The duplicated reaction gates moved around between forks; patch what is
  // actually there instead of shipping a half-blocked client.
  const targets: Array<[string, (source: string) => string]> = [
    [chatActivityFile, patchChatActivity],
    [pollItemMenuFile, (source) => patchMenuItem(source, pollItemMenuFile)],
    [todoItemMenuFile, (source) => patchMenuItem(source, todoItemMenuFile)],
    [selectionOverlayFile, patchSelectionOverlay],
  ];
  for (const [relative, patch] of targets) {
    const target = path.join(root, relative);
    const present = await access(target).then(() => true, () => false);
    if (!present) continue;
    const source = await readUtf8(target);
    const patched = patch(source);
    if (await writeUtf8IfChanged(target, patched)) changedFiles.push(relative);
  }
  return changedFiles;
}
