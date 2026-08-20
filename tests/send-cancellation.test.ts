import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  adaptSendCancellationRuntime,
  patchSendMessagesHelper,
  topicIdFallbackArgument,
} from "../features/send-cancellation/patch.js";

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

describe("Android explicit send cancellation patch", () => {
  it("consumes cancellation confirmations before Telegram marks placeholders failed", () => {
    const patched = patchSendMessagesHelper(sendFixture);
    const consumeAt = patched.indexOf(
      "CrossgramSendCancellation.takeCancelledRandomIds(req.random_id, updates)",
    );
    const helperAt = patched.indexOf("private void cancelCrossgramSendingPlaceholders(");
    expect(consumeAt).toBeGreaterThan(patched.indexOf("TLRPC.Updates updates"));
    expect(helperAt).toBeGreaterThan(consumeAt);
    expect(patched).toContain("cancelledRandomIds.contains(message.random_id)");
    expect(patched).toContain("pendingMessages.remove(index)");
    expect(patched).toContain("pendingObjects.remove(index)");
    expect(patched).toContain("removeFromSendingMessages(id, scheduleDate != 0)");
    expect(patched).toContain('"CrossgramSendCancellation", "cancelled removed="');
    expect(patchSendMessagesHelper(patched)).toBe(patched);
  });

  it("keeps topic lookup compatible with old and new Telegram signatures", () => {
    const legacy = `public class MessageObject {
      public static long getTopicId(int currentAccount, TLRPC.Message message, boolean sureIsForum) { return 0; }
    }`;
    const current = `public class MessageObject {
      public static long getTopicId(int currentAccount, TLRPC.Message message, int sureIsForumTypeFlags) { return 0; }
      public static long getTopicId(int currentAccount, TLRPC.Message message, boolean sureIsForum) { return 0; }
    }`;
    expect(topicIdFallbackArgument(legacy)).toBe("false");
    expect(topicIdFallbackArgument(current)).toBe("0");
    expect(patchSendMessagesHelper(sendFixture, "false"))
      .toContain("MessageObject.getTopicId(currentAccount, message, false)");
    expect(patchSendMessagesHelper(sendFixture, "0"))
      .toContain("MessageObject.getTopicId(currentAccount, message, 0)");
  });

  it("uses updateMessageID id zero as a generic cancellation sentinel", async () => {
    const runtime = await readFile(path.resolve(
      "features/send-cancellation/files/java/org/telegram/messenger/crossgram_send/CrossgramSendCancellation.java",
    ), "utf8");
    expect(runtime).toContain("public static final int CANCELLED_MESSAGE_ID = 0");
    expect(runtime).toContain("confirmation.id != CANCELLED_MESSAGE_ID");
    expect(runtime).toContain("requestRandomIds.contains(confirmation.random_id)");
    expect(runtime).not.toContain("TL_messages_forwardMessages");
    expect(runtime).toContain("updates.updates.remove(index)");
    expect(runtime).not.toContain("bridgechat_");
  });

  it("supports both split TL_update classes and legacy TLRPC update classes", async () => {
    const runtime = await readFile(path.resolve(
      "features/send-cancellation/files/java/org/telegram/messenger/crossgram_send/CrossgramSendCancellation.java",
    ), "utf8");
    const split = adaptSendCancellationRuntime(runtime, true);
    const legacy = adaptSendCancellationRuntime(runtime, false);
    expect(split).toContain("import org.telegram.tgnet.tl.TL_update;");
    expect(split).toContain("TL_update.TL_updateMessageID");
    expect(legacy).not.toContain("org.telegram.tgnet.tl.TL_update");
    expect(legacy).not.toContain("TL_update.TL_");
    expect(legacy).toContain("TLRPC.TL_updateMessageID");
    expect(adaptSendCancellationRuntime(legacy, false)).toBe(legacy);
  });

  it("installs cancellation handling before merged-forward link handling", async () => {
    const cli = await readFile(path.resolve("src/cli.ts"), "utf8");
    expect(cli.indexOf("applySendCancellation(root, upstream)"))
      .toBeLessThan(cli.indexOf("applyMergedForward(root, upstream)"));
  });
});
