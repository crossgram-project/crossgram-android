package org.telegram.ui.Components;

import java.util.ArrayList;
import java.util.List;

public class ItemOptions {
    public final List<String> added = new ArrayList<>();

    public static ItemOptions makeOptions() {
        return new ItemOptions();
    }

    public ItemOptions add(int icon, CharSequence text, Runnable action) {
        added.add(text.toString());
        return this;
    }

    public ItemOptions addIf(boolean condition, int icon, CharSequence text, Runnable action) {
        return condition ? add(icon, text, action) : this;
    }

    public ItemOptions setDrawScrim(boolean value) {
        return this;
    }

    public void show() {
    }
}
