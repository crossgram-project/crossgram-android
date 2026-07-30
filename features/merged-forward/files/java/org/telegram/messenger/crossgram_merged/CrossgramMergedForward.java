package org.telegram.messenger.crossgram_merged;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;

import org.telegram.messenger.FileLog;
import org.telegram.messenger.MessageObject;
import org.telegram.messenger.MessagesController;
import org.telegram.messenger.UserConfig;
import org.telegram.tgnet.TLRPC;
import org.telegram.tgnet.tl.TL_update;
import org.telegram.ui.ActionBar.BaseFragment;
import org.telegram.ui.ChatActivity;
import org.telegram.ui.LaunchActivity;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Compatibility glue for QQ's many-to-one merged-forward result. */
public final class CrossgramMergedForward {
    private static final Pattern LINK = Pattern.compile(
            "^https?://(?:www\\.)?t\\.me/bridgechat_([1-9][0-9]*)/?(?:[?#].*)?$",
            Pattern.CASE_INSENSITIVE);

    private CrossgramMergedForward() {}

    public static long confirmedRandomId(
            TLRPC.TL_messages_forwardMessages request,
            TLRPC.Updates updates) {
        if (request == null || updates == null || request.id.size() <= 1
                || request.id.size() != request.random_id.size()) {
            return 0;
        }
        TL_update.TL_updateMessageID confirmation = null;
        TLRPC.Message delivered = null;
        int deliveredCount = 0;
        for (TLRPC.Update update : updates.updates) {
            if (update instanceof TL_update.TL_updateMessageID) {
                if (confirmation != null) return 0;
                confirmation = (TL_update.TL_updateMessageID) update;
            } else {
                TLRPC.Message message = deliveredMessage(update);
                if (message != null) {
                    delivered = message;
                    deliveredCount++;
                }
            }
        }
        if (confirmation == null || deliveredCount != 1 || !isMergedForwardMessage(delivered)
                || !request.random_id.contains(confirmation.random_id)) {
            return 0;
        }
        return confirmation.random_id;
    }

    public static boolean openUrl(Context context, Uri uri) {
        final long chatId = chatId(uri == null ? null : uri.toString());
        if (context == null || chatId <= 0) return false;
        final int account = UserConfig.selectedAccount;
        final MessagesController controller = MessagesController.getInstance(account);
        if (controller.getChat(chatId) != null) {
            openChat(controller, chatId);
            return true;
        }
        final String username = "bridgechat_" + chatId;
        controller.getUserNameResolver().resolve(username, peerId -> {
            if (peerId == null || peerId >= 0 || -peerId != chatId) {
                FileLog.e("crossgram_merged_forward_open_failed chat_id=" + chatId);
                return;
            }
            openChat(controller, chatId);
        });
        return true;
    }

    private static void openChat(MessagesController controller, long chatId) {
        BaseFragment fragment = LaunchActivity.getSafeLastFragment();
        if (fragment == null) {
            FileLog.e("crossgram_merged_forward_open_failed chat_id=" + chatId + " reason=no_fragment");
            return;
        }
        Bundle args = new Bundle();
        args.putLong("chat_id", chatId);
        if (!controller.checkCanOpenChat(args, fragment)) {
            FileLog.e("crossgram_merged_forward_open_failed chat_id=" + chatId + " reason=chat_rejected");
            return;
        }
        fragment.presentFragment(new ChatActivity(args));
        FileLog.d("crossgram_merged_forward_opened chat_id=" + chatId);
        android.util.Log.d("CrossgramMergedForward", "opened chat_id=" + chatId);
    }

    private static long chatId(String url) {
        if (url == null) return 0;
        Matcher matcher = LINK.matcher(url);
        if (!matcher.matches()) return 0;
        try {
            long value = Long.parseLong(matcher.group(1));
            return value > 0 ? value : 0;
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static boolean isMergedForwardMessage(TLRPC.Message message) {
        return message != null && message.media != null && message.media.webpage != null
                && chatId(message.media.webpage.url) > 0;
    }

    private static TLRPC.Message deliveredMessage(TLRPC.Update update) {
        if (update instanceof TL_update.TL_updateNewMessage) {
            return ((TL_update.TL_updateNewMessage) update).message;
        }
        if (update instanceof TL_update.TL_updateNewChannelMessage) {
            return ((TL_update.TL_updateNewChannelMessage) update).message;
        }
        if (update instanceof TL_update.TL_updateNewScheduledMessage) {
            return ((TL_update.TL_updateNewScheduledMessage) update).message;
        }
        if (update instanceof TL_update.TL_updateQuickReplyMessage) {
            return ((TL_update.TL_updateQuickReplyMessage) update).message;
        }
        return null;
    }
}
