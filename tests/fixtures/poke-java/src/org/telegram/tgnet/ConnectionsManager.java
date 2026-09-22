package org.telegram.tgnet;

import java.util.ArrayList;
import java.util.List;

public class ConnectionsManager {
    public interface RequestDelegate {
        void onComplete(TLObject response, TLRPC.TL_error error);
    }

    public static final class Sent {
        public final TLObject request;
        public final RequestDelegate delegate;
        public final OutputSerializedData stream = new OutputSerializedData();

        Sent(TLObject request, RequestDelegate delegate) {
            this.request = request;
            this.delegate = delegate;
        }
    }

    public static final List<Sent> sent = new ArrayList<>();

    private static final ConnectionsManager INSTANCE = new ConnectionsManager();

    public static ConnectionsManager getInstance(int account) {
        return INSTANCE;
    }

    public void sendRequest(TLObject request, RequestDelegate delegate) {
        final Sent entry = new Sent(request, delegate);
        request.serializeToStream(entry.stream);
        sent.add(entry);
    }

    public static void answer(int index, TLObject response, TLRPC.TL_error error) {
        final Sent entry = sent.get(index);
        entry.delegate.onComplete(response, error);
    }
}
