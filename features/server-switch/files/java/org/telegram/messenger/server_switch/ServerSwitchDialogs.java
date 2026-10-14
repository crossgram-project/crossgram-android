package org.telegram.messenger.server_switch;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.res.Resources;
import android.text.InputType;
import android.view.Gravity;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.telegram.messenger.AndroidUtilities;
import org.telegram.messenger.R;
import org.telegram.ui.ActionBar.AlertDialog;
import org.telegram.ui.ActionBar.BaseFragment;
import org.telegram.ui.Components.LayoutHelper;

import java.util.List;

public final class ServerSwitchDialogs {
    private ServerSwitchDialogs() {
    }

    public static void showSelector(BaseFragment fragment, int account, Runnable onChanged) {
        Context context = fragment.getParentActivity();
        if (context == null) return;
        List<ServerSwitchConfig.Server> servers = ServerSwitchConfig.getServers();
        String selectedId = ServerSwitchConfig.getSelectedServerId(account);
        CharSequence[] items = new CharSequence[servers.size() + 2];
        items[0] = markSelected(text(context, R.string.ServerSwitchOfficial, "Official configuration"),
                selectedId.isEmpty());
        for (int i = 0; i < servers.size(); i++) {
            ServerSwitchConfig.Server server = servers.get(i);
            items[i + 1] = markSelected(server.name, server.id.equals(selectedId));
        }
        items[items.length - 1] = text(context, R.string.ServerSwitchAdd, "Add configuration");

        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setTitle(text(context, R.string.ServerSwitchTitle, "Server"));
        builder.setItems(items, (dialog, which) -> {
            try {
                if (which == 0) {
                    ServerSwitchConfig.selectOfficial(account);
                    run(onChanged);
                } else if (which == items.length - 1) {
                    showAddDialog(fragment, account, onChanged);
                } else {
                    ServerSwitchConfig.select(account, servers.get(which - 1).id);
                    run(onChanged);
                }
            } catch (Exception e) {
                showError(fragment, e.getMessage());
            }
        });
        builder.setNegativeButton(text(context, R.string.ServerSwitchCancel, "Cancel"), null);
        fragment.showDialog(builder.create());
    }

    private static void showAddDialog(BaseFragment fragment, int account, Runnable onChanged) {
        Context context = fragment.getParentActivity();
        if (context == null) return;
        EditText input = new EditText(context);
        input.setGravity(Gravity.TOP | Gravity.START);
        input.setHint(text(context, R.string.ServerSwitchJsonHint, "Paste the server configuration JSON here"));
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setMinLines(10);
        input.setMaxLines(18);
        input.setHorizontallyScrolling(false);

        FrameLayout container = new FrameLayout(context);
        container.setPadding(AndroidUtilities.dp(24), AndroidUtilities.dp(8),
                AndroidUtilities.dp(24), 0);
        container.addView(input, LayoutHelper.createFrame(LayoutHelper.MATCH_PARENT,
                LayoutHelper.WRAP_CONTENT));

        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setTitle(text(context, R.string.ServerSwitchAddTitle, "Add server configuration"));
        builder.setView(container);
        builder.setPositiveButton(text(context, R.string.ServerSwitchOk, "OK"), null);
        builder.setNeutralButton(text(context, R.string.ServerSwitchClipboard, "Read clipboard"), null);
        builder.setNegativeButton(text(context, R.string.ServerSwitchCancel, "Cancel"), null);
        AlertDialog dialog = builder.create();
        fragment.showDialog(dialog);

        TextView confirm = (TextView) dialog.getButton(DialogInterface.BUTTON_POSITIVE);
        confirm.setOnClickListener(v -> {
            try {
                ServerSwitchConfig.addAndSelect(account, input.getText().toString());
                dialog.dismiss();
                run(onChanged);
            } catch (Exception e) {
                input.setError(e.getMessage());
                input.requestFocus();
            }
        });
        TextView clipboardButton = (TextView) dialog.getButton(DialogInterface.BUTTON_NEUTRAL);
        clipboardButton.setOnClickListener(v -> readClipboard(context, input));
    }

    private static void readClipboard(Context context, EditText input) {
        ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) return;
        ClipData clip = clipboard.getPrimaryClip();
        if (clip != null && clip.getItemCount() > 0) {
            CharSequence value = clip.getItemAt(0).coerceToText(context);
            if (value != null) {
                input.setText(value);
                input.setSelection(input.length());
            }
        }
    }

    private static String markSelected(String value, boolean selected) {
        return selected ? "✓ " + value : value;
    }

    private static void showError(BaseFragment fragment, String message) {
        Context context = fragment.getParentActivity();
        if (context == null) return;
        new AlertDialog.Builder(context)
                .setTitle(text(context, R.string.ServerSwitchError, "Server configuration error"))
                .setMessage(message == null
                        ? text(context, R.string.ServerSwitchUnknownError, "Could not save the server configuration.")
                        : message)
                .setPositiveButton(text(context, R.string.ServerSwitchOk, "OK"), null)
                .show();
    }

    /**
     * Upstream release builds enable R8's optimized resource shrinking, which drops every
     * string its own code does not reference - including the shared ones such as
     * {@code R.string.Cancel}. Looking such an id up through {@link Context#getString(int)}
     * throws {@link Resources.NotFoundException}, which used to take the whole app down as
     * soon as the server list was opened. This feature therefore only reads its own strings
     * and degrades to {@code fallback} instead of crashing when one is missing.
     */
    private static String text(Context context, int resId, String fallback) {
        try {
            return context.getString(resId);
        } catch (Resources.NotFoundException e) {
            return fallback;
        }
    }

    private static void run(Runnable runnable) {
        if (runnable != null) runnable.run();
    }
}
