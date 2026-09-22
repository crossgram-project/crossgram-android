package org.telegram.ui.ActionBar;

import android.view.FrameLayout;

public class ActionBarMenuSubItem extends FrameLayout {
    private CharSequence text;

    public void setTextAndIcon(CharSequence text, int icon) {
        this.text = text;
    }

    public CharSequence getText() {
        return text;
    }
}
