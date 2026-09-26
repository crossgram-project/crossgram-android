import { existsSync } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyPoke } from "../features/poke/patch.js";
import { applyReactions } from "../features/reactions/patch.js";
import { upstreams } from "../src/upstreams.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// The unit suite pins every edit against synthetic anchors; this runs the same
// patch against what the upstream actually ships, because the reaction gates are
// long one-line expressions that only exist there. Point
// CROSSGRAM_ANDROID_REACTIONS_SOURCE_ROOT at a prepared checkout, or let the
// local reference checkout stand in.
const reference = path.resolve("../work/references/nagram");
const configured = process.env.CROSSGRAM_ANDROID_REACTIONS_SOURCE_ROOT;
const sourceRoot = configured
  ?? (existsSync(path.join(reference, "TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java"))
    ? reference
    : undefined);

const relativePaths = [
  "TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java",
  "TMessagesProj/src/main/java/org/telegram/ui/PollItemMenu.java",
  "TMessagesProj/src/main/java/org/telegram/ui/TodoItemMenu.java",
  "TMessagesProj/src/main/java/org/telegram/ui/Components/Reactions/ChatSelectionReactionMenuOverlay.java",
  "TMessagesProj/src/main/java/org/telegram/tgnet/InputSerializedData.java",
];

describe.skipIf(!sourceRoot)("real upstream reaction gates", () => {
  it("patches the shipped sources idempotently", async () => {
    const temporaryRoot = path.resolve("../work/tests/reactions-android-e2e");
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(path.join(temporaryRoot, "fixture-"));
    roots.push(fixture);
    const root = path.join(fixture, "nagram");
    for (const relative of relativePaths) {
      const from = path.join(sourceRoot!, relative);
      if (!(await access(from).then(() => true, () => false))) continue;
      await cp(from, path.join(root, relative), { recursive: true });
    }
    const read = (relative: string) =>
      readFile(path.join(root, relative), "utf8").catch(() => "");

    // The CLI applies poke first, so the warm-up anchors already hold one line.
    const upstream = upstreams.find((item) => item.id === "nagram")!;
    await applyPoke(root, upstream);
    const changed = await applyReactions(root, upstream);

    const chat = await read("TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java");
    const poll = await read("TMessagesProj/src/main/java/org/telegram/ui/PollItemMenu.java");
    const todo = await read("TMessagesProj/src/main/java/org/telegram/ui/TodoItemMenu.java");
    const overlay = await read(
      "TMessagesProj/src/main/java/org/telegram/ui/Components/Reactions/ChatSelectionReactionMenuOverlay.java",
    );
    const helper = await read(
      "TMessagesProj/src/main/java/org/telegram/messenger/crossgram_reactions/CrossgramReactions.java",
    );

    expect(changed).toContain(
      "TMessagesProj/src/main/java/org/telegram/messenger/crossgram_reactions/CrossgramReactions.java",
    );
    expect(helper).toContain("GET_FEATURES_CONSTRUCTOR = 0xc3e6b915");
    expect(helper).toContain('optJSONObject("reactions")');
    expect(chat).toContain("CrossgramReactions.requestConversation(currentAccount, dialog_id);");
    expect(chat).toContain(
      "|| (currentUser != null && CrossgramReactions.allowsConversation(currentAccount, dialog_id))",
    );
    // The group branch keeps upstream's own available_reactions check.
    expect(chat).toContain("!(chatInfo.available_reactions instanceof TLRPC.TL_chatReactionsNone)");
    expect(poll).toContain(
      "|| (chatActivity.currentUser != null && CrossgramReactions.allowsConversation(chatActivity.getCurrentAccount(), chatActivity.dialog_id)) ||",
    );
    expect(todo).toContain("CrossgramReactions.allowsConversation(chatActivity.getCurrentAccount(), chatActivity.dialog_id)");
    expect(overlay).toContain(
      "available_reactions instanceof TLRPC.TL_chatReactionsNone || !CrossgramReactions.allowsConversation(parentFragment.getCurrentAccount(), parentFragment.getDialogId()))",
    );

    // Whatever the upstream calls its serialized-data interface, the helper has
    // to match the tree it is installed into.
    const modernStream = await access(
      path.join(root, "TMessagesProj/src/main/java/org/telegram/tgnet/InputSerializedData.java"),
    ).then(() => true, () => false);
    expect(helper.includes("AbstractSerializedData stream")).toBe(!modernStream);

    const before = [chat, poll, todo, overlay, helper];
    expect(await applyReactions(root, upstream)).toEqual([]);
    expect([
      await read("TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java"),
      await read("TMessagesProj/src/main/java/org/telegram/ui/PollItemMenu.java"),
      await read("TMessagesProj/src/main/java/org/telegram/ui/TodoItemMenu.java"),
      await read("TMessagesProj/src/main/java/org/telegram/ui/Components/Reactions/ChatSelectionReactionMenuOverlay.java"),
      await read("TMessagesProj/src/main/java/org/telegram/messenger/crossgram_reactions/CrossgramReactions.java"),
    ]).toEqual(before);
  }, 120_000);
});
