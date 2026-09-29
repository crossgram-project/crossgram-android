import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { patchBrowser, patchMessagesController } from "../features/merged-forward/patch.js";

/** The dialog prefetch branch of loadMessagesInternal, in both upstream shapes. */
function controllerFixture(condition: string): string {
  return `package org.telegram.messenger;
import android.os.Bundle;
import org.telegram.tgnet.TLRPC;
public class MessagesController {
    private void loadMessagesInternal(long dialogId, boolean loadDialog, int load_type, int last_message_id, TLRPC.Chat chat) {
            } else {
                if (${condition}) {
                    TLRPC.TL_messages_getPeerDialogs req = new TLRPC.TL_messages_getPeerDialogs();
                    return;
                }
                TLRPC.TL_messages_getHistory req = new TLRPC.TL_messages_getHistory();
            }
    }
}
`;
}

const forkCondition = "!ChatObject.isMonoForum(chat) && loadDialog && (load_type == LOAD_AROUND_MESSAGE || load_type == LOAD_FROM_UNREAD) && last_message_id == 0";
const telegramCondition = "loadDialog && (load_type == LOAD_AROUND_MESSAGE || load_type == LOAD_FROM_UNREAD) && last_message_id == 0";

/** Every upstream checkout the patcher builds, when one is available locally. */
const upstreamControllers = [
  "upstream-check/nagram", "upstream-check/telegram", "upstream-check/nnngram",
  "upstream-check/nullgram", "mercurygram", "forkgram",
].map((relative) => path.resolve(
  "..", "work", "references", relative,
  "TMessagesProj/src/main/java/org/telegram/messenger/MessagesController.java",
));

const browserFixture = `package org.telegram.messenger.browser;
import android.content.Context;
import android.net.Uri;
public class Browser {
    public static void openUrl(Context context, Uri uri) {
        if (context == null || uri == null) {
            return;
        }
    }
}
`;

function compiledLinkPattern(runtime: string): RegExp {
  const expression = runtime.match(
    /Pattern\.compile\(\s*((?:"(?:\\.|[^"\\])*"\s*(?:\+\s*)?)+),\s*Pattern\.CASE_INSENSITIVE/,
  )?.[1];
  if (!expression) throw new Error("Crossgram merged-forward link pattern is missing");
  const literals = [...expression.matchAll(/"((?:\\.|[^"\\])*)"/g)];
  const pattern = literals.map((match) => JSON.parse(`"${match[1]}"`) as string).join("");
  return new RegExp(pattern, "i");
}

describe("Android merged-forward link patch", () => {
  it("routes synthetic links before Telegram's generic browser handler", () => {
    const patched = patchBrowser(browserFixture);
    expect(patched).toContain("CrossgramMergedForward.openUrl(context, uri)");
    expect(patchBrowser(patched)).toBe(patched);
  });

  it("accepts both chat-only and message-anchored merged-forward links", async () => {
    const runtime = await readFile(path.resolve(
      "features/merged-forward/files/java/org/telegram/messenger/crossgram_merged/CrossgramMergedForward.java",
    ), "utf8");
    const pattern = compiledLinkPattern(runtime);

    // The relay renamed the shape from "bridgechat_" to "bridgebundle_"; both
    // are still addressable, and the matched prefix is what the resolver uses.
    expect(pattern.exec("https://t.me/bridgebundle_123")?.slice(1))
      .toEqual(["bridgebundle", "123", undefined]);
    expect(pattern.exec("https://t.me/bridgebundle_123/456")?.slice(1))
      .toEqual(["bridgebundle", "123", "456"]);
    expect(pattern.exec("https://www.t.me/bridgebundle_123/456/?single")?.slice(1))
      .toEqual(["bridgebundle", "123", "456"]);
    expect(pattern.exec("https://t.me/bridgechat_123/456")?.slice(1))
      .toEqual(["bridgechat", "123", "456"]);
    expect(pattern.test("https://t.me/bridgebundle_0/456")).toBe(false);
    expect(pattern.test("https://t.me/bridgebundle_123/0")).toBe(false);
    expect(pattern.test("https://t.me/bridgebundle_123/456/789")).toBe(false);
    expect(pattern.test("https://t.me/chatbundle_123")).toBe(false);
  });

  it("passes the deep-link message ID to ChatActivity", async () => {
    const runtime = await readFile(path.resolve(
      "features/merged-forward/files/java/org/telegram/messenger/crossgram_merged/CrossgramMergedForward.java",
    ), "utf8");
    expect(runtime).toContain("target.usernamePrefix + target.chatId");
    expect(runtime).toContain('args.putLong("chat_id", target.chatId)');
    expect(runtime).toContain('args.putInt("message_id", target.messageId)');
    expect(runtime).toContain('" message_id=" + target.messageId');
    expect(runtime).not.toContain("confirmedRandomId");
  });

  it("loads transcript history without the dialog prefetch in both upstream shapes", () => {
    for (const condition of [forkCondition, telegramCondition]) {
      const patched = patchMessagesController(controllerFixture(condition));
      expect(patched).toContain("import org.telegram.messenger.crossgram_merged.CrossgramMergedForward;");
      expect(patched).toContain(
        `if (${condition} && !CrossgramMergedForward.isTranscriptDialog(dialogId)) {`,
      );
      // The history request itself is untouched: skipping the prefetch makes
      // the anchored load fall through to messages.getHistory.
      expect(patched).toContain("TLRPC.TL_messages_getHistory req = new TLRPC.TL_messages_getHistory();");
      expect(patchMessagesController(patched)).toBe(patched);
    }
  });

  it("fails loudly when the dialog prefetch anchor drifts", () => {
    expect(() => patchMessagesController(controllerFixture("loadDialog && last_message_id == 0")))
      .toThrow(/expected one semantic match, found 0/);
  });

  it("finds exactly one prefetch anchor in every upstream it builds", async () => {
    const available = upstreamControllers.filter((file) => existsSync(file));
    for (const file of available) {
      const patched = patchMessagesController(await readFile(file, "utf8"));
      expect(patched.match(/!CrossgramMergedForward\.isTranscriptDialog\(dialogId\)/g), file).toHaveLength(1);
    }
  });

  it("records transcript chats before opening them and exposes them by dialog id", async () => {
    const runtime = await readFile(path.resolve(
      "features/merged-forward/files/java/org/telegram/messenger/crossgram_merged/CrossgramMergedForward.java",
    ), "utf8");
    expect(runtime).toContain("public static boolean isTranscriptDialog(long dialogId)");
    expect(runtime).toContain("return dialogId < 0 && TRANSCRIPT_CHATS.contains(-dialogId);");
    // Marking must happen before either open path (cached chat or resolved username).
    const marked = runtime.indexOf("markTranscriptChat(target.chatId);");
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThan(runtime.indexOf("controller.getChat(target.chatId) != null"));
    expect(marked).toBeLessThan(runtime.indexOf("getUserNameResolver().resolve("));
  });
});
