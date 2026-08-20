package org.telegram.messenger.crossgram_merged;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;

import org.telegram.messenger.FileLog;
import org.telegram.messenger.MessagesController;
import org.telegram.messenger.UserConfig;
import org.telegram.ui.ActionBar.BaseFragment;
import org.telegram.ui.ChatActivity;
import org.telegram.ui.LaunchActivity;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Opens Crossgram's synthetic merged-forward chats and optional message anchors. */
public final class CrossgramMergedForward {
    private static final Pattern LINK = Pattern.compile(
            "^https?://(?:www\\.)?t\\.me/bridgechat_([1-9][0-9]*)"
                    + "(?:/([1-9][0-9]*))?/?(?:[?#].*)?$",
            Pattern.CASE_INSENSITIVE);

    private CrossgramMergedForward() {}

    public static boolean openUrl(Context context, Uri uri) {
        final LinkTarget target = linkTarget(uri == null ? null : uri.toString());
        if (context == null || target == null) return false;
        final int account = UserConfig.selectedAccount;
        final MessagesController controller = MessagesController.getInstance(account);
        if (controller.getChat(target.chatId) != null) {
            openChat(controller, target);
            return true;
        }
        final String username = "bridgechat_" + target.chatId;
        controller.getUserNameResolver().resolve(username, peerId -> {
            if (peerId == null || peerId >= 0 || -peerId != target.chatId) {
                FileLog.e("crossgram_merged_forward_open_failed chat_id=" + target.chatId);
                return;
            }
            openChat(controller, target);
        });
        return true;
    }

    private static void openChat(MessagesController controller, LinkTarget target) {
        BaseFragment fragment = LaunchActivity.getSafeLastFragment();
        if (fragment == null) {
            FileLog.e("crossgram_merged_forward_open_failed chat_id=" + target.chatId
                    + " reason=no_fragment");
            return;
        }
        Bundle args = new Bundle();
        args.putLong("chat_id", target.chatId);
        if (target.messageId > 0) {
            args.putInt("message_id", target.messageId);
        }
        if (!controller.checkCanOpenChat(args, fragment)) {
            FileLog.e("crossgram_merged_forward_open_failed chat_id=" + target.chatId
                    + " reason=chat_rejected");
            return;
        }
        fragment.presentFragment(new ChatActivity(args));
        FileLog.d("crossgram_merged_forward_opened chat_id=" + target.chatId
                + " message_id=" + target.messageId);
        android.util.Log.d("CrossgramMergedForward", "opened chat_id=" + target.chatId
                + " message_id=" + target.messageId);
    }

    private static LinkTarget linkTarget(String url) {
        if (url == null) return null;
        Matcher matcher = LINK.matcher(url);
        if (!matcher.matches()) return null;
        try {
            long chatId = Long.parseLong(matcher.group(1));
            int messageId = matcher.group(2) == null ? 0 : Integer.parseInt(matcher.group(2));
            return chatId > 0 ? new LinkTarget(chatId, messageId) : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static final class LinkTarget {
        final long chatId;
        final int messageId;

        LinkTarget(long chatId, int messageId) {
            this.chatId = chatId;
            this.messageId = messageId;
        }
    }
}
