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
        if ("history".equals(command)) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            int count = intent.getIntExtra("crossgram_e2e_history_count", 50);
            int maxId = intent.getIntExtra("crossgram_e2e_history_max_id", 0);
            boolean fromCache = intent.getBooleanExtra("crossgram_e2e_history_cache", false);
            int classGuid = ConnectionsManager.generateClassGuid();
            long startedAt = android.os.SystemClock.elapsedRealtime();
            NotificationCenter.NotificationCenterDelegate observer = new NotificationCenter.NotificationCenterDelegate() {
                @Override
                public void didReceivedNotification(int id, int account, Object... args) {
                    if (id == NotificationCenter.messagesDidLoad && (Integer) args[10] == classGuid) {
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.messagesDidLoad);
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.loadingMessagesFailed);
                        java.util.ArrayList<MessageObject> loaded = (java.util.ArrayList<MessageObject>) args[2];
                        int minId = Integer.MAX_VALUE;
                        int maxLoadedId = Integer.MIN_VALUE;
                        for (MessageObject object : loaded) {
                            int messageId = object.getId();
                            if (messageId > 0) {
                                minId = Math.min(minId, messageId);
                                maxLoadedId = Math.max(maxLoadedId, messageId);
                            }
                        }
                        android.util.Log.i("CrossgramE2E", "history_loaded source=" + ((Boolean) args[3] ? "cache" : "server")
                                + " count=" + loaded.size()
                                + " min_id=" + (minId == Integer.MAX_VALUE ? 0 : minId)
                                + " max_id=" + (maxLoadedId == Integer.MIN_VALUE ? 0 : maxLoadedId)
                                + " end=" + args[9]
                                + " requested_max_id=" + maxId
                                + " duration_ms=" + (android.os.SystemClock.elapsedRealtime() - startedAt));
                    } else if (id == NotificationCenter.loadingMessagesFailed && (Integer) args[0] == classGuid) {
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.messagesDidLoad);
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.loadingMessagesFailed);
                        android.util.Log.e("CrossgramE2E", "history_failed requested_max_id=" + maxId);
                    }
                }
            };
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.messagesDidLoad);
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.loadingMessagesFailed);
            MessagesController.getInstance(currentAccount).loadMessages(
                    dialogId, 0, false, count, maxId, 0, fromCache, 0, classGuid,
                    MessagesController.LOAD_BACKWARD, 0, ChatActivity.MODE_DEFAULT, 0, 0, 0, false);
            android.util.Log.i("CrossgramE2E", "function_called:loadMessages source=" + (fromCache ? "cache" : "server")
                    + " requested_max_id=" + maxId);
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
