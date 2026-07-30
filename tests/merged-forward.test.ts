import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  adaptMergedForwardRuntime,
  patchBrowser,
  patchSendMessagesHelper,
  topicIdFallbackArgument,
} from "../features/merged-forward/patch.js";

const sendFixture = `package org.telegram.messenger;
import org.telegram.tgnet.TLRPC;
public class SendMessagesHelper {
    void send(TLRPC.TL_messages_forwardMessages req, Object response, int scheduleDate,
            ArrayList<TLRPC.Message> newMsgObjArr, ArrayList<MessageObject> newMsgArr) {
        TLRPC.Updates updates = (TLRPC.Updates) response;
    }
    protected void processSentMessage(int id) {}
}
`;

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

describe("Android merged-forward patch", () => {
  it("collapses extra send placeholders idempotently", () => {
    const patched = patchSendMessagesHelper(sendFixture);
    expect(patched).toContain("CrossgramMergedForward.confirmedRandomId(req, updates)");
    expect(patched).toContain("collapseCrossgramMergedForwardPlaceholders(");
    expect(patched).toContain("deleteMessages(\n                    removedIds");
    expect(patched).toContain("removeFromSendingMessages(id, scheduleDate != 0)");
    expect(patchSendMessagesHelper(patched)).toBe(patched);
  });

  it("adapts the topic fallback to old and new MessageObject signatures", () => {
    const legacy = `public class MessageObject {
      public static long getTopicId(int currentAccount, TLRPC.Message message, boolean sureIsForum) { return 0; }
    }`;
    const current = `public class MessageObject {
      public static long getTopicId(int currentAccount, TLRPC.Message message, int sureIsForumTypeFlags) { return 0; }
      public static long getTopicId(int currentAccount, TLRPC.Message message, boolean sureIsForum) { return 0; }
    }`;
    expect(topicIdFallbackArgument(legacy)).toBe("false");
    expect(topicIdFallbackArgument(current)).toBe("0");
    expect(patchSendMessagesHelper(sendFixture, "false")).toContain(
      "MessageObject.getTopicId(currentAccount, message, false)",
    );
    expect(patchSendMessagesHelper(sendFixture, "0")).toContain(
      "MessageObject.getTopicId(currentAccount, message, 0)",
    );
  });

  it("routes synthetic links before Telegram's generic browser handler", () => {
    const patched = patchBrowser(browserFixture);
    expect(patched).toContain("CrossgramMergedForward.openUrl(context, uri)");
    expect(patchBrowser(patched)).toBe(patched);
  });

  it("keeps merged-result detection scoped to Crossgram cards", async () => {
    const runtime = await readFile(path.resolve(
      "features/merged-forward/files/java/org/telegram/messenger/crossgram_merged/CrossgramMergedForward.java",
    ), "utf8");
    expect(runtime).toContain("request.id.size() <= 1");
    expect(runtime).toContain("bridgechat_([1-9][0-9]*)");
    expect(runtime).toContain("deliveredCount != 1");
    expect(runtime).toContain("request.random_id.contains(confirmation.random_id)");
  });

  it("supports both split TL_update classes and legacy TLRPC update classes", async () => {
    const runtime = await readFile(path.resolve(
      "features/merged-forward/files/java/org/telegram/messenger/crossgram_merged/CrossgramMergedForward.java",
    ), "utf8");
    const split = adaptMergedForwardRuntime(runtime, true);
    const legacy = adaptMergedForwardRuntime(runtime, false);
    expect(split).toContain("import org.telegram.tgnet.tl.TL_update;");
    expect(split).toContain("TL_update.TL_updateMessageID");
    expect(legacy).not.toContain("org.telegram.tgnet.tl.TL_update");
    expect(legacy).not.toContain("TL_update.TL_");
    expect(legacy).toContain("TLRPC.TL_updateMessageID");
    expect(adaptMergedForwardRuntime(legacy, false)).toBe(legacy);
  });
});
