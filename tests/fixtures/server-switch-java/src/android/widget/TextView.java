package android.widget;

import android.content.Context;
import android.view.View;

public class TextView extends View {
    public CharSequence text;

    public TextView() {
    }

    public TextView(Context context) {
    }

    public void setText(CharSequence value) {
        text = value;
    }
}
