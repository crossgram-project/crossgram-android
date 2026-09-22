import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import {
  addJavaImport,
  countOccurrences,
  editDeclarationBody,
  replaceExactlyOnce,
  replaceRegexOnce,
} from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const javaRoot = "TMessagesProj/src/main/java";
const pokeFile = `${javaRoot}/org/telegram/messenger/crossgram_poke/CrossgramPoke.java`;
const avatarPreviewerFile = `${javaRoot}/org/telegram/ui/AvatarPreviewer.java`;
const chatActivityFile = `${javaRoot}/org/telegram/ui/ChatActivity.java`;

const pokeImport = "org.telegram.messenger.crossgram_poke.CrossgramPoke";

/** Add the poke rows to the avatar previewer's menu and let it own the rounding. */
function replaceRegexIfUnique(
  source: string,
  pattern: RegExp,
  replacement: string,
  marker: string,
): string {
  if (source.includes(marker)) return source;
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  if ([...source.matchAll(globalPattern)].length !== 1) return source;
  return source.replace(pattern, replacement);
}

export function patchAvatarPreviewer(initial: string): string {
  let source = addJavaImport(initial, pokeImport, avatarPreviewerFile);
  source = editDeclarationBody(
    source,
    /public\s+void\s+setData\s*\(\s*Data\s+data\s*\)/,
    avatarPreviewerFile,
    "patch the avatar previewer menu",
    (body) => {
      let updated = body;
      updated = replaceRegexIfUnique(
        updated,
        /ActionBarMenuItem\.addItem\(i == 0, i == menuItems\.length - 1, menu,/,
        "ActionBarMenuItem.addItem(i == 0, i == menuItems.length - 1"
          + " && !CrossgramPoke.keepsMenuLast(data.parentObject), menu,",
        "CrossgramPoke.keepsMenuLast(data.parentObject)",
      );
      updated = replaceRegexIfUnique(
        updated,
        /(^[ \t]*setShowing\(true\);[ \t]*$)/m,
        "            CrossgramPoke.appendMenu(menu, data.parentObject, resourcesProvider, () -> setData(data));\n\n$1",
        "CrossgramPoke.appendMenu(",
      );
      return updated;
    },
  );
  return source;
}

/** Let the avatar menus in a chat know which conversation they belong to. */
export function patchChatActivity(initial: string): string {
  let source = addJavaImport(initial, pokeImport, chatActivityFile);
  source = replaceRegexIfUnique(
    source,
    /(^[ \t]*public\s+void\s+onResume\s*\(\s*\)\s*\{[\r\n\s]*super\.onResume\(\);[ \t]*$)/m,
    "$1\n        CrossgramPoke.setConversation(currentAccount, dialog_id);",
    "CrossgramPoke.setConversation(currentAccount, dialog_id);",
  );
  source = editDeclarationBody(
    source,
    /public\s+boolean\s+didLongPressUserAvatar\s*\(/,
    chatActivityFile,
    "patch the long-press avatar menu",
    (body) => {
      // Forks without the full-screen previewer build a small ItemOptions menu
      // instead; the poke row joins that one as a single tap action.
      if (body.includes("CrossgramPoke.appendOptions(")) return body;
      const target = "ItemOptions.makeOptions(ChatActivity.this, cell)";
      return countOccurrences(body, target) === 1
        ? body.replace(target, `CrossgramPoke.appendOptions(${target}, user)`)
        : body;
    },
  );
  return source;
}

async function installPokeHelper(root: string, changedFiles: string[]): Promise<void> {
  let source = await readUtf8(path.join(featureRoot, "files/java/org/telegram/messenger/crossgram_poke/CrossgramPoke.java"));
  const target = path.join(root, pokeFile);
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
  if (await writeUtf8IfChanged(target, source)) changedFiles.push(pokeFile);
}

export async function applyPoke(root: string, _upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  const avatarPreviewerTarget = path.join(root, avatarPreviewerFile);
  const chatActivityTarget = path.join(root, chatActivityFile);
  await installPokeHelper(root, changedFiles);
  // Both call sites moved around between forks; patch what is actually there and
  // leave the rest of the tree untouched instead of shipping a half-filled menu.
  const present = await Promise.all([
    access(avatarPreviewerTarget).then(() => true, () => false),
    access(chatActivityTarget).then(() => true, () => false),
  ]);
  if (present[0]) {
    const source = await readUtf8(avatarPreviewerTarget);
    if (/public\s+void\s+setData\s*\(\s*Data\s+data\s*\)/.test(source)) {
      const patched = patchAvatarPreviewer(source);
      if (await writeUtf8IfChanged(avatarPreviewerTarget, patched)) changedFiles.push(avatarPreviewerFile);
    }
  }
  if (present[1]) {
    const source = await readUtf8(chatActivityTarget);
    if (/public\s+boolean\s+didLongPressUserAvatar\s*\(/.test(source)
      && /public\s+void\s+onResume\s*\(\s*\)/.test(source)) {
      const patched = patchChatActivity(source);
      if (await writeUtf8IfChanged(chatActivityTarget, patched)) changedFiles.push(chatActivityFile);
    }
  }
  return changedFiles;
}
