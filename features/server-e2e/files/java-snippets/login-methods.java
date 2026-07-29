    private String crossgramE2eCode;

    public void runCrossgramE2eLogin(String phone, String code) {
        if (!BuildConfig.DEBUG || activityMode != MODE_LOGIN) {
            return;
        }
        String normalized = phone == null ? "" : phone.replaceAll("\\D", "");
        if (normalized.length() <= 3 || !(views[VIEW_PHONE_INPUT] instanceof PhoneView)) {
            android.util.Log.e("CrossgramE2E", "login_invalid_phone");
            return;
        }
        crossgramE2eCode = code;
        PhoneView phoneView = (PhoneView) views[VIEW_PHONE_INPUT];
        checkPermissions = false;
        checkShowPermissions = false;
        phoneView.confirmedNumber = true;
        phoneView.codeField.setText(normalized.substring(0, 3));
        phoneView.phoneField.setText(normalized.substring(3));
        android.util.Log.i("CrossgramE2E", "login_phone_submitted");
        phoneView.onNextPressed(null);
    }

    private void maybeRunCrossgramE2eCode(int page) {
        if (!BuildConfig.DEBUG || TextUtils.isEmpty(crossgramE2eCode)) {
            return;
        }
        if ((page >= VIEW_CODE_MESSAGE && page <= VIEW_CODE_CALL) || page == VIEW_CODE_FRAGMENT_SMS) {
            String code = crossgramE2eCode;
            crossgramE2eCode = null;
            AndroidUtilities.runOnUIThread(() -> {
                android.util.Log.i("CrossgramE2E", "login_code_submitted");
                views[page].onNextPressed(code);
            }, 100);
        }
    }
