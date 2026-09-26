import { describe, expect, it } from "vitest";

import {
  patchChatActivity,
  patchMenuItem,
  patchSelectionOverlay,
} from "../features/reactions/patch.js";

const chatActivity = `
import org.telegram.ui.Components.ItemOptions;

public class ChatActivity extends BaseFragment {
    @Override
    public void onResume() {
        super.onResume();
        checkShowBlur(false);
    }

    private boolean createMenu(MessageObject message) {
        final boolean isReactionsAvailable;
        if (message.isForwardedChannelPost()) {
            isReactionsAvailable = true;
        } else {
            isReactionsAvailable = !isSecretChat()
                && message.isReactionsAvailable()
                && (chatInfo != null && (
                    !(chatInfo.available_reactions instanceof TLRPC.TL_chatReactionsNone)
                    || chatInfo.paid_reactions_available)
                    || (chatInfo == null && !ChatObject.isChannel(currentChat))
                    || currentUser != null
                    || ChatObject.isMonoForum(currentChat)
                );
        }
        return isReactionsAvailable;
    }
}
`;

const itemMenu = `
import org.telegram.messenger.ConnectionsManager;

public class PollItemMenu {
    private void show() {
        final boolean isReactionsAvailable;
        isReactionsAvailable = !message.isSecretMedia() && chatActivity.getChatMode() != ChatActivity.MODE_QUICK_REPLIES && !chatActivity.isSecretChat() && !chatActivity.isInScheduleMode() && message.isReactionsAvailable() && (chatActivity.chatInfo != null && (!(chatActivity.chatInfo.available_reactions instanceof TLRPC.TL_chatReactionsNone) || chatActivity.chatInfo.paid_reactions_available) || (chatActivity.chatInfo == null && !ChatObject.isChannel(chatActivity.currentChat)) || chatActivity.currentUser != null || ChatObject.isMonoForum(chatActivity.currentChat)) && !availableReacts.isEmpty();
    }
}
`;

const selectionOverlay = `
import org.telegram.ui.ChatActivity;

public class ChatSelectionReactionMenuOverlay {
    public void setSelectedMessages(List<MessageObject> messages) {
        if (parentFragment.getChatMode() == ChatActivity.MODE_SCHEDULED || parentFragment.isReport() || parentFragment.isSecretChat() || parentFragment.getCurrentChatInfo() != null && parentFragment.getCurrentChatInfo().available_reactions instanceof TLRPC.TL_chatReactionsNone) {
            visible = false;
        }
    }
}
`;

describe("reaction support Android patch", () => {
  it("hides the private-chat reaction row the relay refuses", () => {
    const patched = patchChatActivity(chatActivity);
    expect(patched).toContain("import org.telegram.messenger.crossgram_reactions.CrossgramReactions;");
    expect(patched).toContain(
      "super.onResume();\n        CrossgramReactions.requestConversation(currentAccount, dialog_id);",
    );
    expect(patched).toContain(
      "|| (currentUser != null && CrossgramReactions.allowsConversation(currentAccount, dialog_id))",
    );
    // The group branch keeps upstream's own available_reactions check.
    expect(patched).toContain("|| chatInfo.paid_reactions_available)");
    expect(patchChatActivity(patched)).toBe(patched);
  });

  it("keeps the warm-up working when the poke patch already ran", () => {
    const withPoke = chatActivity.replace(
      "super.onResume();",
      "super.onResume();\n        CrossgramPoke.setConversation(currentAccount, dialog_id);",
    );
    const patched = patchChatActivity(withPoke);
    expect(patched).toContain(
      "super.onResume();\n        CrossgramReactions.requestConversation(currentAccount, dialog_id);\n        CrossgramPoke.setConversation(currentAccount, dialog_id);",
    );
  });

  it("guards the duplicated item-menu bypass", () => {
    const patched = patchMenuItem(itemMenu, "PollItemMenu.java");
    expect(patched).toContain(
      "|| (chatActivity.currentUser != null && CrossgramReactions.allowsConversation(chatActivity.getCurrentAccount(), chatActivity.dialog_id)) ||",
    );
    expect(patched).toContain("|| ChatObject.isMonoForum(chatActivity.currentChat))");
    expect(patchMenuItem(patched, "PollItemMenu.java")).toBe(patched);
  });

  it("guards the multi-select reaction overlay", () => {
    const patched = patchSelectionOverlay(selectionOverlay);
    expect(patched).toContain(
      "available_reactions instanceof TLRPC.TL_chatReactionsNone || !CrossgramReactions.allowsConversation(parentFragment.getCurrentAccount(), parentFragment.getDialogId()))",
    );
    expect(patchSelectionOverlay(patched)).toBe(patched);
  });
});
