import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { patchBrowser, patchSendMessagesHelper } from "../features/merged-forward/patch.js";

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
});
