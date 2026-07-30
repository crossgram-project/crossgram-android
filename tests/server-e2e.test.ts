import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  patchLaunchE2eSource,
  patchDirectDownloadE2eSource,
  patchLoginE2eSource,
  patchNativeE2eSource,
} from "../features/server-e2e/patch.js";

const featureRoot = path.resolve("features/server-e2e/files");

describe("Android server E2E source driver", () => {
  it("drives the phone and code pages directly and remains idempotent", async () => {
    const methods = await readFile(path.join(featureRoot, "java-snippets/login-methods.java"), "utf8");
    const source = `public class LoginActivity {
    public void setPage(int page, boolean animated, Bundle params, boolean back) {
        currentViewNum = page;
    }

    @Override
    public void saveSelfArgs(Bundle outState) {}
}`;
    const patched = patchLoginE2eSource(source, "LoginActivity.java", methods);

    expect(patched).toContain("phoneView.onNextPressed(null)");
    expect(patched).toContain("views[page].onNextPressed(code)");
    expect(patched).toContain("public void runCrossgramE2eCode(String code)");
    expect(patched).toContain("maybeRunCrossgramE2eCode(page);");
    expect(patchLoginE2eSource(patched, "LoginActivity.java", methods)).toBe(patched);
  });

  it("dispatches real page, history, search, read and message lifecycle calls from LaunchActivity", async () => {
    const method = await readFile(path.join(featureRoot, "java-snippets/launch-method.java"), "utf8");
    const source = `public class LaunchActivity {
    private boolean handleIntent(Intent intent, boolean isNew, boolean restore, boolean fromPassword) {
        return false;
    }

    private boolean handleIntent(Intent intent, boolean isNew, boolean restore, boolean fromPassword, Browser.Progress progress, boolean rebuildFragments, boolean openedTelegram) {
        return false;
    }
}`;
    const patched = patchLaunchE2eSource(source, "LaunchActivity.java", method);

    expect(patched).toContain("new DialogsActivity(new Bundle())");
    expect(patched).toContain('"login-phone".equals(command)');
    expect(patched).toContain('"login-code".equals(command)');
    expect(patched).toContain("((LoginActivity) last).runCrossgramE2eCode(code)");
    expect(patched).toContain("new ChatActivity(args)");
    expect(patched).toContain('"stickers".equals(command)');
    expect(patched).toContain("loadStickers(MediaDataController.TYPE_IMAGE, false, true, true);");
    expect(patched).toContain("mediaDataController.getStickerSets(MediaDataController.TYPE_IMAGE)");
    expect(patched).toContain("++attempts[0] >= 60");
    expect(patched).toContain('"sticker-install".equals(command)');
    expect(patched).toContain("new TLRPC.TL_messages_getStickerSet()");
    expect(patched).toContain("toggleStickerSet(");
    expect(patched).toContain("function_called:toggleStickerSet set_id=");
    expect(patched).toContain("SendMessagesHelper.getInstance(currentAccount).sendMessage");
    expect(patched).toContain("searchMessagesInChat");
    expect(patched).toContain("markDialogAsRead");
    expect(patched).toContain("saveDraft");
    expect(patched).toContain("editMessage(target, message");
    expect(patched).toContain("deleteMessages(");
    expect(patched).toContain("sendMessage(messages, destinationDialogId");
    expect(patched).toContain("runCrossgramE2eWithMessages");
    expect(patched).toContain('"merged-forward".equals(command)');
    expect(patched).toContain('"open-merged-forward".equals(command)');
    expect(patched).toContain("NotificationCenter.messageSendError");
    expect(patched).toContain("merged_forward_preview_ready preview_base64=");
    expect(patched).toContain("merged_forward_opened dialog_id=");
    expect(patched).toContain('" request_id=" + requestId');
    expect(patched).not.toContain("forward_failed reason=request_not_started");
    expect(patched).toContain("sendReaction(");
    expect(patched).toContain("target.selectReaction(visible, false, false)");
    expect(patched).toContain("target.getChoosenReactions()");
    expect(patched).toContain("visible, false, true");
    expect(patched).toContain("sendCrossgramE2eSelectedReaction(target, reaction)");
    expect(patched).toContain("reaction_reset target_id=");
    expect(patched).toContain('"reaction-inspect".equals(command)');
    expect(patched).toContain("new org.telegram.ui.Components.Reactions.ReactionsLayoutInBubble(");
    expect(patched).toContain("reaction_layout_ready first=");
    expect(patched).toContain("TL_messages_getCustomEmojiDocuments");
    expect(patched).toContain("reaction_documents_loaded requested=");
    expect(patched).toContain("loadRecentAndTopReactions(true)");
    expect(patched).toContain("reaction_recent_ready first=");
    expect(patched).toContain('"dialog-watch".equals(command)');
    expect(patched).toContain("messagesController.dialogMessage.get(dialogId)");
    expect(patched).toContain("dialog_updated_without_chat message_id=");
    expect(patched).toContain("runCrossgramE2eWithMessage");
    expect(patched).toContain("runCrossgramE2eSearch");
    expect(patched).toContain("runCrossgramE2eDownload");
    expect(patched).toContain("loader.loadFile(document, target");
    expect(patched).toContain("download_loaded");
    expect(patched).toContain('chatArgs.putInt("message_id", target.getId())');
    expect(patched).toContain("new ChatActivity(chatArgs), true, false, true, false");
    expect(patched).toContain("download_ui_opened");
    expect(patched).toContain("crossgram_e2e_message_base64");
    expect(patched).toContain("messagesController.loadMessages");
    expect(patched).toContain("MessagesController.LOAD_FROM_UNREAD");
    expect(patched).toContain("TLRPC.TL_messages_getPeerDialogs");
    expect(patched).toContain("TLRPC.TL_inputPeerChannel");
    expect(patched).toContain("messagesController.putUsers(result.users, false)");
    expect(patched).toContain("messagesController.putChats(result.chats, false)");
    expect(patched).toContain("history_peer_hydration_started");
    expect(patched).toContain("history_peer_hydrated");
    expect(patched).toContain('operation + "_peer_hydration_started target_id="');
    expect(patched).toContain('operation + "_load_retry target_id="');
    expect(patched).toContain("runCrossgramE2eWithMessageAttempt(\n                                    new Intent(intent), operation, action, attempt + 1)");
    expect(patched).toContain("reason=peer_metadata_rpc");
    expect(patched).toContain("reason=peer_metadata_missing");
    expect(patched).toContain("ordered_desc=");
    expect(patched).toContain("NotificationCenter.messagesDidLoad");
    expect(patched).toContain('"history_loaded source="');
    expect(patched).toContain('android.util.Log.i("CrossgramE2E", "state activated="');
    expect(patched).toContain("if (handleCrossgramE2eIntent(intent))");
    expect(patchLaunchE2eSource(patched, "LaunchActivity.java", method)).toBe(patched);
  });

  it("upgrades an already-installed driver to Base64-safe text extras", async () => {
    const method = await readFile(path.join(featureRoot, "java-snippets/launch-method.java"), "utf8");
    const legacyMethod = method
      .replace(
        /            String encodedMessage[\s\S]*?java\.nio\.charset\.StandardCharsets\.UTF_8\);/,
        '            String message = intent.getStringExtra("crossgram_e2e_message");',
      )
      .replace(
        /        if \("history"\.equals\(command\)\) \{[\s\S]*?(?=        if \("send"\.equals\(command\)\) \{)/,
        "",
      )
      .replace(/\n    private boolean runCrossgramE2eWithMessage[\s\S]*$/, "");
    const source = `public class LaunchActivity {\n${legacyMethod}\n\n    private boolean handleIntent(Intent intent, boolean isNew, boolean restore, boolean fromPassword) { return false; }\n    private boolean handleIntent(Intent intent, boolean isNew, boolean restore, boolean fromPassword, Browser.Progress progress, boolean rebuildFragments, boolean openedTelegram) { return false; }\n}`;

    const patched = patchLaunchE2eSource(source, "LaunchActivity.java", method);
    expect(patched).toContain("crossgram_e2e_message_base64");
    expect(patched).toContain("history_loaded source=");
    expect(patched).toContain("private boolean runCrossgramE2eHistory");
    expect(patched).toContain("private String crossgramE2eReactionKey");
    expect(patched).toContain("private void inspectCrossgramE2eReaction");
    expect(patched).toContain("private boolean runCrossgramE2eWithMessage");
    expect(patched).toContain("private boolean runCrossgramE2eSearch");
    expect(patched).not.toContain('String message = intent.getStringExtra("crossgram_e2e_message");');
    expect(patchLaunchE2eSource(patched, "LaunchActivity.java", method)).toBe(patched);
  });

  it("registers the exported dispatcher only in the debug manifest", async () => {
    const manifest = await readFile(path.join(featureRoot, "debug/AndroidManifest.xml"), "utf8");
    const activity = await readFile(
      path.join(featureRoot, "java/org/telegram/ui/CrossgramE2eActivity.java"),
      "utf8",
    );

    expect(manifest).toContain('android:name="org.telegram.ui.CrossgramE2eActivity"');
    expect(manifest).toContain('android:exported="true"');
    expect(activity).toContain("if (!BuildConfig.DEBUG)");
    expect(activity).not.toContain("crossgram_e2e_code\"");
  });

  it("keeps the server E2E feature out of the default production patch command", async () => {
    const cli = await readFile(path.resolve("src/cli.ts"), "utf8");
    const productionPatch = cli.slice(
      cli.indexOf('if (command === "patch")'),
      cli.indexOf('} else if (command === "e2e")'),
    );
    const e2ePatch = cli.slice(
      cli.indexOf('} else if (command === "e2e")'),
      cli.indexOf('} else if (command === "discover")'),
    );

    expect(productionPatch).toContain("applyServerSwitch(root, upstream)");
    expect(productionPatch).not.toContain("applyServerE2e");
    expect(e2ePatch).toContain("applyServerE2e(root)");
  });

  it("allows only the dedicated E2E patch to use an ephemeral debug signature", () => {
    const source = `jint JNI_OnLoad(JavaVM *vm, void *reserved) {
    if (verifySign(env) != JNI_OK) {
        return JNI_ERR;
    }
    return JNI_VERSION_1_6;
}`;
    const patched = patchNativeE2eSource(source, "jni.c");

    expect(patched).toContain("CROSSGRAM E2E: accept the ephemeral debug signing certificate");
    expect(patched).not.toContain("verifySign(env)");
    expect(patchNativeE2eSource(patched, "jni.c")).toBe(patched);
  });

  it("adds an idempotent debug-only direct HTTP failure hook", () => {
    const source = `public final class CrossgramDirectDownload {
    private static final ConcurrentHashMap<Integer, HttpURLConnection[]> HTTP_REQUESTS = new ConcurrentHashMap<>();
    private CrossgramDirectDownload() {}
    void resolved(String url, long expiresAt) {
        callback.onResult(new ResolvedUrl(url, expiresAt), null);
    }
    void range(String url, long offset, int limit, HttpURLConnection[] handle) throws Exception {
        result = CrossgramDirectHttp.loadRange(url, offset, limit, handle);
    }
}`;
    const patched = patchDirectDownloadE2eSource(source, "CrossgramDirectDownload.java");

    expect(patched).toContain("setCrossgramE2eForceHttpFailure(boolean value)");
    expect(patched).toContain("if (!org.telegram.messenger.BuildConfig.DEBUG)");
    expect(patched).toContain("http://127.0.0.1:1/crossgram-e2e-force-failure");
    expect(patched).toContain("Thread.sleep(8000);");
    expect(patchDirectDownloadE2eSource(patched, "CrossgramDirectDownload.java")).toBe(patched);
  });

  it("sends follow-up commands straight to the running LaunchActivity", async () => {
    const runner = await readFile(path.resolve("scripts/e2e/android-server.mjs"), "utf8");

    expect(runner).toContain('const launchComponent = `${packageName}/org.telegram.ui.LaunchActivity`;');
    expect(runner).toContain('"CrossgramDirectDownload:D"');
    expect(runner).toContain('const e2eAction = "org.telegram.messenger.CROSSGRAM_E2E";');
    expect(runner).toContain('if (action) args.push("-a", action);');
    expect(runner).toContain('dispatch(launchComponent, e2eAction, "state")');
    expect(runner).not.toContain('dispatch(component, "state")');
    expect(runner).toContain('if (command === "state")');
    expect(runner).toContain('crossgram_e2e_command", "login-phone"');
    expect(runner).toContain('dispatch(launchComponent, e2eAction, "login-code"');
    expect(runner).toContain('waitFor("login_phone_submitted", 90_000)');
    expect(runner).toContain('const platform = option("platform", "qqnt");');
    expect(runner).toContain('JOIN mtproto_platform_session p ON p.id=a.platformSessionId');
    expect(runner).toContain('WHERE a.platformId=${sqlString(platform)} AND p.active=1');
    expect(runner).not.toContain('FROM mtproto_auth_session ORDER BY id LIMIT 1');
    expect(runner).toContain('if (command === "stickers")');
    expect(runner).toContain('"messages.getAllStickers"');
    expect(runner).toContain('if (command === "sticker-install")');
    expect(runner).toContain('stableId(`sticker-set:v6:${providerId}:${packId}`)');
    expect(runner).toContain("tlLongNumber(value.stickerset.id) === setId");
    expect(runner).toContain('"messages.installStickerSet"');
    expect(runner).toContain("installed sticker pack");
    expect(runner).toContain('Buffer.from(message).toString("base64")');
    expect(runner).toContain("waitForRelayMessage(relayRoot, message)");
    expect(runner).toContain('["--no-warnings", inspector, "sql", sql]');
    expect(runner).toContain("/database is (locked|busy)/i");
    expect(runner).toContain('if (peerType !== "user") return stableId(`peer:${conversation}`)');
    expect(runner).toContain('throw new Error("--message is required for send")');
    expect(runner).toContain('if (command === "send-unblock")');
    expect(runner).toContain("p.nativeSequence");
    expect(runner).toContain("send-unblock requires a target with a stable native sequence");
    expect(runner).toContain("json_extract(metadata, '$.qqReplyToMsgSeq')");
    expect(runner).toContain("waitForPermanentSendRejection(relayRoot, baselineId, failureMessage)");
    expect(runner).toContain('"CHAT_WRITE_FORBIDDEN"');
    expect(runner).toContain('crossgram_e2e_expect_send_error", true');
    expect(runner).toContain('waitFor("send_error local_id=")');
    expect(runner).toContain("countSendRequests(afterRetryWindow, failureMessage)");
    expect(runner).toContain("reply sent after permanent rejection");
    expect(runner).toContain('"chat", "send", "search", "read", "draft", "reply", "edit", "delete", "forward", "reaction", "download"');
    expect(runner).toContain('waitForOutcome("download_loaded", "download_failed", 90_000)');
    expect(runner).toContain("waitForTransport(transport, fields.file)");
    expect(runner).toContain('crossgram_e2e_force_http_failure", transport === "relay"');
    expect(runner).toContain("resolveMessageTarget(");
    expect(runner).toContain("persisted reply relationship");
    expect(runner).toContain("selected message reaction");
    expect(runner).toContain('if (command === "dialog-update")');
    expect(runner).toContain('sendQqntMessage(option("qqnt-url"');
    expect(runner).toContain('waitForOutcome("dialog_updated_without_chat", "dialog_update_failed"');
    expect(runner).toContain('request.addToRecent === true');
    expect(runner).toContain('dispatch(launchComponent, e2eAction, "reaction-inspect"');
    expect(runner).toContain('waitForOutcome("reaction_layout_ready", "reaction_inspect_failed"');
    expect(runner).toContain('waitForOutcome("reaction_documents_loaded", "reaction_inspect_failed"');
    expect(runner).toContain('waitForOutcome("reaction_recent_ready", "reaction_inspect_failed"');
    expect(runner).toContain("delete-and-resend edit tombstone");
    expect(runner).toContain("deleted message tombstone");
    expect(runner).toContain("saved draft");
    expect(runner).toContain('if (command === "draft")');
    expect(runner).toContain('await dispatch(launchComponent, e2eAction, "dialogs");');
    expect(runner).toContain('await waitFor("page_opened:dialogs");');
    expect(runner).toContain("const messageExtras = message");
    expect(runner).toContain("...messageExtras");
    expect(runner).toContain('if (command === "history")');
    expect(runner).toContain('waitForOutcome(`function_called:loadMessages source=${source}`, "history_failed")');
    expect(runner).toContain('waitForOutcome(`history_loaded source=${source}`, "history_failed")');
    expect(runner).toContain('if (cold) adb(["shell", "am", "force-stop", packageName])');
    expect(runner).toContain("Android history IDs are not in descending Telegram order");
    expect(runner).toContain("Android backward pagination returned messages newer than its anchor");
    expect(runner).toContain("Android backward pagination did not advance past its anchor");
    expect(runner).toContain('const requireBothSides = booleanOption("require-both-sides")');
    expect(runner).toContain("Android around window did not span its anchor");
    expect(runner).toContain('if (command === "merged-forward")');
    expect(runner).toContain('"--target-ids must contain at least two distinct positive Telegram message IDs"');
    expect(runner).toContain('"messages.forwardMessages"');
    expect(runner).toContain("request.randomId?.length === targetIds.length");
    expect(runner).toContain("one persisted QQ merged-forward output");
    expect(runner).toContain("MAX(CAST(m.primaryPlatformMessageId AS INTEGER))");
    expect(runner).toContain("CAST(m.primaryPlatformMessageId AS INTEGER) > ${BigInt(baseline.platformId)}");
    expect(runner).toContain("collapsed removed=${targetIds.length - 1}");
    expect(runner).toContain("Android retained a failed merged-forward placeholder");
    expect(runner).toContain('dispatch(launchComponent, e2eAction, "open-merged-forward"');
    expect(runner).toContain("merged_forward_preview_ready");
    expect(runner).toContain("/([a-z0-9_]+)=([^ ]+)/g");
    expect(runner).toContain("Android preview does not contain source content");
    expect(runner).toContain('"messages.getHistory"');
    expect(runner).toContain('request.peer?._ === "inputPeerChat"');
    expect(runner).toContain('adb(["shell", "pm", "grant", packageName, permission])');
  });

  it("forces each download E2E through FileLoader instead of accepting a cached file", async () => {
    const source = await readFile(path.resolve(
      "features/server-e2e/files/java-snippets/launch-method.java",
    ), "utf8");

    expect(source).toContain("existingFile.exists() && !existingFile.delete()");
    expect(source).toContain('+ " file=" + fileName');
  });

  it("observes Android moving a permanently rejected message into send-error state", async () => {
    const source = await readFile(path.resolve(
      "features/server-e2e/files/java-snippets/launch-method.java",
    ), "utf8");

    expect(source).toContain('getBooleanExtra("crossgram_e2e_expect_send_error", false)');
    expect(source).toContain("NotificationCenter.messageSendError");
    expect(source).toContain('"send_error local_id=" + args[0]');
    expect(source).toContain("removeObserver(");
  });

  it("ships a read-only Android history cache inspector", async () => {
    const inspector = await readFile(path.resolve("scripts/e2e/inspect-android-cache.mjs"), "utf8");

    expect(inspector).toContain('new DatabaseSync(databasePath, { readOnly: true })');
    expect(inspector).toContain('db.exec("PRAGMA query_only = ON")');
    expect(inspector).toContain("length(data) AS dataBytes");
    expect(inspector).toContain("SELECT start, end FROM messages_holes");
    expect(inspector).not.toContain("SELECT data FROM messages_v2");
  });

  it("signs CI E2E builds with an ephemeral keystore", async () => {
    const script = await readFile(path.resolve("scripts/ci/build-e2e-nagram.sh"), "utf8");

    expect(script).toContain("SIGNING_ROOT=$(mktemp -d)");
    expect(script).toContain("trap cleanup EXIT");
    expect(script).toContain("keytool -genkeypair");
    expect(script).toContain('export KEYSTORE_PASS="$SIGNING_PASSWORD"');
    expect(script).toContain('export ALIAS_NAME="$SIGNING_ALIAS"');
    expect(script).toContain('export ALIAS_PASS="$SIGNING_PASSWORD"');
    expect(script).not.toContain("release.keystore.base64");
  });

});
