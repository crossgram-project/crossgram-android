package org.telegram.ui.Components;

import android.widget.FrameLayout;

public class LayoutHelper {
    public static final int MATCH_PARENT = -1;
    public static final int WRAP_CONTENT = -2;

    public static FrameLayout.LayoutParams createFrame(int width, int height) {
        return new FrameLayout.LayoutParams(width, height);
    }
}
