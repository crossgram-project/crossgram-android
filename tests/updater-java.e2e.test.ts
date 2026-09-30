import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyUpdater } from "../features/updater/patch.js";
import { upstreams } from "../src/upstreams.js";

const exec = promisify(execFile);
const helperDir = "features/updater/files/java/org/telegram/messenger/crossgram_update";

let directory = "";

/**
 * Minimal Android/Telegram stubs: enough for javac to type-check the injected
 * runtime the way the forks compile it, so a wrong signature (the Builder
 * listener shape, the dialog style constructor, ...) fails here and not an
 * hour into the native build.
 */
const stubs: Record<string, string> = {
  "android/app/Activity.java": `package android.app;
public class Activity extends android.content.Context { public boolean isFinishing() { return false; } }`,
  "android/app/PendingIntent.java": `package android.app;
public class PendingIntent {
  public static final int FLAG_UPDATE_CURRENT = 1 << 27;
  public static PendingIntent getBroadcast(android.content.Context c, int r, android.content.Intent i, int f) { return new PendingIntent(); }
  public android.content.IntentSender getIntentSender() { return null; }
}`,
  "android/content/Context.java": `package android.content;
public class Context {
  public static final int MODE_PRIVATE = 0;
  public SharedPreferences getSharedPreferences(String n, int m) { return null; }
  public String getPackageName() { return ""; }
  public android.content.pm.ApplicationInfo getApplicationInfo() { return null; }
  public java.io.File getFilesDir() { return null; }
  public android.content.pm.PackageManager getPackageManager() { return null; }
  public Intent registerReceiver(BroadcastReceiver r, IntentFilter f) { return null; }
  public Intent registerReceiver(BroadcastReceiver r, IntentFilter f, int flags) { return null; }
  public void unregisterReceiver(BroadcastReceiver r) {}
  public void startActivity(Intent i) {}
}`,
  "android/content/BroadcastReceiver.java": `package android.content;
public abstract class BroadcastReceiver { public abstract void onReceive(Context c, Intent i); }`,
  "android/content/Intent.java": `package android.content;
public class Intent {
  public static final String EXTRA_INTENT = "android.intent.extra.INTENT";
  public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000;
  public Intent(String action) {}
  public Intent setPackage(String p) { return this; }
  public Intent addFlags(int f) { return this; }
  public int getIntExtra(String n, int d) { return d; }
  public String getStringExtra(String n) { return null; }
  public <T> T getParcelableExtra(String n) { return null; }
}`,
  "android/content/IntentFilter.java": `package android.content;
public class IntentFilter { public IntentFilter(String action) {} }`,
  "android/content/IntentSender.java": `package android.content;
public class IntentSender {}`,
  "android/content/SharedPreferences.java": `package android.content;
public interface SharedPreferences {
  long getLong(String k, long d); int getInt(String k, int d); String getString(String k, String d);
  Editor edit();
  interface Editor { Editor putLong(String k, long v); Editor putInt(String k, int v); Editor putString(String k, String v); void apply(); }
}`,
  "android/content/pm/ApplicationInfo.java": `package android.content.pm;
public class ApplicationInfo { public String sourceDir; }`,
  "android/content/pm/PackageManager.java": `package android.content.pm;
public class PackageManager { public PackageInstaller getPackageInstaller() { return null; } }`,
  "android/content/pm/PackageInstaller.java": `package android.content.pm;
public class PackageInstaller {
  public static final String EXTRA_STATUS = "s", EXTRA_STATUS_MESSAGE = "m";
  public static final int STATUS_PENDING_USER_ACTION = -1, STATUS_SUCCESS = 0, STATUS_FAILURE_ABORTED = 3, STATUS_FAILURE_INVALID = 4;
  public int createSession(SessionParams p) throws java.io.IOException { return 1; }
  public Session openSession(int id) throws java.io.IOException { return null; }
  public static class SessionParams {
    public static final int MODE_FULL_INSTALL = 1, USER_ACTION_NOT_REQUIRED = 2;
    public SessionParams(int mode) {}
    public void setRequireUserAction(int v) {}
  }
  public static class Session implements java.io.Closeable {
    public java.io.OutputStream openWrite(String n, long o, long l) throws java.io.IOException { return null; }
    public void fsync(java.io.OutputStream o) throws java.io.IOException {}
    public void commit(android.content.IntentSender s) {}
    public void close() {}
  }
}`,
  "android/os/Build.java": `package android.os;
public class Build {
  public static final String[] SUPPORTED_ABIS = {};
  public static class VERSION { public static final int SDK_INT = 35; }
  public static class VERSION_CODES { public static final int S = 31; }
}`,
  "org/json/JSONObject.java": `package org.json;
public class JSONObject {
  public JSONObject() {}
  public JSONObject(String s) throws JSONException {}
  public int optInt(String k) { return 0; }
  public long optLong(String k) { return 0; }
  public String optString(String k) { return ""; }
  public JSONArray optJSONArray(String k) { return null; }
}`,
  "org/json/JSONArray.java": `package org.json;
public class JSONArray { public int length() { return 0; } public JSONObject optJSONObject(int i) { return null; } }`,
  "org/json/JSONException.java": `package org.json;
public class JSONException extends Exception {}`,
  "org/telegram/messenger/AndroidUtilities.java": `package org.telegram.messenger;
public class AndroidUtilities { public static void runOnUIThread(Runnable r) { r.run(); } }`,
  "org/telegram/messenger/ApplicationLoader.java": `package org.telegram.messenger;
public class ApplicationLoader { public static volatile android.content.Context applicationContext; }`,
  "org/telegram/messenger/FileLog.java": `package org.telegram.messenger;
public class FileLog { public static void d(String m) {} public static void e(Throwable t) {} }`,
  "org/telegram/messenger/browser/Browser.java": `package org.telegram.messenger.browser;
public class Browser { public static void openUrl(android.content.Context c, String u) {} }`,
  "org/telegram/ui/ActionBar/AlertDialog.java": `package org.telegram.ui.ActionBar;
public class AlertDialog {
  public interface OnButtonClickListener { void onClick(AlertDialog dialog, int which); }
  public boolean isShowing() { return true; }
  public void show() {}
  public void dismiss() {}
  public void setProgress(int p) {}
  public static class Builder {
    public Builder(android.content.Context c) {}
    public Builder(android.content.Context c, int progressViewStyle) {}
    public Builder setTitle(CharSequence t) { return this; }
    public Builder setMessage(CharSequence m) { return this; }
    public Builder setPositiveButton(CharSequence t, OnButtonClickListener l) { return this; }
    public Builder setNegativeButton(CharSequence t, OnButtonClickListener l) { return this; }
    public Builder setNeutralButton(CharSequence t, OnButtonClickListener l) { return this; }
    public AlertDialog create() { return new AlertDialog(); }
    public AlertDialog show() { return new AlertDialog(); }
  }
}`,
};

const harness = `import org.telegram.messenger.crossgram_update.CrossgramUpdatePolicy;
import org.telegram.messenger.crossgram_update.CrossgramUpdatePolicy.Asset;
import java.util.Arrays;
import java.util.List;

public class Harness {
  public static void main(String[] args) {
    List<Asset> assets = Arrays.asList(
        new Asset("nagram", "arm64", "wechat", "u-wechat", "aa"),
        new Asset("nagram", "arm64", "qq", "", "bb"),
        new Asset("nagram", "arm64", "qq", "u-qq", "CC"),
        new Asset("telegram", "arm64", "qq", "u-tg", "dd"));
    Asset entry = CrossgramUpdatePolicy.select(assets, "nagram", "arm64", "qq");
    StringBuilder out = new StringBuilder();
    out.append("select=").append(entry == null ? "null" : entry.url).append(';');
    out.append("select-missing=").append(CrossgramUpdatePolicy.select(assets, "nagram", "x86_64", "qq")).append(';');
    out.append("new=").append(CrossgramUpdatePolicy.decide(entry, 106, "ee", false, 0, 0)).append(';');
    out.append("same-hash=").append(CrossgramUpdatePolicy.decide(entry, 106, "cc", false, 0, 0)).append(';');
    out.append("prompted=").append(CrossgramUpdatePolicy.decide(entry, 106, "ee", false, 106, 0)).append(';');
    out.append("skipped=").append(CrossgramUpdatePolicy.decide(entry, 106, "ee", false, 0, 106)).append(';');
    out.append("older-prompt=").append(CrossgramUpdatePolicy.decide(entry, 106, "ee", false, 105, 104)).append(';');
    out.append("forced=").append(CrossgramUpdatePolicy.decide(entry, 106, "ee", true, 106, 106)).append(';');
    out.append("no-build=").append(CrossgramUpdatePolicy.decide(entry, 0, "ee", false, 0, 0)).append(';');
    out.append("unknown-hash=").append(CrossgramUpdatePolicy.decide(entry, 106, null, false, 0, 0)).append(';');
    out.append("variant=").append(CrossgramUpdatePolicy.variant(new String[] {"arm64-v8a", "armeabi-v7a"}))
        .append(',').append(CrossgramUpdatePolicy.variant(new String[] {"x86_64", "arm64-v8a"}))
        .append(',').append(CrossgramUpdatePolicy.variant(new String[] {})).append(';');
    out.append("brand=").append(CrossgramUpdatePolicy.brand("xyz.nextalone.nagram.crossgram.qq", ".crossgram."))
        .append(',').append(CrossgramUpdatePolicy.brand("org.telegram.messenger", ".crossgram.")).append(';');
    System.out.println(out);
  }
}
`;

async function collectSources(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectSources(full));
    else if (entry.name.endsWith(".java")) files.push(full);
  }
  return files;
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "crossgram-updater-java-"));
  const src = path.join(directory, "src");
  for (const [relative, source] of Object.entries(stubs)) {
    await mkdir(path.dirname(path.join(src, relative)), { recursive: true });
    await writeFile(path.join(src, relative), source);
  }
  await cp(helperDir, path.join(src, "org/telegram/messenger/crossgram_update"), { recursive: true });
  await writeFile(path.join(src, "Harness.java"), harness);
  await exec("javac", ["-encoding", "UTF-8", "-Xlint:none", "-d", path.join(directory, "out"), ...await collectSources(src)]);
}, 180_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("Android updater runtime", () => {
  it("compiles against the Android and Telegram APIs it calls", async () => {
    // beforeAll already compiled the runtime; the class files prove it.
    const { stdout } = await exec("javap", ["-p", "-cp", path.join(directory, "out"),
      "org.telegram.messenger.crossgram_update.CrossgramUpdate"]);
    expect(stdout).toContain("public static void check(android.app.Activity, boolean, java.lang.Runnable)");
  }, 60_000);

  it("offers the build of the manifest to the matching installation only", async () => {
    const { stdout } = await exec("java", ["-cp", path.join(directory, "out"), "Harness"]);
    const report = stdout.trim();
    expect(report).toContain("select=u-qq;");
    expect(report).toContain("select-missing=null;");
    // The manifest records the build once; before the fix it was read from the
    // asset, came back as 0, and every automatic check was swallowed.
    expect(report).toContain("new=OFFER;");
    expect(report).toContain("same-hash=UP_TO_DATE;");
    expect(report).toContain("prompted=ALREADY_OFFERED;");
    expect(report).toContain("skipped=ALREADY_OFFERED;");
    expect(report).toContain("older-prompt=OFFER;");
    expect(report).toContain("forced=OFFER;");
    expect(report).toContain("no-build=UP_TO_DATE;");
    expect(report).toContain("unknown-hash=OFFER;");
    expect(report).toContain("variant=arm64,x86_64,arm64;");
    expect(report).toContain("brand=qq,;");
  }, 60_000);

  it("reads the build number from the manifest and wires the installer status", async () => {
    const runtime = await readFile(path.join(helperDir, "CrossgramUpdate.java"), "utf8");
    expect(runtime).toContain('manifest.optInt("build")');
    expect(runtime).not.toContain('entry.optInt("build")');
    // Without a status receiver the session parks in PENDING_USER_ACTION and
    // the system confirmation screen never appears.
    expect(runtime).toContain("STATUS_PENDING_USER_ACTION");
    expect(runtime).toContain("PendingIntent.getBroadcast");
    expect(runtime).toContain("startActivity(confirm)");
    // The download dialog needs the loading style for setProgress() to draw.
    expect(runtime).toContain("new AlertDialog.Builder(activity, ALERT_TYPE_LOADING)");
  });

  it("installs both runtime classes with the upstream identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "crossgram-updater-apply-"));
    try {
      const upstream = upstreams.find((candidate) => candidate.id === "forkgram")!;
      const changed = await applyUpdater(root, upstream);
      expect(changed).toEqual([
        "TMessagesProj/src/main/java/org/telegram/messenger/crossgram_update/CrossgramUpdate.java",
        "TMessagesProj/src/main/java/org/telegram/messenger/crossgram_update/CrossgramUpdatePolicy.java",
      ]);
      const helper = await readFile(path.join(root, changed[0]!), "utf8");
      expect(helper).toContain('private static final String CLIENT = "forkgram";');
      expect(await applyUpdater(root, upstream)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
