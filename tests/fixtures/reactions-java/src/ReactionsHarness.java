import org.telegram.messenger.crossgram_reactions.CrossgramReactions;
import org.telegram.tgnet.ConnectionsManager;
import org.telegram.tgnet.TLRPC;

public class ReactionsHarness {
    public static void main(String[] args) {
        final StringBuilder report = new StringBuilder();

        // Before the relay answers, the conversation keeps the client's rules.
        report.append("unknown-allowed=").append(CrossgramReactions.allowsConversation(0, 42)).append(';');
        report.append("features-request=").append(ConnectionsManager.sent.get(0).stream.joined()).append(';');

        // An explicit refusal is remembered for that conversation only.
        ConnectionsManager.answer(0, new TLRPC.TL_dataJSON("{\"reactions\":{\"supported\":false}}"), null);
        report.append("refused-allowed=").append(CrossgramReactions.allowsConversation(0, 42)).append(';');
        report.append("sibling-allowed=").append(CrossgramReactions.allowsConversation(0, 43)).append(';');
        ConnectionsManager.answer(1, new TLRPC.TL_dataJSON("{\"reactions\":{\"supported\":true}}"), null);
        report.append("sibling-allowed-after=").append(CrossgramReactions.allowsConversation(0, 43)).append(';');

        // A server without the Crossgram API keeps its own peer rules and is
        // never asked again.
        report.append("official-allowed=").append(CrossgramReactions.allowsConversation(1, 77)).append(';');
        ConnectionsManager.answer(2, null, new TLRPC.TL_error(400, "METHOD_NOT_IMPLEMENTED"));
        report.append("official-allowed-after=").append(CrossgramReactions.allowsConversation(1, 78)).append(';');
        report.append("requests=").append(ConnectionsManager.sent.size()).append(';');

        // Warming a chat is the same query; a self-chat is never asked about.
        CrossgramReactions.requestConversation(0, 44);
        CrossgramReactions.requestConversation(0, 0);
        report.append("warm-requests=").append(ConnectionsManager.sent.size()).append(';');

        System.out.print(report);
    }
}
