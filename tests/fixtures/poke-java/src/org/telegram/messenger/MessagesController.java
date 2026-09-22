package org.telegram.messenger;

import org.telegram.tgnet.TLRPC;

public class MessagesController {
    private static final MessagesController INSTANCE = new MessagesController();

    public static MessagesController getInstance(int account) {
        return INSTANCE;
    }

    public TLRPC.InputPeer getInputPeer(long dialogId) {
        return dialogId == 0 ? new TLRPC.TL_inputPeerEmpty() : new TLRPC.InputPeer("dialog-" + dialogId);
    }

    public TLRPC.InputUser getInputUser(TLRPC.User user) {
        return user == null ? null : new TLRPC.InputUser("user-" + user.id);
    }
}
