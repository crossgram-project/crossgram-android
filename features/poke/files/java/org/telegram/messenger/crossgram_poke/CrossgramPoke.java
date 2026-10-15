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
 * 头像长按菜单中的「戳一戳」入口。
 *
 * 先向服务端请求 `crossgram.getFeatures` 探测当前会话是否支持戳一戳（官方 Telegram 服务端不会显示该项）。
 * 单击发送 1 次，长按展开 1/5/10 连戳子项。
 */
public final class CrossgramPoke {
    private static final int GET_FEATURES_CONSTRUCTOR = 0xc3e6b915;
    private static final int SEND_POKE_CONSTRUCTOR = 0x9a2d47f0;
    /** 「戳一戳」，使用 Unicode 转义保证任意编译器编码下源码均为纯 ASCII。 */
    private static final String POKE_LABEL = "\u6233\u4e00\u6233";
    /** 连戳后缀「 次」，使用 Unicode 转义保持纯 ASCII。 */
    private static final String COUNT_SUFFIX = " \u6b21";
    private static final int[] BURST_COUNTS = new int[]{1, 5, 10};

    /** 探测请求未收到响应时的最小重试间隔。 */
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

    /** 记录当前聊天会话，供随后弹出的头像菜单使用。 */
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

    /** 若后续会追加「戳一戳」菜单项则返回 true，避免上游原末项提前绘制底部圆角。 */
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

    /**
     * 在不支持全屏头像预览的降级 ItemOptions 菜单中追加单次「戳一戳」，并原样返回 options 以保持上游链式调用。
     */
    public static ItemOptions appendOptions(ItemOptions options, TLRPC.User user) {
        final int account = conversationAccount;
        final long dialogId = conversationDialogId;
        if (maxCount(user, account, dialogId) > 0) {
            options.add(R.drawable.msg_mention, POKE_LABEL, () -> send(user, account, dialogId, 1));
        }
        return options;
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
                // 服务端明确返回错误码说明不支持该 RPC，标记当前账号不再探测。
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
        // 戳一戳成功后由 relay 下发系统提示消息，客户端仅在失败时打日志。
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
