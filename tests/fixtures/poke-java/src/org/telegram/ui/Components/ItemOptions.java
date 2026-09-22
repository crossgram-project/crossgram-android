package org.telegram.ui.Components;

import java.util.ArrayList;
import java.util.List;

public class ItemOptions {
    public final List<String> added = new ArrayList<>();

    public ItemOptions add(int icon, CharSequence text, Runnable action) {
        added.add(text.toString());
        return this;
    }
}
