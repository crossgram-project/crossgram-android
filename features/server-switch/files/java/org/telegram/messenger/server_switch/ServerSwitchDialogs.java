package org.telegram.messenger.server_switch;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
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
        items[0] = markSelected(context.getString(R.string.ServerSwitchOfficial), selectedId.isEmpty());
        for (int i = 0; i < servers.size(); i++) {
            ServerSwitchConfig.Server server = servers.get(i);
            items[i + 1] = markSelected(server.name, server.id.equals(selectedId));
        }
        items[items.length - 1] = context.getString(R.string.ServerSwitchAdd);

        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        builder.setTitle(context.getString(R.string.ServerSwitchTitle));
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
        builder.setNegativeButton(context.getString(R.string.Cancel), null);
        fragment.showDialog(builder.create());
    }

    private static void showAddDialog(BaseFragment fragment, int account, Runnable onChanged) {
        Context context = fragment.getParentActivity();
        if (context == null) return;
        EditText input = new EditText(context);
        input.setGravity(Gravity.TOP | Gravity.START);
        input.setHint(context.getString(R.string.ServerSwitchJsonHint));
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
        builder.setTitle(context.getString(R.string.ServerSwitchAddTitle));
        builder.setView(container);
        builder.setPositiveButton(context.getString(R.string.OK), null);
        builder.setNeutralButton(context.getString(R.string.ServerSwitchClipboard), null);
        builder.setNegativeButton(context.getString(R.string.Cancel), null);
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
                .setTitle(context.getString(R.string.ServerSwitchError))
                .setMessage(message == null ? context.getString(R.string.ServerSwitchUnknownError) : message)
                .setPositiveButton(context.getString(R.string.OK), null)
                .show();
    }

    private static void run(Runnable runnable) {
        if (runnable != null) runnable.run();
    }
}
