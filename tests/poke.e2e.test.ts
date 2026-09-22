import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyPoke } from "../features/poke/patch.js";
import { upstreams } from "../src/upstreams.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Point this at prepared source snapshots, one directory per upstream id, each
// holding the files this patch reads and writes:
//
//   TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java
//   TMessagesProj/src/main/java/org/telegram/ui/AvatarPreviewer.java
//   TMessagesProj/src/main/java/org/telegram/tgnet/InputSerializedData.java
//     (skip this one to exercise the AbstractSerializedData contract)
//
// The unit suite pins every edit against synthetic anchors; this runs the same
// patch against what the upstreams actually ship, because the avatar previewer
// menu and the long-press avatar handler only exist there.
const sourceRoot = process.env.CROSSGRAM_ANDROID_POKE_SOURCE_ROOT;
const relativePaths = [
  "TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java",
  "TMessagesProj/src/main/java/org/telegram/ui/AvatarPreviewer.java",
  "TMessagesProj/src/main/java/org/telegram/tgnet/InputSerializedData.java",
];

describe.skipIf(!sourceRoot)("real upstream poke menus", () => {
  it.each(upstreams)("patches $id sources idempotently", async (upstream) => {
    const snapshot = path.join(sourceRoot!, upstream.id);
    const available = await access(snapshot).then(() => true, () => false);
    // Snapshots exist only for the upstreams an operator prepared; the CI build
    // matrix still compiles every fork that release.yml builds.
    if (!available) return;
    const temporaryRoot = path.resolve("../work/tests/poke-android-e2e");
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(path.join(temporaryRoot, "fixture-"));
    roots.push(fixture);
    const root = path.join(fixture, upstream.id);
    for (const relative of relativePaths) {
      const from = path.join(snapshot, relative);
      if (!(await access(from).then(() => true, () => false))) continue;
      await cp(from, path.join(root, relative), { recursive: true });
    }
    const read = (relative: string) =>
      readFile(path.join(root, relative), "utf8").catch(() => "");

    const changed = await applyPoke(root, upstream);
    const chat = await read("TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java");
    const previewer = await read("TMessagesProj/src/main/java/org/telegram/ui/AvatarPreviewer.java");
    const helper = await read("TMessagesProj/src/main/java/org/telegram/messenger/crossgram_poke/CrossgramPoke.java");

    expect(changed).toContain("TMessagesProj/src/main/java/org/telegram/messenger/crossgram_poke/CrossgramPoke.java");
    expect(helper).toContain("GET_FEATURES_CONSTRUCTOR = 0xc3e6b915");
    expect(helper).toContain("SEND_POKE_CONSTRUCTOR = 0x9a2d47f0");
    expect(chat).toContain("import org.telegram.messenger.crossgram_poke.CrossgramPoke;");
    expect(chat).toContain("CrossgramPoke.setConversation(currentAccount, dialog_id);");
    expect(previewer).toContain("CrossgramPoke.appendMenu(menu, data.parentObject, resourcesProvider, () -> setData(data));");
    expect(previewer).toContain("!CrossgramPoke.keepsMenuLast(data.parentObject)");
    // Whatever the upstream calls its serialized-data interface, the helper has
    // to match the tree it is installed into.
    const modernStream = await access(
      path.join(root, "TMessagesProj/src/main/java/org/telegram/tgnet/InputSerializedData.java"),
    ).then(() => true, () => false);
    expect(helper.includes("AbstractSerializedData stream")).toBe(!modernStream);

    const before = [chat, previewer, helper];
    expect(await applyPoke(root, upstream)).toEqual([]);
    expect([
      await read("TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java"),
      await read("TMessagesProj/src/main/java/org/telegram/ui/AvatarPreviewer.java"),
      await read("TMessagesProj/src/main/java/org/telegram/messenger/crossgram_poke/CrossgramPoke.java"),
    ]).toEqual(before);
  }, 120_000);
});
