        // CROSSGRAM SERVER SWITCH ICON BEGIN
        if (activityMode == MODE_LOGIN) {
            serverSwitchButton = new ImageView(context);
            serverSwitchButton.setImageResource(R.drawable.msg_retry);
            serverSwitchButton.setScaleType(ImageView.ScaleType.CENTER);
            serverSwitchButton.setColorFilter(Theme.getColor(Theme.key_windowBackgroundWhiteBlackText));
            serverSwitchButton.setBackground(Theme.createSelectorDrawable(
                    Theme.getColor(Theme.key_listSelector), 1));
            serverSwitchButton.setContentDescription(
                    LocaleController.getString(R.string.ServerSwitchTitle));
            serverSwitchButton.setOnClickListener(v ->
                    ServerSwitchDialogs.showSelector(this, currentAccount, null));
            serverSwitchButton.setVisibility(
                    currentViewNum == VIEW_PHONE_INPUT ? View.VISIBLE : View.GONE);
            FrameLayout.LayoutParams serverSwitchLayout = LayoutHelper.createFrame(
                    32, 32, Gravity.LEFT | Gravity.TOP, newAccount ? 56 : 16, 16, 0, 0);
            serverSwitchLayout.topMargin = AndroidUtilities.dp(16)
                    + (AndroidUtilities.isTablet() ? 0 : AndroidUtilities.statusBarHeight);
            sizeNotifierFrameLayout.addView(serverSwitchButton, serverSwitchLayout);
        }
        // CROSSGRAM SERVER SWITCH ICON END
