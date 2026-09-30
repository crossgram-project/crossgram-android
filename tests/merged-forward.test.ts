import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { patchBrowser } from "../features/merged-forward/patch.js";

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
});
