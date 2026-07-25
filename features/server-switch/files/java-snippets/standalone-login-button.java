        if (activityMode == MODE_LOGIN) {
            TextView serverSwitchButton = new TextView(context);
            serverSwitchButton.setGravity(Gravity.CENTER);
            serverSwitchButton.setText(LocaleController.getString(R.string.ServerSwitchTitle));
            serverSwitchButton.setTextColor(Theme.getColor(Theme.key_windowBackgroundWhiteBlueText4));
            serverSwitchButton.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 14);
            serverSwitchButton.setPadding(AndroidUtilities.dp(12), 0, AndroidUtilities.dp(12), 0);
            serverSwitchButton.setBackground(Theme.createSelectorDrawable(
                    Theme.multAlpha(Theme.getColor(Theme.key_windowBackgroundWhiteBlueText4), 0.12f), 2));
            serverSwitchButton.setOnClickListener(v ->
                    ServerSwitchDialogs.showSelector(this, currentAccount, null));
            FrameLayout.LayoutParams serverSwitchLayout = LayoutHelper.createFrame(
                    LayoutHelper.WRAP_CONTENT, 32, Gravity.RIGHT | Gravity.TOP, 0, 0, 16, 0);
            serverSwitchLayout.topMargin = AndroidUtilities.dp(16)
                    + (AndroidUtilities.isTablet() ? 0 : AndroidUtilities.statusBarHeight);
            sizeNotifierFrameLayout.addView(serverSwitchButton, serverSwitchLayout);
        }
