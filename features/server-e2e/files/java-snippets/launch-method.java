    private boolean handleCrossgramE2eIntent(Intent intent) {
        if (!BuildConfig.DEBUG || intent == null || !CrossgramE2eActivity.ACTION.equals(intent.getAction())) {
            return false;
        }
        String command = intent.getStringExtra(CrossgramE2eActivity.EXTRA_COMMAND);
        if ("login-phone".equals(command)) {
            LoginActivity login = new LoginActivity();
            presentFragment(login);
            String phone = intent.getStringExtra("crossgram_e2e_phone");
            AndroidUtilities.runOnUIThread(() -> login.runCrossgramE2eLogin(phone, null), 250);
            android.util.Log.i("CrossgramE2E", "page_opened:login");
            return true;
        }
        if ("login-code".equals(command)) {
            BaseFragment last = getActionBarLayout().getLastFragment();
            String code = intent.getStringExtra("crossgram_e2e_code");
            if (!(last instanceof LoginActivity)) {
                android.util.Log.e("CrossgramE2E", "login_code_failed reason=page_missing");
                return true;
            }
            ((LoginActivity) last).runCrossgramE2eCode(code);
            android.util.Log.i("CrossgramE2E", "function_called:runCrossgramE2eCode");
            return true;
        }
        if ("dialogs".equals(command)) {
            presentFragment(new DialogsActivity(new Bundle()));
            android.util.Log.i("CrossgramE2E", "page_opened:dialogs");
            return true;
        }
        if ("dialog-watch".equals(command)) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            String encodedMarker = intent.getStringExtra("crossgram_e2e_message_base64");
            String marker = new String(android.util.Base64.decode(encodedMarker, android.util.Base64.DEFAULT),
                    java.nio.charset.StandardCharsets.UTF_8);
            presentFragment(new DialogsActivity(new Bundle()));
            MessagesController messagesController = MessagesController.getInstance(currentAccount);
            java.util.ArrayList<MessageObject> initialMessages = messagesController.dialogMessage.get(dialogId);
            int initialId = initialMessages == null || initialMessages.isEmpty() ? 0 : initialMessages.get(0).getId();
            long startedAt = android.os.SystemClock.elapsedRealtime();
            final int[] attempts = { 0 };
            final Runnable[] inspect = new Runnable[1];
            inspect[0] = () -> {
                BaseFragment last = getActionBarLayout().getLastFragment();
                if (!(last instanceof DialogsActivity)) {
                    android.util.Log.e("CrossgramE2E", "dialog_update_failed reason=chat_opened");
                    return;
                }
                java.util.ArrayList<MessageObject> messages = messagesController.dialogMessage.get(dialogId);
                if (messages != null) {
                    for (MessageObject messageObject : messages) {
                        String text = messageObject.messageText == null ? "" : messageObject.messageText.toString();
                        if (text.contains(marker)) {
                            android.util.Log.i("CrossgramE2E", "dialog_updated_without_chat message_id="
                                    + messageObject.getId() + " initial_id=" + initialId + " elapsed_ms="
                                    + (android.os.SystemClock.elapsedRealtime() - startedAt));
                            return;
                        }
                    }
                }
                if (++attempts[0] >= 240) {
                    android.util.Log.e("CrossgramE2E", "dialog_update_failed reason=timeout initial_id=" + initialId);
                    return;
                }
                AndroidUtilities.runOnUIThread(inspect[0], 250);
            };
            AndroidUtilities.runOnUIThread(inspect[0], 250);
            android.util.Log.i("CrossgramE2E", "dialog_watch_ready initial_id=" + initialId);
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
        if ("stickers".equals(command)) {
            MediaDataController mediaDataController = MediaDataController.getInstance(currentAccount);
            mediaDataController.loadStickers(MediaDataController.TYPE_IMAGE, false, true, true);
            final int[] attempts = { 0 };
            final Runnable[] inspect = new Runnable[1];
            inspect[0] = () -> {
                java.util.ArrayList<TLRPC.TL_messages_stickerSet> packs =
                        mediaDataController.getStickerSets(MediaDataController.TYPE_IMAGE);
                if (!packs.isEmpty() || ++attempts[0] >= 60) {
                    android.util.Log.i("CrossgramE2E", "stickers_loaded count=" + packs.size());
                    for (TLRPC.TL_messages_stickerSet pack : packs) {
                        String title = android.util.Base64.encodeToString(
                                pack.set.title.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                                android.util.Base64.NO_WRAP);
                        String shortName = android.util.Base64.encodeToString(
                                pack.set.short_name.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                                android.util.Base64.NO_WRAP);
                        android.util.Log.i("CrossgramE2E", "sticker_pack set_id=" + pack.set.id
                                + " title_base64=" + title
                                + " short_name_base64=" + shortName
                                + " documents=" + pack.documents.size()
                                + " installed_date=" + pack.set.installed_date
                                + " archived=" + pack.set.archived);
                    }
                    return;
                }
                AndroidUtilities.runOnUIThread(inspect[0], 250);
            };
            AndroidUtilities.runOnUIThread(inspect[0], 250);
            android.util.Log.i("CrossgramE2E", "function_called:loadStickers");
            return true;
        }
        if ("sticker-install".equals(command)) {
            long setId = intent.getLongExtra("crossgram_e2e_sticker_set_id", 0);
            if (setId <= 0) {
                android.util.Log.e("CrossgramE2E", "sticker_install_failed reason=invalid_set_id");
                return true;
            }
            TLRPC.TL_messages_getStickerSet request = new TLRPC.TL_messages_getStickerSet();
            TLRPC.TL_inputStickerSetID input = new TLRPC.TL_inputStickerSetID();
            input.id = setId;
            input.access_hash = 1;
            request.stickerset = input;
            request.hash = 0;
            ConnectionsManager.getInstance(currentAccount).sendRequest(request, (response, error) ->
                    AndroidUtilities.runOnUIThread(() -> {
                        if (error != null || !(response instanceof TLRPC.TL_messages_stickerSet)) {
                            android.util.Log.e("CrossgramE2E", "sticker_install_failed reason=get_sticker_set"
                                    + " code=" + (error == null ? 0 : error.code)
                                    + " text=" + (error == null ? "unexpected_response" : error.text));
                            return;
                        }
                        TLRPC.TL_messages_stickerSet pack = (TLRPC.TL_messages_stickerSet) response;
                        MediaDataController.getInstance(currentAccount).toggleStickerSet(
                                LaunchActivity.this, pack, 2, getActionBarLayout().getLastFragment(), false, false);
                        android.util.Log.i("CrossgramE2E", "function_called:toggleStickerSet set_id=" + pack.set.id);
                    }));
            android.util.Log.i("CrossgramE2E", "function_called:getStickerSet set_id=" + setId);
            return true;
        }
        if ("sticker-uninstall".equals(command)) {
            long setId = intent.getLongExtra("crossgram_e2e_sticker_set_id", 0);
            if (setId <= 0) {
                android.util.Log.e("CrossgramE2E", "sticker_uninstall_failed reason=invalid_set_id");
                return true;
            }
            TLRPC.TL_messages_getStickerSet request = new TLRPC.TL_messages_getStickerSet();
            TLRPC.TL_inputStickerSetID input = new TLRPC.TL_inputStickerSetID();
            input.id = setId;
            input.access_hash = 1;
            request.stickerset = input;
            request.hash = 0;
            ConnectionsManager.getInstance(currentAccount).sendRequest(request, (response, error) ->
                    AndroidUtilities.runOnUIThread(() -> {
                        if (error != null || !(response instanceof TLRPC.TL_messages_stickerSet)) {
                            android.util.Log.e("CrossgramE2E", "sticker_uninstall_failed reason=get_sticker_set"
                                    + " code=" + (error == null ? 0 : error.code)
                                    + " text=" + (error == null ? "unexpected_response" : error.text));
                            return;
                        }
                        TLRPC.TL_messages_stickerSet pack = (TLRPC.TL_messages_stickerSet) response;
                        MediaDataController.getInstance(currentAccount).toggleStickerSet(
                                LaunchActivity.this, pack, 0, getActionBarLayout().getLastFragment(), false, false);
                        android.util.Log.i("CrossgramE2E", "function_called:removeStickerSet set_id=" + pack.set.id);
                    }));
            android.util.Log.i("CrossgramE2E", "function_called:getStickerSetForRemoval set_id=" + setId);
            return true;
        }
        if ("sticker-recent-seed".equals(command)) {
            long setId = intent.getLongExtra("crossgram_e2e_sticker_set_id", 0);
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            if (setId <= 0 || peerId <= 0) {
                android.util.Log.e("CrossgramE2E", "sticker_recent_seed_failed reason=invalid_target");
                return true;
            }
            TLRPC.TL_messages_getStickerSet request = new TLRPC.TL_messages_getStickerSet();
            TLRPC.TL_inputStickerSetID input = new TLRPC.TL_inputStickerSetID();
            input.id = setId;
            input.access_hash = 1;
            request.stickerset = input;
            request.hash = 0;
            ConnectionsManager.getInstance(currentAccount).sendRequest(request, (response, error) ->
                    AndroidUtilities.runOnUIThread(() -> {
                        if (error != null || !(response instanceof TLRPC.TL_messages_stickerSet)) {
                            android.util.Log.e("CrossgramE2E", "sticker_recent_seed_failed reason=get_sticker_set"
                                    + " code=" + (error == null ? 0 : error.code)
                                    + " text=" + (error == null ? "unexpected_response" : error.text));
                            return;
                        }
                        TLRPC.TL_messages_stickerSet pack = (TLRPC.TL_messages_stickerSet) response;
                        if (pack.documents.isEmpty()) {
                            android.util.Log.e("CrossgramE2E", "sticker_recent_seed_failed reason=empty_pack");
                            return;
                        }
                        TLRPC.Document document = pack.documents.get(0);
                        MediaDataController.getInstance(currentAccount).addRecentSticker(
                                MediaDataController.TYPE_IMAGE, pack, document,
                                (int) (System.currentTimeMillis() / 1000), false);
                        SendMessagesHelper.getInstance(currentAccount).sendSticker(
                                document, null, dialogId, null, null, null, null, null,
                                true, 0, 0, false, pack, null, 0, 0, 0, null);
                        android.util.Log.i("CrossgramE2E", "sticker_recent_seed_started document_id=" + document.id);
                    }));
            android.util.Log.i("CrossgramE2E", "function_called:getStickerSetForRecent set_id=" + setId);
            return true;
        }
        if ("sticker-recent-send".equals(command)) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            if (peerId <= 0) {
                android.util.Log.e("CrossgramE2E", "sticker_recent_send_failed reason=invalid_target");
                return true;
            }
            MediaDataController mediaDataController = MediaDataController.getInstance(currentAccount);
            mediaDataController.loadRecents(MediaDataController.TYPE_IMAGE, false, true, true);
            final int[] attempts = { 0 };
            final Runnable[] inspect = new Runnable[1];
            inspect[0] = () -> {
                java.util.ArrayList<TLRPC.Document> recent =
                        mediaDataController.getRecentStickers(MediaDataController.TYPE_IMAGE);
                if (!recent.isEmpty()) {
                    TLRPC.Document document = recent.get(0);
                    SendMessagesHelper.getInstance(currentAccount).sendSticker(
                            document, null, dialogId, null, null, null, null, null,
                            true, 0, 0, false, null, null, 0, 0, 0, null);
                    android.util.Log.i("CrossgramE2E", "sticker_recent_send_started document_id=" + document.id);
                    return;
                }
                if (++attempts[0] >= 120) {
                    android.util.Log.e("CrossgramE2E", "sticker_recent_send_failed reason=empty_recent");
                    return;
                }
                AndroidUtilities.runOnUIThread(inspect[0], 250);
            };
            AndroidUtilities.runOnUIThread(inspect[0], 250);
            android.util.Log.i("CrossgramE2E", "function_called:loadRecentStickers");
            return true;
        }
        if ("raw-animation-file".equals(command)) {
            String filePath = intent.getStringExtra("crossgram_e2e_file");
            String expectedFormat = intent.getStringExtra("crossgram_e2e_format");
            Utilities.globalQueue.postRunnable(() -> {
                java.io.File file = filePath == null ? null : new java.io.File(filePath);
                boolean apng = org.telegram.messenger.crossgram_animation.CrossgramRawAnimationSniffer
                        .isAnimatedPng(file);
                boolean gif = org.telegram.messenger.crossgram_animation.CrossgramRawAnimationSniffer
                        .isGif(file);
                boolean expected = "apng".equals(expectedFormat) ? apng
                        : "gif".equals(expectedFormat) && gif;
                org.telegram.ui.Components.AnimatedFileDrawable drawable = null;
                try {
                    drawable = new org.telegram.ui.Components.AnimatedFileDrawable(
                            file, true, 0, 0, null, null, null, 0, currentAccount, false, null);
                    android.graphics.Bitmap frame = drawable.getNextFrame(true);
                    long firstChecksum = crossgramE2eBitmapChecksum(frame);
                    long secondChecksum = Long.MIN_VALUE;
                    long loopChecksum = Long.MIN_VALUE;
                    boolean changed = false;
                    boolean looped = false;
                    for (int frameAttempt = 0; frameAttempt < 16 && !looped; frameAttempt++) {
                        frame = drawable.getNextFrame(true);
                        long checksum = crossgramE2eBitmapChecksum(frame);
                        if (!changed && checksum != firstChecksum) {
                            changed = true;
                            secondChecksum = checksum;
                        } else if (changed && checksum == firstChecksum) {
                            looped = true;
                            loopChecksum = checksum;
                        }
                    }
                    if (!expected || frame == null || !changed || !looped) {
                        android.util.Log.e("CrossgramE2E", "raw_animation_failed format=" + expectedFormat
                                + " apng=" + apng + " gif=" + gif
                                + " frame=" + (frame != null)
                                + " frames_changed=" + changed + " looped=" + looped
                                + " first_checksum=" + firstChecksum
                                + " second_checksum=" + secondChecksum
                                + " loop_checksum=" + loopChecksum);
                    } else {
                        android.util.Log.i("CrossgramE2E", "raw_animation_decoded format="
                                + expectedFormat + " width=" + drawable.getIntrinsicWidth()
                                + " height=" + drawable.getIntrinsicHeight()
                                + " duration_ms=" + drawable.getDurationMs()
                                + " frames_changed=true looped=true first_checksum="
                                + firstChecksum + " second_checksum=" + secondChecksum
                                + " loop_checksum=" + loopChecksum);
                    }
                } catch (Throwable error) {
                    android.util.Log.e("CrossgramE2E", "raw_animation_failed reason="
                            + error.getClass().getSimpleName());
                } finally {
                    if (drawable != null) drawable.recycle();
                }
            });
            android.util.Log.i("CrossgramE2E", "function_called:rawAnimationFile");
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
                // Nagram may return 0 even after the forward has been queued.
                // The host-side E2E verifies the authoritative new relay row.
                android.util.Log.i("CrossgramE2E", "function_called:forwardMessages target_id=" + target.getId()
                        + " request_id=" + requestId);
            });
        }
        if ("merged-forward".equals(command)) {
            long destinationPeerId = intent.getLongExtra("crossgram_e2e_destination_peer_id", 0);
            String destinationPeerType = intent.getStringExtra("crossgram_e2e_destination_peer_type");
            long destinationDialogId = "user".equals(destinationPeerType) ? destinationPeerId : -destinationPeerId;
            return runCrossgramE2eWithMessages(intent, "merged_forward", messages -> {
                NotificationCenter.NotificationCenterDelegate sendErrorObserver =
                        new NotificationCenter.NotificationCenterDelegate() {
                    @Override
                    public void didReceivedNotification(int id, int account, Object... args) {
                        if (id == NotificationCenter.messageSendError) {
                            android.util.Log.e("CrossgramE2E", "merged_forward_failed reason=message_send_error"
                                    + " local_id=" + args[0]);
                        }
                    }
                };
                NotificationCenter.getInstance(currentAccount).addObserver(
                        sendErrorObserver, NotificationCenter.messageSendError);
                AndroidUtilities.runOnUIThread(() -> NotificationCenter.getInstance(currentAccount)
                        .removeObserver(sendErrorObserver, NotificationCenter.messageSendError), 30000);
                int requestId = SendMessagesHelper.getInstance(currentAccount)
                        .sendMessage(messages, destinationDialogId, false, false, true, 0, 0);
                android.util.Log.i("CrossgramE2E", "function_called:mergedForwardMessages count="
                        + messages.size() + " request_id=" + requestId);
            });
        }
        if ("open-merged-forward".equals(command)) {
            return runCrossgramE2eWithMessage(intent, "open_merged_forward", target -> {
                TLRPC.WebPage webPage = target.messageOwner.media == null
                        ? null : target.messageOwner.media.webpage;
                String url = webPage == null ? null : webPage.url;
                String description = webPage == null ? null : webPage.description;
                String compact = description == null ? "" : description.replaceAll("\\s+", "");
                java.util.regex.Matcher link = url == null ? null : java.util.regex.Pattern.compile(
                        "(?i)^https?://(?:www\\.)?t\\.me/bridgechat_[1-9][0-9]*/"
                                + "([1-9][0-9]*)/?(?:[?#].*)?$").matcher(url);
                if (link == null || !link.matches()) {
                    android.util.Log.e("CrossgramE2E", "open_merged_forward_failed reason=invalid_url");
                    return;
                }
                if (description == null || description.trim().isEmpty()
                        || compact.matches("^(?:共)?[xX×0-9]+条消息的合并转发$")
                        || compact.matches("^(?:点击)?查看(?:[xX×0-9]+条)?(?:消息的)?(?:合并)?转发(?:消息)?$")) {
                    android.util.Log.e("CrossgramE2E", "open_merged_forward_failed reason=generic_preview");
                    return;
                }
                String preview = android.util.Base64.encodeToString(
                        description.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                        android.util.Base64.NO_WRAP);
                android.util.Log.i("CrossgramE2E", "merged_forward_preview_ready preview_base64=" + preview
                        + " target_message_id=" + link.group(1));
                org.telegram.messenger.browser.Browser.openUrl(LaunchActivity.this, android.net.Uri.parse(url));
                final int[] attempts = { 0 };
                final Runnable[] verify = new Runnable[1];
                verify[0] = () -> {
                    BaseFragment last = getActionBarLayout().getLastFragment();
                    if (last instanceof ChatActivity
                            && ((ChatActivity) last).getDialogId() != target.getDialogId()) {
                        android.util.Log.i("CrossgramE2E", "merged_forward_opened dialog_id="
                                + ((ChatActivity) last).getDialogId());
                        return;
                    }
                    if (++attempts[0] >= 40) {
                        android.util.Log.e("CrossgramE2E", "open_merged_forward_failed reason=page_timeout");
                        return;
                    }
                    AndroidUtilities.runOnUIThread(verify[0], 250);
                };
                AndroidUtilities.runOnUIThread(verify[0], 250);
                android.util.Log.i("CrossgramE2E", "function_called:openMergedForward");
            });
        }
        if ("reaction".equals(command)) {
            String reaction = intent.getStringExtra("crossgram_e2e_reaction");
            return runCrossgramE2eWithMessage(intent, "reaction",
                    target -> sendCrossgramE2eSelectedReaction(target, reaction));
        }
        if ("reaction-inspect".equals(command)) {
            String reaction = intent.getStringExtra("crossgram_e2e_reaction");
            return runCrossgramE2eWithMessage(intent, "reaction_inspect", target ->
                    inspectCrossgramE2eReaction(target, reaction));
        }
        if ("reaction-actors".equals(command)) {
            return runCrossgramE2eWithMessage(intent, "reaction_actors", this::inspectCrossgramE2eReactionActors);
        }
        if ("reaction-panel".equals(command)) {
            boolean clearCache = intent.getBooleanExtra("crossgram_e2e_clear_reaction_cache", true);
            return runCrossgramE2eWithMessage(intent, "reaction_panel", target ->
                    inspectCrossgramE2eReactionPanel(target, clearCache));
        }
        if ("send".equals(command)) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            boolean expectSendError = intent.getBooleanExtra("crossgram_e2e_expect_send_error", false);
            String encodedMessage = intent.getStringExtra("crossgram_e2e_message_base64");
            String message = encodedMessage == null
                    ? intent.getStringExtra("crossgram_e2e_message")
                    : new String(android.util.Base64.decode(encodedMessage, android.util.Base64.DEFAULT),
                            java.nio.charset.StandardCharsets.UTF_8);
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            if (expectSendError) {
                NotificationCenter.NotificationCenterDelegate observer = new NotificationCenter.NotificationCenterDelegate() {
                    @Override
                    public void didReceivedNotification(int id, int account, Object... args) {
                        if (id != NotificationCenter.messageSendError) {
                            return;
                        }
                        NotificationCenter.getInstance(currentAccount).removeObserver(
                                this, NotificationCenter.messageSendError);
                        android.util.Log.i("CrossgramE2E", "send_error local_id=" + args[0]);
                    }
                };
                NotificationCenter.getInstance(currentAccount).addObserver(
                        observer, NotificationCenter.messageSendError);
            }
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

    private String crossgramE2eReactionKey(TLRPC.Reaction reaction) {
        if (reaction instanceof TLRPC.TL_reactionEmoji) {
            return ((TLRPC.TL_reactionEmoji) reaction).emoticon;
        }
        if (reaction instanceof TLRPC.TL_reactionCustomEmoji) {
            return Long.toString(((TLRPC.TL_reactionCustomEmoji) reaction).document_id);
        }
        if (reaction instanceof TLRPC.TL_reactionPaid) {
            return "stars";
        }
        return "unknown";
    }

    private void sendCrossgramE2eSelectedReaction(MessageObject target, String reaction) {
        org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction visible =
                org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction.fromEmojicon(reaction);
        boolean alreadySelected = false;
        for (org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction selected
                : target.getChoosenReactions()) {
            if ((visible.emojicon != null && visible.emojicon.equals(selected.emojicon))
                    || (visible.documentId != 0 && visible.documentId == selected.documentId)) {
                alreadySelected = true;
                break;
            }
        }
        if (alreadySelected) {
            target.selectReaction(visible, false, false);
            SendMessagesHelper.getInstance(currentAccount).sendReaction(
                    target, target.getChoosenReactions(), visible, false, true,
                    getActionBarLayout().getLastFragment(), () -> {
                        android.util.Log.i("CrossgramE2E", "reaction_reset target_id=" + target.getId());
                        AndroidUtilities.runOnUIThread(() -> sendCrossgramE2eSelectedReaction(target, reaction));
                    });
            return;
        }
        boolean added = target.selectReaction(visible, false, false);
        java.util.ArrayList<org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction> reactions =
                target.getChoosenReactions();
        SendMessagesHelper.getInstance(currentAccount).sendReaction(
                target, reactions, visible, false, true, getActionBarLayout().getLastFragment(),
                () -> {
                    inspectCrossgramE2eReaction(target, reaction);
                    android.util.Log.i("CrossgramE2E", "reaction_applied target_id=" + target.getId());
                });
        android.util.Log.i("CrossgramE2E", "function_called:sendReaction target_id=" + target.getId()
                + " selected_count=" + reactions.size() + " added=" + added);
    }

    private void inspectCrossgramE2eReaction(MessageObject target, String expected) {
        org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble layout =
                new org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble(
                        new android.view.View(ApplicationLoader.applicationContext));
        layout.setMessage(target, false, false, null);
        String first = layout.reactionButtons.isEmpty() ? "none" : layout.reactionButtons.get(0).key;
        int selected = 0;
        int expectedOrder = 0;
        java.util.ArrayList<Long> customDocumentIds = new java.util.ArrayList<>();
        for (org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.ReactionButton button
                : layout.reactionButtons) {
            if (button.choosen) selected++;
            if (expected.equals(button.key)) expectedOrder = button.choosenOrder;
            if (button.reaction instanceof TLRPC.TL_reactionCustomEmoji) {
                customDocumentIds.add(((TLRPC.TL_reactionCustomEmoji) button.reaction).document_id);
            }
        }
        if (!expected.equals(first) || expectedOrder <= 0) {
            android.util.Log.e("CrossgramE2E", "reaction_inspect_failed reason=order first=" + first
                    + " expected=" + expected + " expected_order=" + expectedOrder);
            return;
        }
        android.util.Log.i("CrossgramE2E", "reaction_layout_ready first=" + first
                + " selected=" + selected + " buttons=" + layout.reactionButtons.size()
                + " expected_order=" + expectedOrder);

        if (customDocumentIds.isEmpty()) {
            android.util.Log.i("CrossgramE2E", "reaction_documents_loaded requested=0 loaded=0");
        } else {
            TLRPC.TL_messages_getCustomEmojiDocuments request = new TLRPC.TL_messages_getCustomEmojiDocuments();
            request.document_id = customDocumentIds;
            ConnectionsManager.getInstance(currentAccount).sendRequest(request, (response, error) -> {
                int loaded = response instanceof Vector ? ((Vector) response).objects.size() : 0;
                if (error != null || loaded != customDocumentIds.size()) {
                    android.util.Log.e("CrossgramE2E", "reaction_inspect_failed reason=documents requested="
                            + customDocumentIds.size() + " loaded=" + loaded);
                } else {
                    android.util.Log.i("CrossgramE2E", "reaction_documents_loaded requested="
                            + customDocumentIds.size() + " loaded=" + loaded);
                }
            });
        }

        MediaDataController mediaDataController = MediaDataController.getInstance(currentAccount);
        mediaDataController.loadRecentAndTopReactions(true);
        final int[] attempts = { 0 };
        final Runnable[] inspectRecent = new Runnable[1];
        inspectRecent[0] = () -> {
            java.util.ArrayList<TLRPC.Reaction> recent = mediaDataController.getRecentReactions();
            String recentFirst = recent.isEmpty() ? "none" : crossgramE2eReactionKey(recent.get(0));
            if (expected.equals(recentFirst)) {
                android.util.Log.i("CrossgramE2E", "reaction_recent_ready first=" + recentFirst
                        + " count=" + recent.size());
                return;
            }
            if (++attempts[0] >= 120) {
                android.util.Log.e("CrossgramE2E", "reaction_inspect_failed reason=recent first=" + recentFirst
                        + " expected=" + expected);
                return;
            }
            AndroidUtilities.runOnUIThread(inspectRecent[0], 250);
        };
        AndroidUtilities.runOnUIThread(inspectRecent[0], 250);
    }

    private void inspectCrossgramE2eReactionActors(MessageObject target) {
        if (target.messageOwner.reactions == null || target.messageOwner.reactions.results.isEmpty()) {
            android.util.Log.e("CrossgramE2E", "reaction_actors_failed reason=no_reactions");
            return;
        }
        TLRPC.TL_messages_getMessagesReactions refresh = new TLRPC.TL_messages_getMessagesReactions();
        refresh.peer = MessagesController.getInstance(currentAccount).getInputPeer(target.getDialogId());
        refresh.id.add(target.getId());
        ConnectionsManager.getInstance(currentAccount).sendRequest(refresh, (response, error) -> {
            if (error != null || !(response instanceof TLRPC.Updates)) {
                android.util.Log.e("CrossgramE2E", "reaction_actors_failed reason=refresh error="
                        + (error == null ? "invalid_response" : error.text));
                return;
            }
            TLRPC.Updates updates = (TLRPC.Updates) response;
            MessagesController controller = MessagesController.getInstance(currentAccount);
            controller.putUsers(updates.users, false);
            controller.putChats(updates.chats, false);
            TLRPC.TL_messageReactions refreshed = null;
            for (TLRPC.Update update : updates.updates) {
                if (update instanceof org.telegram.tgnet.tl.TL_update.TL_updateMessageReactions
                        && ((org.telegram.tgnet.tl.TL_update.TL_updateMessageReactions) update).msg_id
                                == target.getId()) {
                    refreshed = ((org.telegram.tgnet.tl.TL_update.TL_updateMessageReactions) update).reactions;
                    break;
                }
            }
            if (refreshed == null) {
                android.util.Log.e("CrossgramE2E", "reaction_actors_failed reason=update_missing");
                return;
            }
            TLRPC.TL_messageReactions finalRefreshed = refreshed;
            AndroidUtilities.runOnUIThread(() -> {
                target.messageOwner.reactions = finalRefreshed;
                org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble layout =
                        new org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble(
                                new android.view.View(ApplicationLoader.applicationContext));
                layout.setMessage(target, false, false, null);
                int total = 0;
                for (TLRPC.ReactionCount count : finalRefreshed.results) total += count.count;
                java.util.HashSet<Long> previewPeers = new java.util.HashSet<>();
                for (TLRPC.MessagePeerReaction actor : finalRefreshed.recent_reactions) {
                    previewPeers.add(MessageObject.getPeerId(actor.peer_id));
                }
                int previewUsers = 0;
                int previewButtons = 0;
                try {
                    java.lang.reflect.Field usersField =
                            org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.ReactionButton.class
                                    .getDeclaredField("users");
                    usersField.setAccessible(true);
                    for (org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.ReactionButton button
                            : layout.reactionButtons) {
                        java.util.ArrayList<?> users = (java.util.ArrayList<?>) usersField.get(button);
                        if (users != null && !users.isEmpty()) {
                            previewButtons++;
                            previewUsers += users.size();
                        }
                    }
                } catch (Throwable reflectionError) {
                    android.util.Log.e("CrossgramE2E", "reaction_actors_failed reason=preview_reflection error="
                            + reflectionError.getClass().getSimpleName());
                    return;
                }
                final int finalTotal = total;
                final int finalPreviewUsers = previewUsers;
                final int finalPreviewButtons = previewButtons;

                TLRPC.TL_messages_getMessageReactionsList list =
                        new TLRPC.TL_messages_getMessageReactionsList();
                list.peer = refresh.peer;
                list.id = target.getId();
                list.limit = 100;
                ConnectionsManager.getInstance(currentAccount).sendRequest(list, (listResponse, listError) -> {
                    if (listError != null || !(listResponse instanceof TLRPC.TL_messages_messageReactionsList)) {
                        android.util.Log.e("CrossgramE2E", "reaction_actors_failed reason=list error="
                                + (listError == null ? "invalid_response" : listError.text));
                        return;
                    }
                    TLRPC.TL_messages_messageReactionsList actors =
                            (TLRPC.TL_messages_messageReactionsList) listResponse;
                    controller.putUsers(actors.users, false);
                    controller.putChats(actors.chats, false);
                    java.util.HashSet<Long> fullPeers = new java.util.HashSet<>();
                    for (TLRPC.MessagePeerReaction actor : actors.reactions) {
                        fullPeers.add(MessageObject.getPeerId(actor.peer_id));
                    }
                    boolean matches = fullPeers.containsAll(previewPeers);
                    android.util.Log.i("CrossgramE2E", "reaction_actors_ready total=" + finalTotal
                            + " recent=" + previewPeers.size() + " preview_users=" + finalPreviewUsers
                            + " preview_buttons=" + finalPreviewButtons + " full=" + actors.reactions.size()
                            + " matches=" + matches);
                });
            });
        });
        android.util.Log.i("CrossgramE2E", "function_called:getMessagesReactions target_id=" + target.getId());
    }

    private void inspectCrossgramE2eReactionPanel(MessageObject target, boolean clearCache) {
        BaseFragment last = getActionBarLayout().getLastFragment();
        if (!(last instanceof ChatActivity)) {
            android.util.Log.e("CrossgramE2E", "reaction_panel_failed reason=chat_missing");
            return;
        }
        ChatActivity chat = (ChatActivity) last;
        android.view.ViewGroup root = (android.view.ViewGroup) getWindow().getDecorView();
        android.view.View previous = root.findViewWithTag("crossgram_e2e_reaction_panel");
        if (previous != null) {
            root.removeView(previous);
        }

        java.util.LinkedHashMap<String, TLRPC.Document> documentsToClear = new java.util.LinkedHashMap<>();
        for (TLRPC.TL_availableReaction reaction : MediaDataController.getInstance(currentAccount)
                .getReactionsMap().values()) {
            TLRPC.Document[] documents = {
                    reaction.static_icon, reaction.appear_animation, reaction.select_animation,
                    reaction.activate_animation, reaction.effect_animation, reaction.around_animation,
                    reaction.center_icon
            };
            for (TLRPC.Document document : documents) {
                if (document != null) {
                    documentsToClear.put(FileLoader.getAttachFileName(document), document);
                }
            }
        }

        org.telegram.ui.Components.ReactionsContainerLayout panel =
                new org.telegram.ui.Components.ReactionsContainerLayout(
                        org.telegram.ui.Components.ReactionsContainerLayout.TYPE_DEFAULT,
                        chat, chat.getContext(), currentAccount, chat.getResourceProvider());
        panel.setTag("crossgram_e2e_reaction_panel");
        panel.setPadding(AndroidUtilities.dp(28), AndroidUtilities.dp(4),
                AndroidUtilities.dp(28), AndroidUtilities.dp(22));
        panel.setDelegate(new org.telegram.ui.Components.ReactionsContainerLayout.ReactionsContainerDelegate() {
            @Override
            public void onReactionClicked(android.view.View view,
                    org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction visibleReaction,
                    boolean longpress, boolean addToRecent) {
                // The E2E panel is read-only; it only exercises production rendering and loading.
            }
        });
        android.widget.FrameLayout.LayoutParams params = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                (int) (AndroidUtilities.dp(74) + panel.getTopOffset()), android.view.Gravity.TOP);
        params.topMargin = AndroidUtilities.statusBarHeight + AndroidUtilities.dp(52);
        panel.setLayoutParams(params);
        panel.setMessage(target, chat.getCurrentChatInfo(), false);
        panel.setTransitionProgress(1f);

        java.util.LinkedHashMap<String, TLRPC.Document> coldDocuments = new java.util.LinkedHashMap<>();
        for (org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction visible
                : panel.getVisibleReactionsList()) {
            if (visible.documentId != 0) {
                TLRPC.Document document = org.telegram.ui.Components.AnimatedEmojiDrawable.findDocument(
                        currentAccount, visible.documentId);
                if (document != null) {
                    coldDocuments.put(FileLoader.getAttachFileName(document), document);
                }
                continue;
            }
            if (visible.emojicon == null) {
                continue;
            }
            TLRPC.TL_availableReaction reaction = MediaDataController.getInstance(currentAccount)
                    .getReactionsMap().get(visible.emojicon);
            if (reaction == null) {
                continue;
            }
            TLRPC.Document[] documents = {
                    reaction.appear_animation, reaction.select_animation, reaction.around_animation
            };
            for (TLRPC.Document document : documents) {
                if (document != null) {
                    coldDocuments.put(FileLoader.getAttachFileName(document), document);
                }
            }
        }

        if (clearCache) {
            FileLoader loader = FileLoader.getInstance(currentAccount);
            documentsToClear.putAll(coldDocuments);
            for (TLRPC.Document document : documentsToClear.values()) {
                loader.cancelLoadFile(document, true);
                java.io.File path = loader.getPathToAttach(document, true);
                if (path.exists() && !path.delete()) {
                    android.util.Log.e("CrossgramE2E", "reaction_panel_failed reason=cache_delete file="
                            + FileLoader.getAttachFileName(document));
                    return;
                }
            }
        }

        root.addView(panel, params);
        panel.bringToFront();
        panel.startEnterAnimation(false);
        android.util.Log.i("CrossgramE2E", "reaction_panel_opened visible="
                + panel.getVisibleReactionsList().size() + " resources=" + coldDocuments.size()
                + " cleared_resources=" + documentsToClear.size() + " cleared=" + clearCache);

        final int[] attempts = { 0 };
        final Runnable[] inspect = new Runnable[1];
        inspect[0] = () -> {
            int holders = 0;
            int loadedHolders = 0;
            int missingDocuments = 0;
            java.util.HashSet<String> holderKeys = new java.util.HashSet<>();
            for (int i = 0; i < panel.recyclerListView.getChildCount(); i++) {
                android.view.View child = panel.recyclerListView.getChildAt(i);
                if (!(child instanceof org.telegram.ui.Components.ReactionsContainerLayout.ReactionHolderView)) {
                    continue;
                }
                holders++;
                org.telegram.ui.Components.ReactionsContainerLayout.ReactionHolderView holder =
                        (org.telegram.ui.Components.ReactionsContainerLayout.ReactionHolderView) child;
                org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction visible =
                        holder.currentReaction;
                if (visible != null) {
                    holderKeys.add(visible.documentId != 0
                            ? "custom:" + visible.documentId : "emoji:" + visible.emojicon);
                }
                org.telegram.messenger.ImageReceiver enter = holder.enterImageView.getImageReceiver();
                org.telegram.messenger.ImageReceiver loop = holder.loopImageView.animatedEmojiDrawable != null
                        ? holder.loopImageView.animatedEmojiDrawable.getImageReceiver()
                        : holder.loopImageView.getImageReceiver();
                boolean enterLoaded = enter != null && enter.hasImageLoaded();
                boolean loopLoaded = loop != null && loop.hasImageLoaded();
                if ((holder.hasEnterAnimation && enterLoaded && loopLoaded)
                        || (!holder.hasEnterAnimation && loopLoaded)) {
                    loadedHolders++;
                }
            }

            java.util.LinkedHashMap<String, TLRPC.Document> documents = new java.util.LinkedHashMap<>(coldDocuments);
            for (org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble.VisibleReaction visible
                    : panel.getVisibleReactionsList()) {
                if (visible.documentId == 0) {
                    continue;
                }
                TLRPC.Document document = org.telegram.ui.Components.AnimatedEmojiDrawable.findDocument(
                        currentAccount, visible.documentId);
                if (document == null) {
                    missingDocuments++;
                } else {
                    documents.put(FileLoader.getAttachFileName(document), document);
                }
            }
            int loadedFiles = 0;
            FileLoader loader = FileLoader.getInstance(currentAccount);
            for (TLRPC.Document document : documents.values()) {
                if (loader.getPathToAttach(document, true).exists()) {
                    loadedFiles++;
                }
            }
            int expectedHolders = panel.getVisibleReactionsList().size();
            boolean holdersReady = expectedHolders > 0 && holders == expectedHolders
                    && loadedHolders == expectedHolders && holderKeys.size() == expectedHolders;
            boolean filesReady = missingDocuments == 0 && !documents.isEmpty()
                    && loadedFiles == documents.size();
            if (holdersReady && filesReady) {
                android.util.Log.i("CrossgramE2E", "reaction_panel_compact_loaded holders=" + holders
                        + " loaded=" + loadedHolders + " files=" + loadedFiles
                        + " resources=" + documents.size() + " missing_documents=0");
                inspectCrossgramE2eExpandedReactionPanel(
                        panel, holders, loadedHolders, loadedFiles, documents.size());
                return;
            }
            if (attempts[0] % 20 == 0) {
                android.util.Log.i("CrossgramE2E", "reaction_panel_progress holders=" + holders
                        + " loaded=" + loadedHolders + " expected=" + expectedHolders
                        + " files=" + loadedFiles + " resources=" + documents.size()
                        + " missing_documents=" + missingDocuments);
            }
            if (++attempts[0] >= 240) {
                android.util.Log.e("CrossgramE2E", "reaction_panel_failed reason=timeout holders=" + holders
                        + " loaded=" + loadedHolders + " expected=" + expectedHolders
                        + " files=" + loadedFiles + " resources=" + documents.size()
                        + " missing_documents=" + missingDocuments);
                return;
            }
            AndroidUtilities.runOnUIThread(inspect[0], 250);
        };
        AndroidUtilities.runOnUIThread(inspect[0], clearCache ? 750 : 250);
    }

    private void inspectCrossgramE2eExpandedReactionPanel(
            org.telegram.ui.Components.ReactionsContainerLayout panel,
            int compactHolders, int compactLoaded, int compactFiles, int compactResources) {
        try {
            java.lang.reflect.Method open = org.telegram.ui.Components.ReactionsContainerLayout.class
                    .getDeclaredMethod("showCustomEmojiReactionDialog");
            open.setAccessible(true);
            open.invoke(panel);
        } catch (Throwable error) {
            android.util.Log.e("CrossgramE2E", "reaction_panel_failed reason=expand_exception error="
                    + error.getClass().getSimpleName() + " message=" + error.getMessage(), error);
            return;
        }

        final int[] attempts = { 0 };
        final int[] lastProgress = { -1 };
        final java.util.HashSet<Integer> loadedPositions = new java.util.HashSet<>();
        final java.util.HashSet<String> loadedExpandedFiles = new java.util.HashSet<>();
        final Runnable[] inspect = new Runnable[1];
        inspect[0] = () -> {
            org.telegram.ui.Components.Reactions.CustomEmojiReactionsWindow window = panel.getReactionsWindow();
            org.telegram.ui.SelectAnimatedEmojiDialog dialog = window == null
                    ? null : window.getSelectAnimatedEmojiDialog();
            if (dialog == null || dialog.emojiGridView == null || dialog.emojiGridView.getAdapter() == null) {
                if (++attempts[0] >= 360) {
                    android.util.Log.e("CrossgramE2E", "reaction_panel_failed reason=expanded_missing");
                    return;
                }
                AndroidUtilities.runOnUIThread(inspect[0], 250);
                return;
            }

            androidx.recyclerview.widget.RecyclerView grid = dialog.emojiGridView;
            int itemCount = grid.getAdapter().getItemCount();
            int visibleCells = 0;
            int loadedCells = 0;
            boolean pageReady = true;
            for (int i = 0; i < grid.getChildCount(); i++) {
                android.view.View child = grid.getChildAt(i);
                if (!(child instanceof org.telegram.ui.SelectAnimatedEmojiDialog.ImageViewEmoji)) {
                    continue;
                }
                org.telegram.ui.SelectAnimatedEmojiDialog.ImageViewEmoji cell =
                        (org.telegram.ui.SelectAnimatedEmojiDialog.ImageViewEmoji) child;
                if (cell.empty) {
                    continue;
                }
                visibleCells++;
                int position = grid.getChildAdapterPosition(cell);
                boolean ready;
                boolean expectsNetworkDocument = false;
                TLRPC.Document networkDocument = null;
                if (cell.isDefaultReaction) {
                    expectsNetworkDocument = true;
                    TLRPC.TL_availableReaction reaction = cell.reaction == null
                            ? null : MediaDataController.getInstance(currentAccount)
                                    .getReactionsMap().get(cell.reaction.emojicon);
                    networkDocument = reaction == null ? null : reaction.select_animation;
                    ready = cell.imageReceiver != null && cell.imageReceiver.hasImageLoaded();
                } else if (cell.drawable instanceof org.telegram.ui.Components.AnimatedEmojiDrawable) {
                    expectsNetworkDocument = true;
                    long documentId = cell.reaction != null && cell.reaction.documentId != 0
                            ? cell.reaction.documentId
                            : cell.span == null ? 0 : cell.span.getDocumentId();
                    networkDocument = documentId == 0 ? null
                            : org.telegram.ui.Components.AnimatedEmojiDrawable.findDocument(
                                    currentAccount, documentId);
                    org.telegram.messenger.ImageReceiver receiver =
                            ((org.telegram.ui.Components.AnimatedEmojiDrawable) cell.drawable).getImageReceiver();
                    ready = receiver != null && receiver.hasImageLoaded();
                } else if (cell.imageReceiverToDraw != null) {
                    expectsNetworkDocument = cell.document != null;
                    networkDocument = cell.document;
                    ready = cell.imageReceiverToDraw.hasImageLoaded();
                } else {
                    ready = cell.drawable != null;
                }
                if (expectsNetworkDocument) {
                    String fileKey = networkDocument == null
                            ? null : FileLoader.getAttachFileName(networkDocument);
                    boolean fileReady = networkDocument != null
                            && FileLoader.getInstance(currentAccount)
                                    .getPathToAttach(networkDocument, true).exists();
                    ready = ready && fileReady;
                    if (ready && fileKey != null) {
                        loadedExpandedFiles.add(fileKey);
                    }
                }
                if (ready) {
                    loadedCells++;
                    if (position >= 0) loadedPositions.add(position);
                } else {
                    pageReady = false;
                }
            }

            androidx.recyclerview.widget.RecyclerView.LayoutManager manager = grid.getLayoutManager();
            int lastVisible = manager instanceof androidx.recyclerview.widget.LinearLayoutManager
                    ? ((androidx.recyclerview.widget.LinearLayoutManager) manager).findLastVisibleItemPosition()
                    : -1;
            if (attempts[0] % 20 == 0 || lastVisible != lastProgress[0]) {
                lastProgress[0] = lastVisible;
                android.util.Log.i("CrossgramE2E", "reaction_panel_expanded_progress cells="
                        + loadedCells + "/" + visibleCells + " positions=" + loadedPositions.size()
                        + " files=" + loadedExpandedFiles.size()
                        + " last=" + lastVisible + " items=" + itemCount);
            }
            if (pageReady && lastVisible >= itemCount - 1 && itemCount > 0
                    && loadedPositions.size() == itemCount && !loadedExpandedFiles.isEmpty()) {
                android.util.Log.i("CrossgramE2E", "reaction_panel_loaded holders=" + compactHolders
                        + " loaded=" + compactLoaded + " files=" + compactFiles
                        + " resources=" + compactResources + " expanded_cells="
                        + loadedPositions.size() + " expanded_items=" + itemCount
                        + " expanded_files=" + loadedExpandedFiles.size());
                return;
            }
            if (pageReady && lastVisible >= 0 && lastVisible < itemCount - 1) {
                grid.scrollToPosition(Math.min(itemCount - 1, lastVisible + 1));
            }
            if (++attempts[0] >= 360) {
                android.util.Log.e("CrossgramE2E", "reaction_panel_failed reason=expanded_timeout cells="
                        + loadedCells + "/" + visibleCells + " positions=" + loadedPositions.size()
                        + " files=" + loadedExpandedFiles.size()
                        + " last=" + lastVisible + " items=" + itemCount);
                return;
            }
            AndroidUtilities.runOnUIThread(inspect[0], pageReady ? 350 : 250);
        };
        AndroidUtilities.runOnUIThread(inspect[0], 750);
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

    private static long crossgramE2eBitmapChecksum(android.graphics.Bitmap bitmap) {
        if (bitmap == null) {
            return Long.MIN_VALUE;
        }
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int[] pixels = new int[width * height];
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        long checksum = 0xcbf29ce484222325L;
        for (int pixel : pixels) {
            checksum ^= pixel;
            checksum *= 0x100000001b3L;
        }
        return checksum;
    }

    private boolean runCrossgramE2eWithMessage(
            Intent intent,
            String operation,
            java.util.function.Consumer<MessageObject> action) {
            return runCrossgramE2eWithMessageAttempt(intent, operation, action, 0);
    }

    private boolean runCrossgramE2eWithMessageAttempt(
            Intent intent,
            String operation,
            java.util.function.Consumer<MessageObject> action,
            int attempt) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            int targetId = intent.getIntExtra("crossgram_e2e_target_message_id", 0);
            MessagesController messagesController = MessagesController.getInstance(currentAccount);
            if ("chat".equals(peerType) && messagesController.getChat(peerId) == null) {
                if (attempt >= 6) {
                    android.util.Log.e("CrossgramE2E", operation
                            + "_failed reason=peer_metadata_missing target_id=" + targetId);
                    return true;
                }
                TLRPC.TL_messages_getPeerDialogs request = new TLRPC.TL_messages_getPeerDialogs();
                TLRPC.TL_inputDialogPeer dialogPeer = new TLRPC.TL_inputDialogPeer();
                TLRPC.TL_inputPeerChannel inputPeer = new TLRPC.TL_inputPeerChannel();
                inputPeer.channel_id = peerId;
                inputPeer.access_hash = 1;
                dialogPeer.peer = inputPeer;
                request.peers.add(dialogPeer);
                ConnectionsManager.getInstance(currentAccount).sendRequest(request, (response, error) ->
                        AndroidUtilities.runOnUIThread(() -> {
                            if (error == null && response instanceof TLRPC.TL_messages_peerDialogs) {
                                TLRPC.TL_messages_peerDialogs result = (TLRPC.TL_messages_peerDialogs) response;
                                messagesController.putUsers(result.users, false);
                                messagesController.putChats(result.chats, false);
                            }
                            android.util.Log.i("CrossgramE2E", operation + "_peer_retry target_id=" + targetId
                                    + " attempt=" + (attempt + 1));
                            AndroidUtilities.runOnUIThread(() -> runCrossgramE2eWithMessageAttempt(
                                    new Intent(intent), operation, action, attempt + 1), 500);
                        }));
                android.util.Log.i("CrossgramE2E", operation + "_peer_hydration_started target_id=" + targetId
                        + " attempt=" + attempt);
                return true;
            }
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
                            android.util.Log.e("CrossgramE2E",
                                    operation + "_failed reason=action_exception target_id=" + targetId
                                            + " error=" + error.getClass().getSimpleName()
                                            + " message=" + error.getMessage(),
                                    error);
                        }
                    } else if (id == NotificationCenter.loadingMessagesFailed && (Integer) args[0] == classGuid) {
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.messagesDidLoad);
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.loadingMessagesFailed);
                        if (attempt < 6) {
                            android.util.Log.i("CrossgramE2E", operation + "_load_retry target_id=" + targetId
                                    + " attempt=" + (attempt + 1));
                            AndroidUtilities.runOnUIThread(() -> runCrossgramE2eWithMessageAttempt(
                                    new Intent(intent), operation, action, attempt + 1), 500);
                        } else {
                            android.util.Log.e("CrossgramE2E", operation
                                    + "_failed reason=load_failed target_id=" + targetId);
                        }
                    }
                }
            };
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.messagesDidLoad);
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.loadingMessagesFailed);
            messagesController.loadMessages(
                    dialogId, 0, false, 30, targetId, 0, false, 0, classGuid,
                    MessagesController.LOAD_AROUND_MESSAGE, 0, ChatActivity.MODE_DEFAULT, 0, 0, 0, false);
            android.util.Log.i("CrossgramE2E", "function_called:loadMessageTarget operation=" + operation
                    + " target_id=" + targetId);
            return true;
    }

    private boolean runCrossgramE2eWithMessages(
            Intent intent,
            String operation,
            java.util.function.Consumer<java.util.ArrayList<MessageObject>> action) {
            long peerId = intent.getLongExtra("crossgram_e2e_peer_id", 0);
            String peerType = intent.getStringExtra("crossgram_e2e_peer_type");
            long dialogId = "user".equals(peerType) ? peerId : -peerId;
            String encodedIds = intent.getStringExtra("crossgram_e2e_target_message_ids");
            java.util.ArrayList<Integer> targetIds = new java.util.ArrayList<>();
            if (encodedIds != null) {
                for (String value : encodedIds.split(",")) {
                    try {
                        targetIds.add(Integer.parseInt(value.trim()));
                    } catch (NumberFormatException ignored) {}
                }
            }
            if (targetIds.size() < 2) {
                android.util.Log.e("CrossgramE2E", operation + "_failed reason=target_ids");
                return true;
            }
            int classGuid = ConnectionsManager.generateClassGuid();
            NotificationCenter.NotificationCenterDelegate observer = new NotificationCenter.NotificationCenterDelegate() {
                @Override
                public void didReceivedNotification(int id, int account, Object... args) {
                    if (id == NotificationCenter.messagesDidLoad && (Integer) args[10] == classGuid) {
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.messagesDidLoad);
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.loadingMessagesFailed);
                        java.util.ArrayList<MessageObject> loaded = (java.util.ArrayList<MessageObject>) args[2];
                        java.util.ArrayList<MessageObject> targets = new java.util.ArrayList<>();
                        for (Integer targetId : targetIds) {
                            for (MessageObject object : loaded) {
                                if (object.getId() == targetId) {
                                    targets.add(object);
                                    break;
                                }
                            }
                        }
                        if (targets.size() != targetIds.size()) {
                            android.util.Log.e("CrossgramE2E", operation + "_failed reason=targets_missing"
                                    + " expected=" + targetIds.size() + " found=" + targets.size());
                            return;
                        }
                        android.util.Log.i("CrossgramE2E", "message_targets_loaded operation=" + operation
                                + " count=" + targets.size());
                        try {
                            action.accept(targets);
                        } catch (Throwable error) {
                            android.util.Log.e("CrossgramE2E", operation + "_failed reason=action_exception");
                        }
                    } else if (id == NotificationCenter.loadingMessagesFailed && (Integer) args[0] == classGuid) {
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.messagesDidLoad);
                        NotificationCenter.getInstance(currentAccount).removeObserver(this, NotificationCenter.loadingMessagesFailed);
                        android.util.Log.e("CrossgramE2E", operation + "_failed reason=load_failed");
                    }
                }
            };
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.messagesDidLoad);
            NotificationCenter.getInstance(currentAccount).addObserver(observer, NotificationCenter.loadingMessagesFailed);
            MessagesController.getInstance(currentAccount).loadMessages(
                    dialogId, 0, false, 100, targetIds.get(0), 0, false, 0, classGuid,
                    MessagesController.LOAD_AROUND_MESSAGE, 0, ChatActivity.MODE_DEFAULT, 0, 0, 0, false);
            android.util.Log.i("CrossgramE2E", "function_called:loadMessageTargets operation=" + operation
                    + " count=" + targetIds.size());
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
                getActionBarLayout().presentFragment(
                        new ChatActivity(chatArgs), true, false, true, false);
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
