import android.view.View;
import org.telegram.messenger.MessagesController;
import org.telegram.messenger.R;
import org.telegram.messenger.crossgram_poke.CrossgramPoke;
import org.telegram.tgnet.ConnectionsManager;
import org.telegram.tgnet.TLRPC;
import org.telegram.ui.ActionBar.ActionBarMenuSubItem;
import org.telegram.ui.ActionBar.ActionBarPopupWindow;
import org.telegram.ui.ActionBar.Theme;
import org.telegram.ui.Components.ItemOptions;

public class Harness {
    public static void main(String[] args) {
        final StringBuilder report = new StringBuilder();
        final TLRPC.User user = new TLRPC.User(7);
        final ActionBarPopupWindow.ActionBarPopupWindowLayout menu = new ActionBarPopupWindow.ActionBarPopupWindowLayout();
        final Theme.ResourcesProvider provider = new Theme.ResourcesProvider() {
        };
        final Runnable[] rebuildHolder = new Runnable[1];
        rebuildHolder[0] = () -> {
            menu.removeAllViews();
            CrossgramPoke.appendMenu(menu, user, provider, rebuildHolder[0]);
        };
        final Runnable rebuild = () -> rebuildHolder[0].run();

        // Before the relay answers, the menu stays untouched.
        CrossgramPoke.setConversation(0, 42);
        rebuild.run();
        report.append("rows-before=").append(rowLabels(menu)).append(';');
        report.append("supported-before=").append(CrossgramPoke.keepsMenuLast(user)).append(';');

        // The feature query carries the conversation peer and nothing else.
        report.append("features-request=").append(ConnectionsManager.sent.get(0).stream.joined()).append(';');

        // A supported answer exposes the single-poke row.
        ConnectionsManager.answer(0, new TLRPC.TL_dataJSON("{\"poke\":{\"maxCount\":10}}"), null);
        report.append("supported-after=").append(CrossgramPoke.keepsMenuLast(user)).append(';');
        rebuild.run();
        report.append("rows-after=").append(rowLabels(menu)).append(';');

        // Tapping the row sends one poke with the relay's wire shape.
        menu.getChildAt(0).performClick();
        report.append("poke-request=").append(ConnectionsManager.sent.get(1).stream.joined()).append(';');

        // Holding it expands the burst rows, and a burst row sends its count.
        menu.getChildAt(0).performLongClick();
        report.append("rows-expanded=").append(rowLabels(menu)).append(';');
        menu.getChildAt(2).performClick();
        report.append("burst-request=").append(ConnectionsManager.sent.get(2).stream.joined()).append(';');

        // The fallback ItemOptions menu offers the single poke as well. Upstream
        // builds that menu as one chain off the instance the poke row was added
        // to, so the helper has to hand the same instance back.
        final ItemOptions options = ItemOptions.makeOptions();
        CrossgramPoke.appendOptions(options, user)
                .add(R.drawable.msg_mention, "own-row", () -> {
                })
                .setDrawScrim(false)
                .show();
        report.append("options=").append(options.added).append(';');

        // An account the relay rejected never shows the entry again.
        CrossgramPoke.setConversation(1, 99);
        ConnectionsManager.answer(3, null, new TLRPC.TL_error(400, "METHOD_NOT_IMPLEMENTED"));
        CrossgramPoke.setConversation(2, 100);
        rebuild.run();
        report.append("rows-rejected=").append(rowLabels(menu)).append(';');

        System.out.print(report);
    }

    private static String rowLabels(ActionBarPopupWindow.ActionBarPopupWindowLayout menu) {
        final StringBuilder labels = new StringBuilder("[");
        for (int index = 0; index < menu.getChildCount(); index++) {
            if (index > 0) labels.append('|');
            labels.append(((ActionBarMenuSubItem) menu.getChildAt(index)).getText());
        }
        return labels.append(']').toString();
    }
}
