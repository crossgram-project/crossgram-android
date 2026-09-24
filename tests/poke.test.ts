import { describe, expect, it } from "vitest";

import { patchAvatarPreviewer, patchChatActivity } from "../features/poke/patch.js";

const avatarPreviewer = `
import org.telegram.ui.ActionBar.ActionBarMenuItem;
import org.telegram.ui.ActionBar.Theme;

public class AvatarPreviewer {
    private static abstract class Layout extends FrameLayout {
        public void setData(Data data) {
            menuItems = data.menuItems;
            menu.removeInnerViews();
            for (int i = 0; i < menuItems.length; i++) {
                final MenuItem menuItem = menuItems[i];
                CharSequence label = LocaleController.getString(menuItem.labelKey, menuItem.labelResId);
                ActionBarMenuItem item = null;
                ActionBarMenuSubItem itemView = ActionBarMenuItem.addItem(i == 0, i == menuItems.length - 1, menu, menuItem.iconResId, label, false, resourcesProvider);
                itemView.setTag(i);
            }

            setShowing(true);
        }
        private void setShowing(boolean showing) {
        }
    }
}
`;

const chatActivity = `
import org.telegram.ui.Components.ItemOptions;

public class ChatActivity extends BaseFragment {
    @Override
    public void onResume() {
        super.onResume();
        checkShowBlur(false);
    }

    @Override
    public boolean didLongPressUserAvatar(ChatMessageCell cell, TLRPC.User user, float touchX, float touchY) {
        if (isAvatarPreviewerEnabled()) {
            if (AvatarPreviewer.canPreview(data)) {
                AvatarPreviewer.getInstance().show((ViewGroup) fragmentView, themeDelegate, data, item -> {
                });
                return true;
            } else {
                ItemOptions.makeOptions(ChatActivity.this, cell)
                    .add(R.drawable.msg_openprofile, getString(R.string.OpenProfile), () -> {
                        openProfile(user);
                    })
                    .setDrawScrim(false)
                    .show();
                return true;
            }
        }
        return false;
    }
}
`;

describe("poke Android patch", () => {
  it("adds the previewer rows and keeps the menu rounding correct", () => {
    const patched = patchAvatarPreviewer(avatarPreviewer);
    expect(patched).toContain("import org.telegram.messenger.crossgram_poke.CrossgramPoke;");
    expect(patched).toContain("!CrossgramPoke.keepsMenuLast(data.parentObject)");
    expect(patched).toContain(
      "CrossgramPoke.appendMenu(menu, data.parentObject, resourcesProvider, () -> setData(data));",
    );
    expect(patched.indexOf("CrossgramPoke.appendMenu(")).toBeLessThan(patched.indexOf("setShowing(true);"));
    expect(patchAvatarPreviewer(patched)).toBe(patched);
  });

  it("wires the chat screen to the conversation and to the fallback menu", () => {
    const patched = patchChatActivity(chatActivity);
    expect(patched).toContain("import org.telegram.messenger.crossgram_poke.CrossgramPoke;");
    expect(patched).toContain("super.onResume();\n        CrossgramPoke.setConversation(currentAccount, dialog_id);\n        checkShowBlur(false);");
    expect(patched.match(/CrossgramPoke.setConversation\(currentAccount, dialog_id\);/g)).toHaveLength(1);
    // Upstream builds that menu as one fluent chain, so the poke row has to be
    // inserted without breaking it: the helper hands the same ItemOptions back.
    expect(patched).toMatch(
      /CrossgramPoke\.appendOptions\(ItemOptions\.makeOptions\(ChatActivity\.this, cell\), user\)\s*\n\s*\.add\(/,
    );
    expect(patched).toContain(".setDrawScrim(false)\n                    .show();");
    expect(patchChatActivity(patched)).toBe(patched);
  });

  it("keeps upstreams without the fallback menu patched", () => {
    const withoutOptions = chatActivity.replace(/ItemOptions\.makeOptions[\s\S]*?\.show\(\)/, "return false");
    const patched = patchChatActivity(withoutOptions);
    expect(patched).toContain("CrossgramPoke.setConversation(currentAccount, dialog_id);");
    expect(patched).not.toContain("CrossgramPoke.appendOptions(");
  });
});
