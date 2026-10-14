package android.content;

public interface DialogInterface {
    int BUTTON_POSITIVE = -1;
    int BUTTON_NEGATIVE = -2;
    int BUTTON_NEUTRAL = -3;

    interface OnClickListener {
        void onClick(DialogInterface dialog, int which);
    }
}
