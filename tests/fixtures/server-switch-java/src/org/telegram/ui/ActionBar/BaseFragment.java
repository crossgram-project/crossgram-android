package org.telegram.ui.ActionBar;

import android.content.Context;

public class BaseFragment {
    private final Context parentActivity;
    public AlertDialog shownDialog;

    public BaseFragment(Context parentActivity) {
        this.parentActivity = parentActivity;
    }

    public Context getParentActivity() {
        return parentActivity;
    }

    public void showDialog(AlertDialog dialog) {
        shownDialog = dialog;
        dialog.show();
    }
}
