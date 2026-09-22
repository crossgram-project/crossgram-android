package org.telegram.messenger.crossgram_poke;

import android.view.View;

import org.json.JSONObject;
import org.telegram.messenger.FileLog;
import org.telegram.messenger.MessagesController;
import org.telegram.messenger.R;
import org.telegram.tgnet.ConnectionsManager;
import org.telegram.tgnet.InputSerializedData;
import org.telegram.tgnet.OutputSerializedData;
import org.telegram.tgnet.TLObject;
import org.telegram.tgnet.TLRPC;
import org.telegram.ui.ActionBar.ActionBarMenuItem;
import org.telegram.ui.ActionBar.ActionBarMenuSubItem;
import org.telegram.ui.ActionBar.ActionBarPopupWindow;
import org.telegram.ui.ActionBar.Theme;
import org.telegram.ui.Components.ItemOptions;

import java.util.Map;
import java.util.WeakHashMap;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Crossgram poke (the QQ "nudge") entry for the avatar menus of Telegram Android.
 *
 * The relay decides whether the entry exists: the client asks
 * `crossgram.getFeatures` for the conversation and only then offers the action,
 * so official Telegram servers never show it. Tapping sends one poke; holding
 * the row expands the 1/5/10 burst rows, the touch equivalent of the desktop
 * submenu arrow.
 */
public final class CrossgramPoke {
    private static final int GET_FEATURES_CONSTRUCTOR = 0xc3e6b915;
    private static final int SEND_POKE_CONSTRUCTOR = 0x9a2d47f0;
    /** The poke label; escapes keep the source ASCII for any compiler code page. */
    private static final String POKE_LABEL = "\u6233\u4e00\u6233";
    /** The burst suffix, " times"; escapes keep the source ASCII. */
    private static final String COUNT_SUFFIX = " \u6b21";
    private static final int[] BURST_COUNTS = new int[]{1, 5, 10};

    /** An unanswered probe is repeated no faster than this. */
    private static final long PROBE_RETRY_MS = 60 * 1000L;

    private static final Map<String, Integer> MAX_COUNTS = new ConcurrentHashMap<>();
    private static final Set<String> REJECTED = ConcurrentHashMap.newKeySet();
    private static final Set<Integer> UNAVAILABLE_ACCOUNTS = ConcurrentHashMap.newKeySet();
    private static final Map<String, Long> PROBED_AT = new ConcurrentHashMap<>();
    private static final Map<View, Object> EXPANDED_FOR = new WeakHashMap<>();

    private static int conversationAccount = -1;
    private static long conversationDialogId = 0;
    private static Object conversationTag;

    private CrossgramPoke() {
    }

    /** Remember which chat owns the avatar menu that is about to be shown. */
    public static void setConversation(int account, long dialogId) {
        if (account == conversationAccount && dialogId == conversationDialogId) {
            return;
        }
        conversationAccount = account;
        conversationDialogId = dialogId;
        conversationTag = new Object();
        if (dialogId != 0) {
            requestFeatures(account, dialogId);
        }
    }

    /** True when the poke row will be appended, so the caller keeps its own last-row rounding. */
    public static boolean keepsMenuLast(Object parentObject) {
        return maxCount(
                parentObject instanceof TLRPC.User ? (TLRPC.User) parentObject : null,
                conversationAccount,
                conversationDialogId) > 0;
    }

    public static void appendMenu(
            ActionBarPopupWindow.ActionBarPopupWindowLayout menu,
            Object parentObject,
            Theme.ResourcesProvider resourcesProvider,
            Runnable rebuild) {
        final TLRPC.User user = parentObject instanceof TLRPC.User ? (TLRPC.User) parentObject : null;
        final int account = conversationAccount;
        final long dialogId = conversationDialogId;
        final int maxCount = maxCount(user, account, dialogId);
        if (maxCount <= 0) {
            return;
        }
        final boolean expanded = EXPANDED_FOR.get(menu) == conversationTag;
        final ActionBarMenuSubItem item = ActionBarMenuItem.addItem(false, !expanded, menu, R.drawable.msg_mention, POKE_LABEL, false, resourcesProvider);
        item.setOnClickListener(v -> send(user, account, dialogId, 1));
        item.setOnLongClickListener(v -> {
            if (expanded) {
                EXPANDED_FOR.remove(menu);
            } else {
                EXPANDED_FOR.put(menu, conversationTag);
            }
            rebuild.run();
            return true;
        });
        if (!expanded) {
            return;
        }
        for (int index = 0; index < BURST_COUNTS.length; index++) {
            final int count = BURST_COUNTS[index];
            if (count > maxCount) {
                continue;
            }
            final ActionBarMenuSubItem burst = ActionBarMenuItem.addItem(false, index == BURST_COUNTS.length - 1, menu, 0, count + COUNT_SUFFIX, false, resourcesProvider);
            burst.setOnClickListener(v -> send(user, account, dialogId, count));
        }
    }

    /** Add the single-poke row to the small avatar menu used when no previewer is possible. */
    public static void appendOptions(ItemOptions options, TLRPC.User user) {
        final int account = conversationAccount;
        final long dialogId = conversationDialogId;
        if (maxCount(user, account, dialogId) <= 0) {
            return;
        }
        options.add(R.drawable.msg_mention, POKE_LABEL, () -> send(user, account, dialogId, 1));
    }

    private static int maxCount(TLRPC.User user, int account, long dialogId) {
        if (user == null || account < 0 || dialogId == 0) {
            return 0;
        } else if (UNAVAILABLE_ACCOUNTS.contains(account)) {
            return 0;
        }
        final String key = account + ":" + dialogId;
        if (REJECTED.contains(key)) {
            return 0;
        }
        final Integer maxCount = MAX_COUNTS.get(key);
        if (maxCount != null) {
            return maxCount;
        }
        final Long probedAt = PROBED_AT.get(key);
        if (probedAt == null || System.currentTimeMillis() - probedAt >= PROBE_RETRY_MS) {
            requestFeatures(account, dialogId);
        }
        return 0;
    }

    private static void requestFeatures(int account, long dialogId) {
        if (UNAVAILABLE_ACCOUNTS.contains(account)) {
            return;
        }
        final String key = account + ":" + dialogId;
        final Long probedAt = PROBED_AT.get(key);
        if (probedAt != null && System.currentTimeMillis() - probedAt < PROBE_RETRY_MS) {
            return;
        }
        final TLRPC.InputPeer peer = MessagesController.getInstance(account).getInputPeer(dialogId);
        if (peer == null || peer instanceof TLRPC.TL_inputPeerEmpty) {
            return;
        }
        PROBED_AT.put(key, System.currentTimeMillis());
        final GetFeatures request = new GetFeatures();
        request.peer = peer;
        ConnectionsManager.getInstance(account).sendRequest(request, (response, error) -> {
            if (response instanceof TLRPC.TL_dataJSON) {
                try {
                    final JSONObject poke = new JSONObject(((TLRPC.TL_dataJSON) response).data).optJSONObject("poke");
                    final int maxCount = poke != null ? poke.optInt("maxCount", 0) : 0;
                    if (maxCount > 0) {
                        MAX_COUNTS.put(key, maxCount);
                    } else {
                        REJECTED.add(key);
                    }
                } catch (Exception parseError) {
                    FileLog.e(parseError);
                    REJECTED.add(key);
                }
                return;
            }
            final String text = error != null ? error.text : "FEATURES_FAILED";
            FileLog.d("crossgram poke features " + key + " -> " + text);
            if (error != null && error.code > 0) {
                // The server answered without knowing the method: this account is
                // not on a relay with poke support, so stop asking.
                UNAVAILABLE_ACCOUNTS.add(account);
            }
            REJECTED.add(key);
        });
    }

    private static void send(TLRPC.User user, int account, long dialogId, int count) {
        if (user == null || account < 0 || dialogId == 0 || count <= 0) {
            return;
        }
        final TLRPC.InputPeer peer = MessagesController.getInstance(account).getInputPeer(dialogId);
        final TLRPC.InputUser target = MessagesController.getInstance(account).getInputUser(user);
        if (peer == null || peer instanceof TLRPC.TL_inputPeerEmpty || target == null) {
            return;
        }
        final SendPoke request = new SendPoke();
        request.peer = peer;
        request.user = target;
        request.count = count;
        // The relay publishes QQ's own poke notice as a message update, so a
        // successful poke needs no further UI and a failure stays in the log.
        ConnectionsManager.getInstance(account).sendRequest(request, (response, error) -> {
            if (error != null) {
                FileLog.d("crossgram poke failed: " + error.text);
            }
        });
    }

    /** `crossgram.getFeatures#c3e6b915 peer:InputPeer = DataJSON`. */
    private static final class GetFeatures extends TLObject {
        TLRPC.InputPeer peer;

        @Override
        public TLObject deserializeResponse(InputSerializedData stream, int constructor, boolean exception) {
            return TLRPC.TL_dataJSON.TLdeserialize(stream, constructor, exception);
        }

        @Override
        public void serializeToStream(OutputSerializedData stream) {
            stream.writeInt32(GET_FEATURES_CONSTRUCTOR);
            peer.serializeToStream(stream);
        }
    }

    /** `crossgram.sendPoke#9a2d47f0 peer:InputPeer user_id:InputUser count:int = Bool`. */
    private static final class SendPoke extends TLObject {
        TLRPC.InputPeer peer;
        TLRPC.InputUser user;
        int count;

        @Override
        public TLObject deserializeResponse(InputSerializedData stream, int constructor, boolean exception) {
            return TLRPC.Bool.TLdeserialize(stream, constructor, exception);
        }

        @Override
        public void serializeToStream(OutputSerializedData stream) {
            stream.writeInt32(SEND_POKE_CONSTRUCTOR);
            peer.serializeToStream(stream);
            user.serializeToStream(stream);
            stream.writeInt32(count);
        }
    }
}
