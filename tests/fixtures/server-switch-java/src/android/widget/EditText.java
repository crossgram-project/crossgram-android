package android.widget;

import android.content.Context;

public class EditText extends TextView {
    public CharSequence hint;
    public String error;
    public int inputType;
    public int minLines;
    public int maxLines;
    public boolean horizontallyScrolling = true;
    public int gravity;
    public int selection = -1;
    public boolean focused;

    private String value = "";

    public EditText(Context context) {
    }

    public void setGravity(int value) {
        gravity = value;
    }

    public void setHint(CharSequence value) {
        hint = value;
    }

    public void setInputType(int value) {
        inputType = value;
    }

    public void setMinLines(int value) {
        minLines = value;
    }

    public void setMaxLines(int value) {
        maxLines = value;
    }

    public void setHorizontallyScrolling(boolean value) {
        horizontallyScrolling = value;
    }

    public CharSequence getText() {
        return value;
    }

    public void setError(CharSequence message) {
        error = message == null ? null : message.toString();
    }

    public void requestFocus() {
        focused = true;
    }

    public void setSelection(int index) {
        selection = index;
    }

    public int length() {
        return value.length();
    }
}
