package org.telegram.messenger.crossgram_update;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;
import org.telegram.messenger.AndroidUtilities;
import org.telegram.messenger.browser.Browser;
import org.telegram.messenger.ApplicationLoader;
import org.telegram.messenger.FileLog;
import org.telegram.ui.ActionBar.AlertDialog;
import org.telegram.ui.LaunchActivity;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Crossgram build updates for the patched Telegram Android forks.
 *
 * The upstream updaters of the supported forks point at their own release
 * feeds (their metadata channel, their own GitHub releases, ...), so an
 * installed Crossgram APK never learns about a newer nightly. This runtime
 * asks the Crossgram release manifest instead, matches the manifest entry
 * against the APK that is actually installed, and downloads and installs the
 * newer APK from the release asset.
 *
 * The identity of the running build comes from the package name (the branding
 * patch appends ".crossgram.<brand>") and from the device ABI, so one manifest
 * entry matches exactly one published asset.
 */
public final class CrossgramUpdate {
    /** The upstream fork this build was patched from; replaced by the patcher. */
    private static final String CLIENT = "nagram";

    /** Manifest published with every unified Android release. */
    private static final String MANIFEST_URL =
            "https://github.com/crossgram-project/crossgram-android/releases/latest/download/crossgram-update.json";

    /** The brand patch suffixes every branded application id with this marker. */
    private static final String BRAND_MARKER = ".crossgram.";

    private static final String PREFS_NAME = "crossgram_update";
    private static final String KEY_CHECKED_AT = "checked_at";
    private static final String KEY_APK_HASH = "apk_hash";
    private static final String KEY_PROMPTED_BUILD = "prompted_build";
    private static final String KEY_SKIPPED_BUILD = "skipped_build";

    /** Automatic checks are spaced out; the upstream entry point calls us on every resume. */
    private static final long AUTO_CHECK_INTERVAL_MS = 12L * 60 * 60 * 1000;
    private static final int CONNECT_TIMEOUT_MS = 20 * 1000;
    private static final int READ_TIMEOUT_MS = 30 * 1000;
    private static final int BUFFER_SIZE = 128 * 1024;

    private static final String TITLE = "\u53d1\u73b0\u65b0\u7248\u672c";
    private static final String TITLE_UP_TO_DATE = "\u68c0\u67e5\u66f4\u65b0";
    private static final String DOWNLOAD_AND_INSTALL = "\u4e0b\u8f7d\u5e76\u5b89\u88c5";
    private static final String LATER = "\u7a0d\u540e";
    private static final String SKIP_THIS_BUILD = "\u8df3\u8fc7\u6b64\u7248\u672c";
    private static final String UP_TO_DATE = "\u5df2\u662f\u6700\u65b0\u7248\u672c";
    private static final String CHECK_FAILED = "\u68c0\u67e5\u66f4\u65b0\u5931\u8d25";
    private static final String DOWNLOADING = "\u6b63\u5728\u4e0b\u8f7d";
    private static final String DOWNLOAD_FAILED = "\u4e0b\u8f7d\u5931\u8d25";
    private static final String INSTALL_FAILED = "\u5b89\u88c5\u5931\u8d25";
    private static final String CANCEL = "\u53d6\u6d88";
    private static final String OK = "OK";
    private static final String SEPARATOR = " \u00b7 ";

    private static final AtomicBoolean checking = new AtomicBoolean();
    private static volatile HttpURLConnection download;
    private static volatile boolean cancelled;

    private CrossgramUpdate() {
    }

    /**
     * Entry point of the patched checkAppUpdate(). Runs on the calling thread
     * and reports back through onDone (optional) on the UI thread.
     */
    public static void check(final Activity activity, final boolean force, final Runnable onDone) {
        final Context context = ApplicationLoader.applicationContext;
        if (context == null) {
            finish(onDone);
            return;
        }
        final SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!force && System.currentTimeMillis() - prefs.getLong(KEY_CHECKED_AT, 0) < AUTO_CHECK_INTERVAL_MS) {
            finish(onDone);
            return;
        }
        if (!checking.compareAndSet(false, true)) {
            finish(onDone);
            return;
        }
        new Thread(() -> {
            try {
                final JSONObject manifest = fetchManifest(MANIFEST_URL);
                prefs.edit().putLong(KEY_CHECKED_AT, System.currentTimeMillis()).apply();
                final JSONObject entry = matchEntry(context, manifest);
                final String installed = installedApkHash(context, prefs);
                if (entry == null || (installed != null && installed.equalsIgnoreCase(entry.optString("sha256")))) {
                    if (force) showAlert(activity, TITLE_UP_TO_DATE, UP_TO_DATE);
                    return;
                }
                final int build = entry.optInt("build");
                if (!force
                        && (build == prefs.getInt(KEY_PROMPTED_BUILD, 0)
                            || build == prefs.getInt(KEY_SKIPPED_BUILD, 0))) {
                    return;
                }
                prefs.edit().putInt(KEY_PROMPTED_BUILD, build).apply();
                offer(activity, prefs, entry, onDone);
                return;
            } catch (Exception error) {
                FileLog.e(error);
                if (force) showAlert(activity, CHECK_FAILED, error.toString());
            } finally {
                checking.set(false);
                finish(onDone);
            }
        }, "crossgram-update-check").start();
    }

    /** The release manifest entry that describes this exact build. */
    private static JSONObject matchEntry(Context context, JSONObject manifest) {
        final JSONArray assets = manifest.optJSONArray("assets");
        if (assets == null) return null;
        final String variant = variant();
        final String brand = brand(context);
        for (int index = 0; index < assets.length(); index++) {
            final JSONObject asset = assets.optJSONObject(index);
            if (asset == null || !CLIENT.equals(asset.optString("client"))
                    || !variant.equals(asset.optString("variant"))
                    || !brand.equals(asset.optString("brand"))) {
                continue;
            }
            if (asset.optString("url").isEmpty() || asset.optString("sha256").isEmpty()) continue;
            return asset;
        }
        return null;
    }

    /** The release variant that matches the ABI this installation runs on. */
    private static String variant() {
        for (String abi : Build.SUPPORTED_ABIS) {
            if (abi == null) continue;
            if (abi.startsWith("arm64")) return "arm64";
            if (abi.startsWith("x86_64")) return "x86_64";
            if (abi.startsWith("armeabi")) return "arm";
            if (abi.startsWith("x86")) return "x86";
        }
        return "arm64";
    }

    /** The brand suffix the branding patch appended to the application id. */
    private static String brand(Context context) {
        final String packageName = context.getPackageName();
        final int marker = packageName.lastIndexOf(BRAND_MARKER);
        return marker < 0 ? "" : packageName.substring(marker + BRAND_MARKER.length());
    }

    /** SHA-256 of the installed APK, cached until that file changes. */
    private static String installedApkHash(Context context, SharedPreferences prefs) {
        final File apk = new File(context.getApplicationInfo().sourceDir);
        final String stamp = apk.length() + ":" + apk.lastModified();
        final String cached = prefs.getString(KEY_APK_HASH, "");
        if (cached.startsWith(stamp + ":")) return cached.substring(stamp.length() + 1);
        try {
            final String hash = sha256(apk);
            prefs.edit().putString(KEY_APK_HASH, stamp + ":" + hash).apply();
            return hash;
        } catch (Exception error) {
            FileLog.e(error);
            return null;
        }
    }

    private static void offer(Activity activity, SharedPreferences prefs, JSONObject entry, Runnable onDone) {
        if (activity == null || activity.isFinishing()) return;
        final int build = entry.optInt("build");
        final String version = entry.optString("version");
        final long size = entry.optLong("size");
        final String notes = entry.optString("notes");
        final StringBuilder message = new StringBuilder();
        message.append("#").append(build);
        if (!version.isEmpty()) message.append(SEPARATOR).append(version);
        if (size > 0) message.append(SEPARATOR).append(formatSize(size));
        if (!notes.isEmpty()) message.append("\n\n").append(notes);
        AndroidUtilities.runOnUIThread(() -> {
            try {
                new AlertDialog.Builder(activity)
                        .setTitle(TITLE)
                        .setMessage(message.toString())
                        .setPositiveButton(DOWNLOAD_AND_INSTALL, (dialog, which) -> download(activity, entry, onDone))
                        .setNegativeButton(LATER, null)
                        .setNeutralButton(SKIP_THIS_BUILD, (dialog, which) ->
                                prefs.edit().putInt(KEY_SKIPPED_BUILD, build).apply())
                        .show();
            } catch (Exception error) {
                FileLog.e(error);
            }
        });
    }

    private static void download(Activity activity, JSONObject entry, Runnable onDone) {
        final Context context = ApplicationLoader.applicationContext;
        if (context == null || activity == null || activity.isFinishing()) return;
        final File directory = new File(context.getFilesDir(), "crossgram-update");
        //noinspection ResultOfMethodCallIgnored
        directory.mkdirs();
        final File target = new File(directory, "crossgram-" + entry.optInt("build") + ".apk");
        cancelled = false;
        final AlertDialog progress;
        try {
            progress = new AlertDialog.Builder(activity)
                    .setTitle(DOWNLOADING)
                    .setNegativeButton(CANCEL, (dialog, which) -> cancelDownload())
                    .setOnCancelListener(dialog -> cancelDownload())
                    .show();
            progress.setProgress(0);
        } catch (Exception error) {
            FileLog.e(error);
            return;
        }
        new Thread(() -> {
            try {
                transfer(entry.optString("url"), target, entry.optLong("size"), percent ->
                        AndroidUtilities.runOnUIThread(() -> {
                            if (progress.isShowing()) progress.setProgress(percent);
                        }));
                final String expected = entry.optString("sha256");
                if (!expected.equalsIgnoreCase(sha256(target))) {
                    throw new IllegalStateException("checksum mismatch");
                }
                AndroidUtilities.runOnUIThread(() -> {
                    if (progress.isShowing()) progress.dismiss();
                    install(activity, target, entry.optString("url"));
                });
            } catch (Exception error) {
                FileLog.e(error);
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                AndroidUtilities.runOnUIThread(() -> {
                    if (progress.isShowing()) progress.dismiss();
                    showAlert(activity, DOWNLOAD_FAILED, error.toString());
                });
            }
        }, "crossgram-update-download").start();
    }

    private static void transfer(String url, File target, long expectedSize, Progress progress) throws Exception {
        final HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        download = connection;
        try {
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.connect();
            final int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            final long total = expectedSize > 0 ? expectedSize : connection.getContentLength();
            try (InputStream input = connection.getInputStream();
                 OutputStream output = new FileOutputStream(target)) {
                final byte[] buffer = new byte[BUFFER_SIZE];
                long written = 0;
                int read;
                int reported = -1;
                while ((read = input.read(buffer)) >= 0) {
                    if (cancelled) throw new IllegalStateException("cancelled");
                    output.write(buffer, 0, read);
                    written += read;
                    if (progress != null && total > 0) {
                        final int percent = (int) (written * 100 / total);
                        if (percent != reported) {
                            reported = percent;
                            progress.update(percent);
                        }
                    }
                }
            }
            if (expectedSize > 0 && target.length() != expectedSize) {
                throw new IllegalStateException("expected " + expectedSize + " bytes, got " + target.length());
            }
        } finally {
            download = null;
            connection.disconnect();
        }
    }

    private static void cancelDownload() {
        cancelled = true;
        final HttpURLConnection connection = download;
        if (connection != null) connection.disconnect();
    }

    /**
     * Installs the downloaded APK. Android always asks the user to confirm;
     * when the session cannot even be created (missing permission, MIUI, ...)
     * the release asset is opened in the browser instead.
     */
    private static void install(Activity activity, File apk, String url) {
        final Context context = ApplicationLoader.applicationContext;
        if (context == null) {
            Browser.openUrl(activity, url);
            return;
        }
        try {
            final PackageInstaller installer = context.getPackageManager().getPackageInstaller();
            final PackageInstaller.SessionParams params =
                    new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            }
            final PendingIntent pending = PendingIntent.getActivity(context, 0,
                    new Intent(context, LaunchActivity.class),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            try (PackageInstaller.Session session = installer.openSession(installer.createSession(params))) {
                try (OutputStream output = session.openWrite(apk.getName(), 0, apk.length());
                     InputStream input = new FileInputStream(apk)) {
                    final byte[] buffer = new byte[BUFFER_SIZE];
                    int read;
                    while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
                    session.fsync(output);
                }
                session.commit(pending.getIntentSender());
            }
        } catch (Exception error) {
            FileLog.e(error);
            showAlert(activity, INSTALL_FAILED, error.toString());
            Browser.openUrl(activity, url);
        }
    }

    private static void showAlert(Activity activity, String title, String text) {
        if (activity == null || activity.isFinishing()) return;
        AndroidUtilities.runOnUIThread(() -> {
            try {
                new AlertDialog.Builder(activity)
                        .setTitle(title)
                        .setMessage(text)
                        .setPositiveButton(OK, null)
                        .show();
            } catch (Exception error) {
                FileLog.e(error);
            }
        });
    }

    private static JSONObject fetchManifest(String url) throws Exception {
        final HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            connection.connect();
            final int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            final StringBuilder body = new StringBuilder();
            try (InputStream input = connection.getInputStream()) {
                final byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    body.append(new String(buffer, 0, read, "UTF-8"));
                }
            }
            return new JSONObject(body.toString());
        } finally {
            connection.disconnect();
        }
    }

    private static String sha256(File file) throws Exception {
        final MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            final byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read);
        }
        final byte[] bytes = digest.digest();
        final StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            hex.append(Character.forDigit((value >> 4) & 0xf, 16));
            hex.append(Character.forDigit(value & 0xf, 16));
        }
        return hex.toString();
    }

    private static String formatSize(long bytes) {
        if (bytes >= 1024L * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)) + " GB";
        if (bytes >= 1024L * 1024) return (bytes / (1024 * 1024)) + " MB";
        if (bytes >= 1024L) return (bytes / 1024) + " KB";
        return bytes + " B";
    }

    private static void finish(Runnable onDone) {
        if (onDone != null) AndroidUtilities.runOnUIThread(onDone);
    }

    private interface Progress {
        void update(int percent);
    }
}
