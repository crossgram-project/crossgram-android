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
            return runCrossgramE2eHistory(intent, 0);
        }
        if ("download".equals(command)) {
            long mediaId = intent.getLongExtra("crossgram_e2e_media_id", 0);
            long expectedSize = intent.getLongExtra("crossgram_e2e_expected_size", 0);
            boolean forceHttpFailure = intent.getBooleanExtra("crossgram_e2e_force_http_failure", false);
            return runCrossgramE2eWithMessage(intent, "download", target ->
                    runCrossgramE2eDownload(target, mediaId, expectedSize, forceHttpFailure));
        }
        if ("search".equals(command)) {
            return runCrossgramE2eSearch(intent);
        }
        if ("read".equals(command)) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            int targetId = intent.getIntExtra("crossgram_e2e_target_message_id", 0);
            MessagesController messagesController = MessagesController.getInstance(currentAccount);
            messagesController.markDialogAsRead(dialogId, targetId, 0, 0, false, 0, 0, true, 0);
            messagesController.markDialogAsReadNow(dialogId, 0);
            android.util.Log.i("CrossgramE2E", "function_called:markDialogAsRead target_id=" + targetId);
            return true;
        }
        if ("draft".equals(command)) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            String encodedMessage = intent.getStringExtra("crossgram_e2e_message_base64");
            String message = encodedMessage == null
                    ? ""
                    : new String(android.util.Base64.decode(encodedMessage, android.util.Base64.DEFAULT),
                            java.nio.charset.StandardCharsets.UTF_8);
            MediaDataController.getInstance(currentAccount).saveDraft(dialogId, 0, message, null, null, false, 0);
            android.util.Log.i("CrossgramE2E", "function_called:saveDraft empty=" + message.isEmpty());
            return true;
        }
        if ("reply".equals(command)) {
            String encodedMessage = intent.getStringExtra("crossgram_e2e_message_base64");
            String message = new String(android.util.Base64.decode(encodedMessage, android.util.Base64.DEFAULT),
                    java.nio.charset.StandardCharsets.UTF_8);
            return runCrossgramE2eWithMessage(intent, "reply", target -> {
                SendMessagesHelper.getInstance(currentAccount).sendMessage(
                        SendMessagesHelper.SendMessageParams.of(message, target.getDialogId(), target, null, null,
                                false, null, null, null, true, 0, 0, null, false));
                android.util.Log.i("CrossgramE2E", "function_called:replyMessage target_id=" + target.getId());
            });
        }
        if ("edit".equals(command)) {
            String encodedMessage = intent.getStringExtra("crossgram_e2e_message_base64");
            String message = new String(android.util.Base64.decode(encodedMessage, android.util.Base64.DEFAULT),
                    java.nio.charset.StandardCharsets.UTF_8);
            return runCrossgramE2eWithMessage(intent, "edit", target -> {
                BaseFragment fragment = getActionBarLayout().getLastFragment();
                int requestId = SendMessagesHelper.getInstance(currentAccount)
                        .editMessage(target, message, false, fragment, null, 0, 0);
                if (requestId == 0) {
                    android.util.Log.e("CrossgramE2E", "edit_failed reason=request_not_started");
                } else {
                    android.util.Log.i("CrossgramE2E", "function_called:editMessage target_id=" + target.getId());
                }
            });
        }
        if ("delete".equals(command)) {
            return runCrossgramE2eWithMessage(intent, "delete", target -> {
                java.util.ArrayList<Integer> ids = new java.util.ArrayList<>();
                ids.add(target.getId());
                MessagesController.getInstance(currentAccount).deleteMessages(
                        ids, null, null, target.getDialogId(), 0, true, ChatActivity.MODE_DEFAULT);
                android.util.Log.i("CrossgramE2E", "function_called:deleteMessages target_id=" + target.getId());
            });
        }
        if ("forward".equals(command)) {
            long destinationPeerId = intent.getLongExtra("crossgram_e2e_destination_peer_id", 0);
            String destinationPeerType = intent.getStringExtra("crossgram_e2e_destination_peer_type");
            long destinationDialogId = "user".equals(destinationPeerType) ? destinationPeerId : -destinationPeerId;
            return runCrossgramE2eWithMessage(intent, "forward", target -> {
                java.util.ArrayList<MessageObject> messages = new java.util.ArrayList<>();
                messages.add(target);
                int requestId = SendMessagesHelper.getInstance(currentAccount)
                        .sendMessage(messages, destinationDialogId, false, false, true, 0, 0);
                if (requestId == 0) {
                    android.util.Log.e("CrossgramE2E", "forward_failed reason=request_not_started");
                } else {
                    android.util.Log.i("CrossgramE2E", "function_called:forwardMessages target_id=" + target.getId());
                }
            });
        }
        if ("reaction".equals(command)) {
            String reaction = intent.getStringExtra("crossgram_e2e_reaction");
            return runCrossgramE2eWithMessage(intent, "reaction", target -> {
                org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction visible =
                        org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction.fromEmojicon(reaction);
                java.util.ArrayList<org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction> reactions =
                        new java.util.ArrayList<>();
                reactions.add(visible);
                SendMessagesHelper.getInstance(currentAccount).sendReaction(
                        target, reactions, visible, false, false, getActionBarLayout().getLastFragment(),
                        () -> android.util.Log.i("CrossgramE2E", "reaction_applied target_id=" + target.getId()));
                android.util.Log.i("CrossgramE2E", "function_called:sendReaction target_id=" + target.getId());
            });
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

    private boolean runCrossgramE2eHistory(Intent intent, int hydrationAttempt) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            int count = intent.getIntExtra("crossgram_e2e_history_count", 50);
            int maxId = intent.getIntExtra("crossgram_e2e_history_max_id", 0);
            boolean fromCache = intent.getBooleanExtra("crossgram_e2e_history_cache", false);
            boolean rawPeer = intent.getBooleanExtra("crossgram_e2e_history_raw_peer", false);
            int loadType = intent.getIntExtra("crossgram_e2e_history_load_type",
                    !fromCache && maxId == 0 ? MessagesController.LOAD_FROM_UNREAD : MessagesController.LOAD_BACKWARD);
            MessagesController messagesController = MessagesController.getInstance(currentAccount);
            if (!rawPeer && "chat".equals(peerType) && messagesController.getChat(peerId) == null) {
                if (hydrationAttempt == 0) {
                    TLRPC.TL_messages_getPeerDialogs request = new TLRPC.TL_messages_getPeerDialogs();
                    TLRPC.TL_inputDialogPeer dialogPeer = new TLRPC.TL_inputDialogPeer();
                    TLRPC.TL_inputPeerChannel inputPeer = new TLRPC.TL_inputPeerChannel();
                    inputPeer.channel_id = peerId;
                    inputPeer.access_hash = 1;
                    dialogPeer.peer = inputPeer;
                    request.peers.add(dialogPeer);
                    ConnectionsManager.getInstance(currentAccount).sendRequest(request, (response, error) ->
                            AndroidUtilities.runOnUIThread(() -> {
                                if (error != null || !(response instanceof TLRPC.TL_messages_peerDialogs)) {
                                    android.util.Log.e("CrossgramE2E", "history_failed reason=peer_metadata_rpc requested_max_id=" + maxId);
                                    return;
                                }
                                TLRPC.TL_messages_peerDialogs result = (TLRPC.TL_messages_peerDialogs) response;
                                messagesController.putUsers(result.users, false);
                                messagesController.putChats(result.chats, false);
                                if (messagesController.getChat(peerId) == null) {
                                    android.util.Log.e("CrossgramE2E", "history_failed reason=peer_metadata_missing requested_max_id=" + maxId);
                                    return;
                                }
                                android.util.Log.i("CrossgramE2E", "history_peer_hydrated peer_id=" + peerId
                                        + " chat_count=" + result.chats.size());
                                runCrossgramE2eHistory(new Intent(intent), hydrationAttempt + 1);
                            }));
                    android.util.Log.i("CrossgramE2E", "history_peer_hydration_started peer_id=" + peerId);
                    return true;
                }
                android.util.Log.e("CrossgramE2E", "history_failed reason=peer_metadata_missing requested_max_id=" + maxId);
                return true;
            }
            if ("chat".equals(peerType)) {
                TLRPC.Chat chat = messagesController.getChat(peerId);
                android.util.Log.i("CrossgramE2E", "history_peer_ready peer_id=" + peerId
                        + " class=" + (chat == null ? "raw" : chat.getClass().getSimpleName()));
            }
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
                        int firstId = 0;
                        int lastId = 0;
                        int previousId = Integer.MAX_VALUE;
                        boolean orderedDescending = true;
                        java.util.HashSet<Integer> uniqueIds = new java.util.HashSet<>();
                        for (MessageObject object : loaded) {
                            int messageId = object.getId();
                            if (messageId > 0) {
                                if (firstId == 0) {
                                    firstId = messageId;
                                }
                                lastId = messageId;
                                if (messageId > previousId) {
                                    orderedDescending = false;
                                }
                                previousId = messageId;
                                uniqueIds.add(messageId);
                                minId = Math.min(minId, messageId);
                                maxLoadedId = Math.max(maxLoadedId, messageId);
                            }
                        }
                        android.util.Log.i("CrossgramE2E", "history_loaded source=" + ((Boolean) args[3] ? "cache" : "server")
                                + " count=" + loaded.size()
                                + " min_id=" + (minId == Integer.MAX_VALUE ? 0 : minId)
                                + " max_id=" + (maxLoadedId == Integer.MIN_VALUE ? 0 : maxLoadedId)
                                + " first_id=" + firstId
                                + " last_id=" + lastId
                                + " ordered_desc=" + orderedDescending
                                + " unique_count=" + uniqueIds.size()
                                + " end=" + args[9]
                                + " load_type=" + loadType
                                + " requested_max_id=" + maxId
                                + " duration_ms=" + (android.os.SystemClock.elapsedRealtime() - startedAt));
                    } else if (id == NotificationCenter.loadingMessagesFailed && (Integer) args[0] == classGuid) {
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.messagesDidLoad);
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.loadingMessagesFailed);
                        android.util.Log.e("CrossgramE2E", "history_failed reason=load_failed requested_max_id=" + maxId);
                    }
                }
            };
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.messagesDidLoad);
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.loadingMessagesFailed);
            messagesController.loadMessages(
                    dialogId, 0, false, count, maxId, 0, fromCache, 0, classGuid,
                    loadType, 0, ChatActivity.MODE_DEFAULT, 0, 0, 0, false);
            android.util.Log.i("CrossgramE2E", "function_called:loadMessages source=" + (fromCache ? "cache" : "server")
                    + " load_type=" + loadType
                    + " requested_max_id=" + maxId);
            return true;
    }

    private boolean runCrossgramE2eWithMessage(
            Intent intent,
            String operation,
            java.util.function.Consumer<MessageObject> action) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            int targetId = intent.getIntExtra("crossgram_e2e_target_message_id", 0);
            int classGuid = ConnectionsManager.generateClassGuid();
            NotificationCenter.NotificationCenterDelegate observer = new NotificationCenter.NotificationCenterDelegate() {
                @Override
                public void didReceivedNotification(int id, int account, Object... args) {
                    if (id == NotificationCenter.messagesDidLoad && (Integer) args[10] == classGuid) {
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.messagesDidLoad);
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.loadingMessagesFailed);
                        java.util.ArrayList<MessageObject> loaded = (java.util.ArrayList<MessageObject>) args[2];
                        MessageObject target = null;
                        for (MessageObject object : loaded) {
                            if (object.getId() == targetId) {
                                target = object;
                                break;
                            }
                        }
                        if (target == null) {
                            android.util.Log.e("CrossgramE2E", operation + "_failed reason=target_missing target_id=" + targetId);
                            return;
                        }
                        android.util.Log.i("CrossgramE2E", "message_target_loaded operation=" + operation
                                + " target_id=" + targetId);
                        try {
                            action.accept(target);
                        } catch (Throwable error) {
                            android.util.Log.e("CrossgramE2E", operation + "_failed reason=action_exception target_id=" + targetId);
                        }
                    } else if (id == NotificationCenter.loadingMessagesFailed && (Integer) args[0] == classGuid) {
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.messagesDidLoad);
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.loadingMessagesFailed);
                        android.util.Log.e("CrossgramE2E", operation + "_failed reason=load_failed target_id=" + targetId);
                    }
                }
            };
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.messagesDidLoad);
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.loadingMessagesFailed);
            MessagesController.getInstance(currentAccount).loadMessages(
                    dialogId, 0, false, 30, targetId, 0, false, 0, classGuid,
                    MessagesController.LOAD_AROUND_MESSAGE, 0, ChatActivity.MODE_DEFAULT, 0, 0, 0, false);
            android.util.Log.i("CrossgramE2E", "function_called:loadMessageTarget operation=" + operation
                    + " target_id=" + targetId);
            return true;
    }

    private boolean runCrossgramE2eDownload(
            MessageObject target,
            long expectedMediaId,
            long expectedSize,
            boolean forceHttpFailure) {
            TLRPC.Document document = target.getDocument();
            TLRPC.Photo photo = target.messageOwner.media == null ? null : target.messageOwner.media.photo;
            TLRPC.PhotoSize photoSize = photo == null
                    ? null
                    : FileLoader.getClosestPhotoSizeWithSize(
                            photo.sizes, Integer.MAX_VALUE, false, null, true);
            byte[] reference = document != null
                    ? document.file_reference
                    : photo != null ? photo.file_reference : null;
            String expectedReference = "bridge-media:" + expectedMediaId;
            String actualReference = reference == null
                    ? ""
                    : new String(reference, java.nio.charset.StandardCharsets.UTF_8);
            if (expectedMediaId <= 0 || !expectedReference.equals(actualReference)) {
                android.util.Log.e("CrossgramE2E", "download_failed reason=file_reference_mismatch"
                        + " media_id=" + expectedMediaId);
                return true;
            }
            if (document == null && photoSize == null) {
                android.util.Log.e("CrossgramE2E", "download_failed reason=media_not_downloadable"
                        + " media_id=" + expectedMediaId);
                return true;
            }
            FileLoader loader = FileLoader.getInstance(currentAccount);
            String fileName = FileLoader.getAttachFileName(document != null ? document : photoSize);
            java.io.File existingFile = loader.getPathToAttach(document != null ? document : photoSize, false);
            NotificationCenter.NotificationCenterDelegate observer = new NotificationCenter.NotificationCenterDelegate() {
                private void remove() {
                    NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.fileLoaded);
                    NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.fileLoadFailed);
                    org.telegram.messenger.crossgram_direct.CrossgramDirectDownload
                            .setCrossgramE2eForceHttpFailure(false);
                }

                @Override
                public void didReceivedNotification(int id, int account, Object... args) {
                    if (!fileName.equals(args[0])) return;
                    if (id == NotificationCenter.fileLoaded) {
                        remove();
                        java.io.File file = (java.io.File) args[1];
                        long bytes = file.length();
                        if (expectedSize > 0 && bytes != expectedSize) {
                            android.util.Log.e("CrossgramE2E", "download_failed reason=size_mismatch"
                                    + " media_id=" + expectedMediaId
                                    + " bytes=" + bytes
                                    + " expected=" + expectedSize
                                    + " file=" + fileName);
                        } else {
                            android.util.Log.i("CrossgramE2E", "download_loaded"
                                    + " media_id=" + expectedMediaId
                                    + " bytes=" + bytes
                                    + " file=" + fileName);
                        }
                    } else if (id == NotificationCenter.fileLoadFailed) {
                        remove();
                        android.util.Log.e("CrossgramE2E", "download_failed reason=file_loader"
                                + " media_id=" + expectedMediaId
                                + " state=" + args[1]);
                    }
                }
            };
            if (document != null) {
                loader.cancelLoadFile(document, true);
            } else {
                loader.cancelLoadFile(photoSize, true);
            }
            if (existingFile.exists() && !existingFile.delete()) {
                android.util.Log.e("CrossgramE2E", "download_failed reason=cache_delete"
                        + " media_id=" + expectedMediaId
                        + " file=" + fileName);
                return true;
            }
            target.mediaExists = false;
            target.attachPathExists = false;
            target.loadingCancelled = false;
            AndroidUtilities.runOnUIThread(() -> {
                NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.fileLoaded);
                NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.fileLoadFailed);
                org.telegram.messenger.crossgram_direct.CrossgramDirectDownload
                        .setCrossgramE2eForceHttpFailure(forceHttpFailure);
                long dialogId = target.getDialogId();
                Bundle chatArgs = new Bundle();
                if (dialogId > 0) {
                    chatArgs.putLong("user_id", dialogId);
                } else {
                    chatArgs.putLong("chat_id", -dialogId);
                }
                chatArgs.putInt("message_id", target.getId());
                presentFragment(new ChatActivity(chatArgs));
                android.util.Log.i("CrossgramE2E", "download_ui_opened"
                        + " media_id=" + expectedMediaId
                        + " target_id=" + target.getId());
                android.util.Log.i("CrossgramE2E", "download_started"
                        + " media_id=" + expectedMediaId
                        + " forced_fallback=" + forceHttpFailure);
                AndroidUtilities.runOnUIThread(() -> {
                    if (document != null) {
                        loader.loadFile(document, target, FileLoader.PRIORITY_HIGH, 0);
                    } else {
                        loader.loadFile(
                                org.telegram.messenger.ImageLocation.getForPhoto(photoSize, photo),
                                target, "jpg", FileLoader.PRIORITY_HIGH, 0);
                    }
                }, 1000);
            }, 250);
            return true;
    }

    private boolean runCrossgramE2eSearch(Intent intent) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            String encodedQuery = intent.getStringExtra("crossgram_e2e_query_base64");
            String query = new String(android.util.Base64.decode(encodedQuery, android.util.Base64.DEFAULT),
                    java.nio.charset.StandardCharsets.UTF_8);
            int classGuid = ConnectionsManager.generateClassGuid();
            NotificationCenter.NotificationCenterDelegate observer = new NotificationCenter.NotificationCenterDelegate() {
                @Override
                public void didReceivedNotification(int id, int account, Object... args) {
                    if (id == NotificationCenter.chatSearchResultsAvailable && (Integer) args[0] == classGuid) {
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.chatSearchResultsAvailable);
                        int resultId = ((Number) args[1]).intValue();
                        int count = ((Number) args[5]).intValue();
                        android.util.Log.i("CrossgramE2E", "search_loaded count=" + count
                                + " result_id=" + resultId);
                    }
                }
            };
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.chatSearchResultsAvailable);
            MediaDataController.getInstance(currentAccount).searchMessagesInChat(
                    query, dialogId, 0, classGuid, 0, 0, null, null, null, null);
            android.util.Log.i("CrossgramE2E", "function_called:searchMessagesInChat");
            return true;
    }
