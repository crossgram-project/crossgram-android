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

  it("dispatches real dialogs, chat and send-message calls from LaunchActivity", async () => {
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
    expect(patched).toContain("crossgram_e2e_message_base64");
    expect(patched).toContain("MessagesController.getInstance(currentAccount).loadMessages");
    expect(patched).toContain("NotificationCenter.messagesDidLoad");
    expect(patched).toContain('"history_loaded source="');
    expect(patched).toContain('android.util.Log.i("CrossgramE2E", "state activated="');
    expect(patched).toContain("if (handleCrossgramE2eIntent(intent))");
    expect(patchLaunchE2eSource(patched, "LaunchActivity.java", method)).toBe(patched);
  });

  it("upgrades an already-installed driver to Base64-safe text extras", async () => {
    const method = await readFile(path.join(featureRoot, "java-snippets/launch-method.java"), "utf8");
    const legacyMethod = method.replace(
      /            String encodedMessage[\s\S]*?java\.nio\.charset\.StandardCharsets\.UTF_8\);/,
      '            String message = intent.getStringExtra("crossgram_e2e_message");',
    );
    const source = `public class LaunchActivity {\n${legacyMethod}\n\n    private boolean handleIntent(Intent intent, boolean isNew, boolean restore, boolean fromPassword) { return false; }\n    private boolean handleIntent(Intent intent, boolean isNew, boolean restore, boolean fromPassword, Browser.Progress progress, boolean rebuildFragments, boolean openedTelegram) { return false; }\n}`;

    const patched = patchLaunchE2eSource(source, "LaunchActivity.java", method);
    expect(patched).toContain("crossgram_e2e_message_base64");
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
    expect(runner).toContain('if (peerType !== "user") return stableId(`peer:${conversation}`)');
    expect(runner).toContain('throw new Error("--message is required for send")');
    expect(runner).toContain('if (command === "history")');
    expect(runner).toContain('await waitFor(`history_loaded source=${source}`)');
  });
});
