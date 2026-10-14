package org.telegram.ui.ActionBar;

import android.content.Context;
import android.content.DialogInterface;
import android.widget.TextView;

/** Captures everything the injected dialog sets, so the harness can assert on it. */
public class AlertDialog implements DialogInterface {
    public CharSequence title;
    public CharSequence message;
    public CharSequence[] items;
    public CharSequence positiveText;
    public CharSequence negativeText;
    public CharSequence neutralText;
    public Object view;
    public DialogInterface.OnClickListener itemsListener;
    public boolean shown;

    public TextView positiveButton = new TextView();
    public TextView negativeButton = new TextView();
    public TextView neutralButton = new TextView();

    public TextView getButton(int which) {
        if (which == DialogInterface.BUTTON_POSITIVE) return positiveButton;
        if (which == DialogInterface.BUTTON_NEUTRAL) return neutralButton;
        return negativeButton;
    }

    public void show() {
        shown = true;
    }

    public void dismiss() {
    }

    public static class Builder {
        private final AlertDialog dialog = new AlertDialog();

        public Builder(Context context) {
        }

        public Builder setTitle(CharSequence value) {
            dialog.title = value;
            return this;
        }

        public Builder setMessage(CharSequence value) {
            dialog.message = value;
            return this;
        }

        public Builder setItems(CharSequence[] values, DialogInterface.OnClickListener listener) {
            dialog.items = values;
            dialog.itemsListener = listener;
            return this;
        }

        public Builder setView(Object value) {
            dialog.view = value;
            return this;
        }

        public Builder setPositiveButton(CharSequence text, DialogInterface.OnClickListener listener) {
            dialog.positiveText = text;
            return this;
        }

        public Builder setNeutralButton(CharSequence text, DialogInterface.OnClickListener listener) {
            dialog.neutralText = text;
            return this;
        }

        public Builder setNegativeButton(CharSequence text, DialogInterface.OnClickListener listener) {
            dialog.negativeText = text;
            return this;
        }

        public AlertDialog create() {
            return dialog;
        }

        public AlertDialog show() {
            dialog.show();
            return dialog;
        }
    }
}
