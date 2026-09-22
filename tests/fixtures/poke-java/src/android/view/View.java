package android.view;

public class View {
    public interface OnClickListener {
        void onClick(View v);
    }

    public interface OnLongClickListener {
        boolean onLongClick(View v);
    }

    private OnClickListener clickListener;
    private OnLongClickListener longClickListener;

    public void setOnClickListener(OnClickListener listener) {
        clickListener = listener;
    }

    public void setOnLongClickListener(OnLongClickListener listener) {
        longClickListener = listener;
    }

    public void performClick() {
        if (clickListener != null) {
            clickListener.onClick(this);
        }
    }

    public boolean performLongClick() {
        return longClickListener != null && longClickListener.onLongClick(this);
    }
}
