import android.content.Context;
import android.content.res.Resources;
import android.widget.EditText;
import android.widget.FrameLayout;

import org.telegram.messenger.R;
import org.telegram.messenger.server_switch.ServerSwitchConfig;
import org.telegram.messenger.server_switch.ServerSwitchDialogs;
import org.telegram.ui.ActionBar.AlertDialog;
import org.telegram.ui.ActionBar.BaseFragment;

/**
 * Drives the injected server-switch dialogs against a resource table shaped like the release
 * APK's: this feature's own strings are there, the shared ones upstream's shrinker removed are
 * not. The old dialog read {@code R.string.Cancel} here and died with
 * {@code Resources$NotFoundException} before the list was ever shown.
 */
public class Harness {
    public static void main(String[] args) {
        System.out.println(run());
    }

    private static String run() {
        StringBuilder out = new StringBuilder();

        ServerSwitchConfig.servers.add(new ServerSwitchConfig.Server("cfg-1", "CrossGram-Shanghai"));
        ServerSwitchConfig.selectedId = "cfg-1";

        Context context = new Context();
        Context.strings.put(R.string.ServerSwitchTitle, "Server");
        Context.strings.put(R.string.ServerSwitchOfficial, "Official configuration");
        Context.strings.put(R.string.ServerSwitchAdd, "Add configuration");
        Context.strings.put(R.string.ServerSwitchAddTitle, "Add server configuration");
        Context.strings.put(R.string.ServerSwitchClipboard, "Read clipboard");
        Context.strings.put(R.string.ServerSwitchJsonHint, "Paste the server configuration JSON here");
        Context.strings.put(R.string.ServerSwitchError, "Server configuration error");
        Context.strings.put(R.string.ServerSwitchUnknownError, "Could not save the server configuration.");
        Context.strings.put(R.string.ServerSwitchCancel, "Cancel");
        Context.strings.put(R.string.ServerSwitchOk, "OK");

        // The shared strings a shrunken release table no longer carries.
        out.append("shared-cancel=").append(lookup(context, R.string.Cancel)).append(';');
        out.append("shared-ok=").append(lookup(context, R.string.OK)).append(';');
        Context.requested.clear();

        BaseFragment fragment = new BaseFragment(context);
        ServerSwitchDialogs.showSelector(fragment, 0, null);
        AlertDialog selector = fragment.shownDialog;
        out.append("shown=").append(selector.shown).append(';');
        out.append("title=").append(selector.title).append(';');
        out.append("negative=").append(selector.negativeText).append(';');
        out.append("items=").append(join(selector.items)).append(';');
        out.append("shared-ids-requested=")
                .append(Context.requested.contains(R.string.Cancel) || Context.requested.contains(R.string.OK))
                .append(';');

        // "Add configuration" opens the paste dialog and its confirm button reports bad input.
        Context.requested.clear();
        selector.itemsListener.onClick(selector, selector.items.length - 1);
        AlertDialog add = fragment.shownDialog;
        FrameLayout container = (FrameLayout) add.view;
        EditText input = container == null ? null : (EditText) container.child;
        out.append("add-title=").append(add.title).append(';');
        out.append("add-ok=").append(add.positiveText).append(';');
        out.append("add-clipboard=").append(add.neutralText).append(';');
        out.append("add-cancel=").append(add.negativeText).append(';');
        out.append("add-hint=").append(input == null ? "<no input>" : input.hint).append(';');
        add.positiveButton.performClick();
        out.append("add-error=").append(input == null ? "<no input>" : input.error).append(';');
        out.append("add-shared-ids-requested=")
                .append(Context.requested.contains(R.string.Cancel) || Context.requested.contains(R.string.OK))
                .append(';');

        selector.itemsListener.onClick(selector, 0);
        out.append("official-selected=").append(ServerSwitchConfig.selectedId.isEmpty()).append(';');

        // A future build that drops this feature's own strings too must only lose the wording.
        Context.failAll = true;
        BaseFragment fallback = new BaseFragment(context);
        ServerSwitchDialogs.showSelector(fallback, 0, null);
        AlertDialog degraded = fallback.shownDialog;
        out.append("fallback-shown=").append(degraded.shown).append(';');
        out.append("fallback-title=").append(degraded.title).append(';');
        out.append("fallback-negative=").append(degraded.negativeText).append(';');
        out.append("fallback-items=").append(join(degraded.items)).append(';');
        Context.failAll = false;

        return out.toString();
    }

    private static String lookup(Context context, int resId) {
        try {
            return context.getString(resId);
        } catch (Resources.NotFoundException e) {
            return "missing";
        }
    }

    private static String join(CharSequence[] values) {
        StringBuilder joined = new StringBuilder();
        for (int i = 0; i < values.length; i++) {
            if (i > 0) joined.append('|');
            joined.append(values[i]);
        }
        return joined.toString();
    }
}
