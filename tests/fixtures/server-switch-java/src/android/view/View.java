package android.view;

public class View {
    public interface OnClickListener {
        void onClick(View v);
    }

    private OnClickListener clickListener;

    public void setOnClickListener(OnClickListener listener) {
        clickListener = listener;
    }

    public void performClick() {
        if (clickListener != null) {
            clickListener.onClick(this);
        }
    }
}
