package org.telegram.ui;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;

import org.telegram.messenger.ApplicationLoader;
import org.telegram.messenger.BuildConfig;
import org.telegram.messenger.server_switch.ServerSwitchConfig;

import java.nio.charset.StandardCharsets;

/** A debug-build-only adb bridge for exercising the real Telegram UI and business methods. */
public final class CrossgramE2eActivity extends Activity {
    public static final String ACTION = "org.telegram.messenger.CROSSGRAM_E2E";
    public static final String EXTRA_COMMAND = "crossgram_e2e_command";
    public static final String EXTRA_SERVER_CONFIG_BASE64 = "crossgram_e2e_server_config_base64";

    private static final String TAG = "CrossgramE2E";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!BuildConfig.DEBUG) {
            finish();
            return;
        }

        try {
            ApplicationLoader.postInitApplication();
            String encodedConfig = getIntent().getStringExtra(EXTRA_SERVER_CONFIG_BASE64);
            if (encodedConfig != null && !encodedConfig.isEmpty()) {
                String config = new String(Base64.decode(encodedConfig, Base64.DEFAULT), StandardCharsets.UTF_8);
                ServerSwitchConfig.addAndSelect(0, config);
                Log.i(TAG, "server_config_applied");
            }

            String command = getIntent().getStringExtra(EXTRA_COMMAND);
            if (command != null && !"configure".equals(command)) {
                Intent launch = new Intent(this, LaunchActivity.class);
                launch.setAction(ACTION);
                launch.putExtras(getIntent());
                launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(launch);
                Log.i(TAG, "command_dispatched:" + command);
            }
        } catch (Throwable error) {
            Log.e(TAG, "dispatcher_failed:" + error.getClass().getSimpleName());
        } finally {
            finish();
        }
    }
}
