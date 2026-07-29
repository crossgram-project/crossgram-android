    private boolean handleCrossgramE2eIntent(Intent intent) {
        if (!BuildConfig.DEBUG || intent == null || !CrossgramE2eActivity.ACTION.equals(intent.getAction())) {
            return false;
        }
        String command = intent.getStringExtra(CrossgramE2eActivity.EXTRA_COMMAND);
        if ("login".equals(command)) {
            LoginActivity login = new LoginActivity();
            presentFragment(login);
            String phone = intent.getStringExtra("crossgram_e2e_phone");
            String code = intent.getStringExtra("crossgram_e2e_code");
            AndroidUtilities.runOnUIThread(() -> login.runCrossgramE2eLogin(phone, code), 250);
            android.util.Log.i("CrossgramE2E", "page_opened:login");
            return true;
        }
        if ("dialogs".equals(command)) {
            presentFragment(new DialogsActivity(new Bundle()));
            android.util.Log.i("CrossgramE2E", "page_opened:dialogs");
            return true;
        }
        if ("chat".equals(command)) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            Bundle args = new Bundle();
            if ("user".equals(peerType)) {
                args.putLong("user_id", peerId);
            } else {
                args.putLong("chat_id", peerId);
            }
            presentFragment(new ChatActivity(args));
            android.util.Log.i("CrossgramE2E", "page_opened:chat");
            return true;
        }
        if ("send".equals(command)) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            String encodedMessage = intent.getStringExtra("crossgram_e2e_message_base64");
            String message = encodedMessage == null
                    ? intent.getStringExtra("crossgram_e2e_message")
                    : new String(android.util.Base64.decode(encodedMessage, android.util.Base64.DEFAULT),
                            java.nio.charset.StandardCharsets.UTF_8);
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            SendMessagesHelper.getInstance(currentAccount).sendMessage(
                    SendMessagesHelper.SendMessageParams.of(message, dialogId, null, null, null,
                            false, null, null, null, true, 0, 0, null, false));
            android.util.Log.i("CrossgramE2E", "function_called:sendMessage");
            return true;
        }
        if ("state".equals(command)) {
            boolean activated = UserConfig.getInstance(currentAccount).isClientActivated();
            int connectionState = ConnectionsManager.getInstance(currentAccount).getConnectionState();
            BaseFragment last = getActionBarLayout().getLastFragment();
            android.util.Log.i("CrossgramE2E", "state activated=" + activated
                    + " connection=" + connectionState
                    + " page=" + (last == null ? "none" : last.getClass().getSimpleName()));
            return true;
        }
        android.util.Log.e("CrossgramE2E", "unknown_command");
        return true;
    }
