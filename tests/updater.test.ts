import { describe, expect, it } from "vitest";

import { patchUpdaterLaunchActivity, updaterOverloads } from "../features/updater/patch.js";

const nagramLaunchActivity = `
import org.telegram.messenger.browser.Browser;
import org.telegram.ui.ActionBar.BaseFragment;

public class LaunchActivity extends BaseFragment {
    private boolean firstAppUpdateCheck = true;

    public void checkAppUpdate(boolean force, Browser.Progress progress) {
        checkAppUpdate(force, progress, false);
    }

    public void checkAppUpdate(boolean force, Browser.Progress progress, boolean updateAlways) {
        if (ApplicationLoader.applicationLoaderInstance.isCustomUpdate()) {
            final BetaUpdate prevUpdate = ApplicationLoader.applicationLoaderInstance.getUpdate();
            ApplicationLoader.applicationLoaderInstance.checkUpdate(force, () -> {
                final BetaUpdate pendingUpdate = ApplicationLoader.applicationLoaderInstance.getUpdate();
            });
            return;
        }
        final TLRPC.TL_help_getAppUpdate req = new TLRPC.TL_help_getAppUpdate();
        UpdateHelper.getInstance().checkNewVersionAvailable((res, error) -> {
            SharedConfig.lastUpdateCheckTime = System.currentTimeMillis();
        }, updateAlways);
    }
}
`;

const forkgramLaunchActivity = `
import org.telegram.messenger.browser.Browser;

public class LaunchActivity extends BaseFragment {
    public void checkAppUpdate(boolean force, Browser.Progress progress) {
        checkAppUpdate(force, progress, 0);
    }

    public void checkAppUpdate(boolean force, Browser.Progress progress, int dummy) {
        final TLRPC.TL_help_getAppUpdate req = new TLRPC.TL_help_getAppUpdate();
        ConnectionsManager.getInstance(currentAccount).sendRequest(req, (response, error) -> {
        });
    }
}
`;

const nullgramLaunchActivity = `
import org.telegram.ui.ActionBar.BaseFragment;

public class LaunchActivity extends BaseFragment {
    public void checkAppUpdate(boolean force) {
        UpdateUtils.checkUpdate((res, error) -> {
            if (res != null) {
                showUpdateAppPopup(res);
            }
        });
    }
}
`;

describe("updater Android patch", () => {
  it("replaces every checkAppUpdate overload and keeps the progress contract", () => {
    const patched = patchUpdaterLaunchActivity(nagramLaunchActivity);
    expect(patched).toContain("import org.telegram.messenger.crossgram_update.CrossgramUpdate;");
    expect(patched.match(/CrossgramUpdate\.check\(/g)).toHaveLength(2);
    expect(patched).not.toContain("isCustomUpdate()");
    expect(patched).not.toContain("checkNewVersionAvailable");
    expect(patched).toContain("progress.init();");
    expect(patched).toContain("progress.end();");
    // The 2-arg overload no longer delegates to the 3-arg one.
    expect(patched).not.toContain("checkAppUpdate(force, progress, false);");
  });

  it("handles the fork overloads that take no progress object", () => {
    const patched = patchUpdaterLaunchActivity(nullgramLaunchActivity);
    expect(patched).toContain("CrossgramUpdate.check(this, force, null);");
    expect(patched).not.toContain("progress");
    expect(patched).not.toContain("UpdateUtils.checkUpdate");
  });

  it("patches both forkgram overloads without touching unrelated signatures", () => {
    const patched = patchUpdaterLaunchActivity(forkgramLaunchActivity);
    expect(patched.match(/CrossgramUpdate\.check\(/g)).toHaveLength(2);
    expect(patched).not.toContain("TL_help_getAppUpdate");
    expect(patched).toContain("checkAppUpdate(boolean force, Browser.Progress progress, int dummy)");
  });

  it("is idempotent", () => {
    for (const source of [nagramLaunchActivity, forkgramLaunchActivity, nullgramLaunchActivity]) {
      const once = patchUpdaterLaunchActivity(source);
      expect(patchUpdaterLaunchActivity(once)).toBe(once);
    }
  });

  it("fails loudly when the fork has no update entry point", () => {
    expect(() => patchUpdaterLaunchActivity(
      "import org.telegram.ui.ActionBar.BaseFragment;\n\npublic class LaunchActivity extends BaseFragment { }",
    )).toThrow(/checkAppUpdate/);
  });

  it("covers every overload shape the supported forks ship", () => {
    expect(updaterOverloads.map((overload) => overload.label)).toEqual([
      "checkAppUpdate(boolean, Browser.Progress, boolean)",
      "checkAppUpdate(boolean, Browser.Progress, int)",
      "checkAppUpdate(boolean, Browser.Progress)",
      "checkAppUpdate(boolean)",
    ]);
  });
});
