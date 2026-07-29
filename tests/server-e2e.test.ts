import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  patchLaunchE2eSource,
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
    expect(patched).toContain("new ChatActivity(args)");
    expect(patched).toContain("SendMessagesHelper.getInstance(currentAccount).sendMessage");
    expect(patched).toContain("searchMessagesInChat");
    expect(patched).toContain("markDialogAsRead");
    expect(patched).toContain("saveDraft");
    expect(patched).toContain("editMessage(target, message");
    expect(patched).toContain("deleteMessages(");
    expect(patched).toContain("sendMessage(messages, destinationDialogId");
    expect(patched).toContain("sendReaction(");
    expect(patched).toContain("runCrossgramE2eWithMessage");
    expect(patched).toContain("runCrossgramE2eSearch");
    expect(patched).toContain("crossgram_e2e_message_base64");
    expect(patched).toContain("messagesController.loadMessages");
    expect(patched).toContain("MessagesController.LOAD_FROM_UNREAD");
    expect(patched).toContain("TLRPC.TL_messages_getPeerDialogs");
    expect(patched).toContain("TLRPC.TL_inputPeerChannel");
    expect(patched).toContain("messagesController.putUsers(result.users, false)");
    expect(patched).toContain("messagesController.putChats(result.chats, false)");
    expect(patched).toContain("history_peer_hydration_started");
    expect(patched).toContain("history_peer_hydrated");
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

  it("sends follow-up commands straight to the running LaunchActivity", async () => {
    const runner = await readFile(path.resolve("scripts/e2e/android-server.mjs"), "utf8");

    expect(runner).toContain('const launchComponent = `${packageName}/org.telegram.ui.LaunchActivity`;');
    expect(runner).toContain('const e2eAction = "org.telegram.messenger.CROSSGRAM_E2E";');
    expect(runner).toContain('if (action) args.push("-a", action);');
    expect(runner).toContain('dispatch(launchComponent, e2eAction, "state")');
    expect(runner).not.toContain('dispatch(component, "state")');
    expect(runner).toContain('if (command === "state")');
    expect(runner).toContain('Buffer.from(message).toString("base64")');
    expect(runner).toContain("waitForRelayMessage(relayRoot, message)");
    expect(runner).toContain('["--no-warnings", inspector, "sql", sql]');
    expect(runner).toContain("/database is (locked|busy)/i");
    expect(runner).toContain('if (peerType !== "user") return stableId(`peer:${conversation}`)');
    expect(runner).toContain('throw new Error("--message is required for send")');
    expect(runner).toContain('"chat", "send", "search", "read", "draft", "reply", "edit", "delete", "forward", "reaction"');
    expect(runner).toContain("resolveMessageTarget(");
    expect(runner).toContain("persisted reply relationship");
    expect(runner).toContain("selected message reaction");
    expect(runner).toContain("delete-and-resend edit tombstone");
    expect(runner).toContain("deleted message tombstone");
    expect(runner).toContain("saved draft");
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
