package org.telegram.messenger.crossgram_reactions;

import org.json.JSONObject;
import org.telegram.messenger.FileLog;
import org.telegram.messenger.MessagesController;
import org.telegram.tgnet.ConnectionsManager;
import org.telegram.tgnet.InputSerializedData;
import org.telegram.tgnet.OutputSerializedData;
import org.telegram.tgnet.TLObject;
import org.telegram.tgnet.TLRPC;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Crossgram conversation-level reaction support for Telegram Android.
 *
 * The relay advertises the reaction catalog account-wide and Telegram Android
 * treats every private chat as able to react, so an unpatched client keeps
 * offering the reaction row in QQ one-to-one chats where the relay then rejects
 * the send. The client asks `crossgram.getFeatures` for the conversation and
 * hides the row only after the relay has explicitly refused it, which keeps
 * every server without the Crossgram API exactly as upstream.
 */
public final class CrossgramReactions {
    private static final int GET_FEATURES_CONSTRUCTOR = 0xc3e6b915;

    /** An unanswered probe is repeated no faster than this. */
    private static final long PROBE_RETRY_MS = 60 * 1000L;

    private static final Set<String> REFUSED = ConcurrentHashMap.newKeySet();
    private static final Set<String> ALLOWED = ConcurrentHashMap.newKeySet();
    private static final Set<Integer> UNAVAILABLE_ACCOUNTS = ConcurrentHashMap.newKeySet();
    private static final Map<String, Long> PROBED_AT = new ConcurrentHashMap<>();

    private CrossgramReactions() {
    }

    /**
     * True unless the relay refused this conversation.
     *
     * An unanswered probe and a server without the Crossgram API both keep the
     * client's own peer rules, so the entry only disappears once the relay has
     * actually said so.
     */
    public static boolean allowsConversation(int account, long dialogId) {
        if (account < 0 || dialogId == 0) {
            return true;
        } else if (UNAVAILABLE_ACCOUNTS.contains(account)) {
            return true;
        }
        final String key = account + ":" + dialogId;
        if (REFUSED.contains(key)) {
            return false;
        }
        if (!ALLOWED.contains(key)) {
            requestFeatures(account, dialogId);
        }
        return true;
    }

    /** Warm the answer when a chat is opened, so the first row is already right. */
    public static void requestConversation(int account, long dialogId) {
        if (dialogId == 0) {
            return;
        }
        requestFeatures(account, dialogId);
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
                    final JSONObject features = new JSONObject(((TLRPC.TL_dataJSON) response).data);
                    final JSONObject reactions = features.optJSONObject("reactions");
                    if (reactions != null && reactions.has("supported") && !reactions.optBoolean("supported", true)) {
                        REFUSED.add(key);
                    } else {
                        ALLOWED.add(key);
                    }
                } catch (Exception parseError) {
                    FileLog.e(parseError);
                    ALLOWED.add(key);
                }
                return;
            }
            final String text = error != null ? error.text : "FEATURES_FAILED";
            FileLog.d("crossgram reaction features " + key + " -> " + text);
            if (error != null && error.code > 0) {
                // The server answered without knowing the method: this account is
                // not on a relay with reaction support, so stop asking.
                UNAVAILABLE_ACCOUNTS.add(account);
            }
            ALLOWED.add(key);
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
}
