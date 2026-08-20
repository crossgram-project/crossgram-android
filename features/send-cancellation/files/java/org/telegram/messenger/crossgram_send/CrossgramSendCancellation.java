package org.telegram.messenger.crossgram_send;

import org.telegram.tgnet.TLRPC;
import org.telegram.tgnet.tl.TL_update;

import java.util.ArrayList;

/** Consumes Crossgram's wire-compatible acknowledgement for intentionally cancelled sends. */
public final class CrossgramSendCancellation {
    public static final int CANCELLED_MESSAGE_ID = 0;

    private CrossgramSendCancellation() {}

    public static ArrayList<Long> takeCancelledRandomIds(
            ArrayList<Long> requestRandomIds,
            TLRPC.Updates updates) {
        ArrayList<Long> cancelled = new ArrayList<>();
        if (requestRandomIds == null || requestRandomIds.isEmpty() || updates == null) {
            return cancelled;
        }
        for (int index = updates.updates.size() - 1; index >= 0; index--) {
            TLRPC.Update update = updates.updates.get(index);
            if (!(update instanceof TL_update.TL_updateMessageID)) continue;
            TL_update.TL_updateMessageID confirmation = (TL_update.TL_updateMessageID) update;
            if (confirmation.id != CANCELLED_MESSAGE_ID
                    || !requestRandomIds.contains(confirmation.random_id)) {
                continue;
            }
            cancelled.add(confirmation.random_id);
            updates.updates.remove(index);
        }
        return cancelled;
    }
}
