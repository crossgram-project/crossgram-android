package org.telegram.ui.ActionBar;

import android.view.ViewGroup;

public class ActionBarMenuItem {
    public static ActionBarMenuSubItem addItem(
            boolean first,
            boolean last,
            ViewGroup layout,
            int icon,
            CharSequence text,
            boolean needCheck,
            Theme.ResourcesProvider resourcesProvider) {
        final ActionBarMenuSubItem item = new ActionBarMenuSubItem();
        item.setTextAndIcon(text, icon);
        layout.addView(item);
        return item;
    }
}
