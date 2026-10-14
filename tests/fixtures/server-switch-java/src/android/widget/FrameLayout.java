package android.widget;

import android.content.Context;
import android.view.View;

public class FrameLayout extends View {
    public static class LayoutParams {
        public int width;
        public int height;
        public int topMargin;

        public LayoutParams(int width, int height) {
            this.width = width;
            this.height = height;
        }
    }

    public int paddingLeft;
    public int paddingTop;
    public int paddingRight;
    public int paddingBottom;
    public View child;

    public FrameLayout(Context context) {
    }

    public void setPadding(int left, int top, int right, int bottom) {
        paddingLeft = left;
        paddingTop = top;
        paddingRight = right;
        paddingBottom = bottom;
    }

    public void addView(View view, LayoutParams params) {
        child = view;
    }
}
