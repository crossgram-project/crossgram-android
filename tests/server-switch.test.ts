import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  discardLateSpecialConfig,
  patchLoginIconSource,
} from "../features/server-switch/patch.js";

const root = path.resolve("features/server-switch/files");
const file = "TMessagesProj/src/main/java/org/telegram/ui/LoginActivity.java";

function loginActivity(extra = ""): string {
  return `package org.telegram.ui;

import android.content.Context;
import android.widget.ImageView;

public class LoginActivity {
    private ImageView backButtonView;
${extra}
    public View createView(Context context) {
        if (fragmentView != null) {
            return fragmentView;
        }
        fragmentView = sizeNotifierFrameLayout;
        return fragmentView;
    }

    public void setPage(int page, boolean animated) {
        currentViewNum = page;
    }
}
`;
}

function nagramLoginActivity(): string {
  return loginActivity(`    private boolean testBackend;
    private int currentAccount;
    private final class PhoneView {
        private final Object codeField = new Object();
        void submit() {
            if (!testBackend && "999".equals(codeField.getText().toString())) {
                testBackend = true;
            }
        }
    }
`);
}

describe("server switch login entry", () => {
  it("adds one independent top-left icon and is idempotent", async () => {
    const icon = await readFile(path.join(root, "java-snippets/login-server-icon.java"), "utf8");
    const legacy = await readFile(path.join(root, "java-snippets/legacy-standalone-login-button.java"), "utf8");
    const patched = patchLoginIconSource(loginActivity(), file, icon, legacy);

    expect(patched).toContain("private ImageView serverSwitchButton;");
    expect(patched).toContain("serverSwitchButton = new ImageView(context);");
    expect(patched).toContain("Gravity.LEFT | Gravity.TOP");
    expect(patched).toContain("updateServerSwitchButtonVisibility(page);");
    expect(patched.indexOf("serverSwitchButton = new ImageView(context);")).toBeLessThan(
      patched.lastIndexOf("return fragmentView;"),
    );
    expect(patchLoginIconSource(patched, file, icon, legacy)).toBe(patched);
  });

  it("removes the previous standalone and overflow-menu entries", async () => {
    const icon = await readFile(path.join(root, "java-snippets/login-server-icon.java"), "utf8");
    const legacy = await readFile(path.join(root, "java-snippets/legacy-standalone-login-button.java"), "utf8");
    const withLegacyEntries = loginActivity(`    private static final int SERVER_SWITCH_MENU_ID = 0x5357;
    void legacyMenu() {
        moreButtonView.addSubItem(SERVER_SWITCH_MENU_ID, LocaleController.getString(R.string.ServerSwitchTitle));
        moreButtonView.setDelegate(id -> {
            if (id == SERVER_SWITCH_MENU_ID) {
                ServerSwitchDialogs.showSelector(this, currentAccount, null);
            } else if (id == 0) {
                openProxy();
            }
        });
    }
`)
      .replace("        return fragmentView;\n    }", `${legacy.trimEnd()}\n        return fragmentView;\n    }`);
    const patched = patchLoginIconSource(withLegacyEntries, file, icon, legacy);

    expect(patched).not.toContain("SERVER_SWITCH_MENU_ID");
    expect(patched).not.toContain("TextView serverSwitchButton");
    expect(patched).toContain("if (id == 0)");
    expect(patched.match(/serverSwitchButton = new ImageView\(context\);/g)).toHaveLength(1);
  });

  it("restores Nagram's own custom-backend action", async () => {
    const icon = await readFile(path.join(root, "java-snippets/login-server-icon.java"), "utf8");
    const legacy = await readFile(path.join(root, "java-snippets/legacy-standalone-login-button.java"), "utf8");
    const nagram = loginActivity(`    void legacyMenu(int id) {
        menu.addSubItem(menu_custom_dc, R.drawable.msg_retry, LocaleController.getString(R.string.ServerSwitchTitle))
                .setContentDescription(LocaleController.getString(R.string.ServerSwitchTitle));
        if (id == 0) {
            openProxy();
        } else if (id == menu_custom_dc) {
            ServerSwitchDialogs.showSelector(this, currentAccount, null);
        }
    }
`);
    const patched = patchLoginIconSource(nagram, file, icon, legacy);

    expect(patched).toContain("R.string.CustomBackend");
    expect(patched).toContain("phoneView.testBackendCheckBox");
    expect(patched.match(/ServerSwitchDialogs\.showSelector/g)).toHaveLength(1);
  });

  it("does not let Nagram's 999 shortcut leave a selected custom server", async () => {
    const icon = await readFile(path.join(root, "java-snippets/login-server-icon.java"), "utf8");
    const legacy = await readFile(path.join(root, "java-snippets/legacy-standalone-login-button.java"), "utf8");
    const patched = patchLoginIconSource(nagramLoginActivity(), file, icon, legacy);

    expect(patched).toContain("import org.telegram.messenger.server_switch.ServerSwitchConfig;");
    expect(patched).toContain(`if (!testBackend && "999".equals(codeField.getText().toString())
                        && ServerSwitchConfig.getSelectedServerId(currentAccount).isEmpty()) {`);
    expect(patchLoginIconSource(patched, file, icon, legacy)).toBe(patched);
  });
});

describe("server switch initialization", () => {
  it("injects startup configuration without resetting restored datacenters", async () => {
    const javaConfig = await readFile(
      path.join(root, "java/org/telegram/messenger/server_switch/ServerSwitchConfig.java"),
      "utf8",
    );
    const nativeMethods = await readFile(path.join(root, "native/manager-methods.cpp"), "utf8");
    const wrapper = await readFile(path.join(root, "native/wrapper-method.cpp"), "utf8");
    const patcher = await readFile(path.resolve("features/server-switch/patch.ts"), "utf8");

    expect(javaConfig).toContain("applyLocked(getStore(), account, false)");
    expect(javaConfig).toContain("applyLocked(store, account, true)");
    expect(nativeMethods).toContain("if (!resetDatacenters)");
    expect(nativeMethods.indexOf("if (!resetDatacenters)")).toBeLessThan(
      nativeMethods.indexOf("scheduleTask("),
    );
    expect(wrapper).toContain("jboolean resetDatacenters");
    expect(patcher).toContain("ServerSwitchConfig.applyForInitialization(currentAccount);");
    expect(patcher).toContain("Ljava/lang/String;ZZ)V");
  });

  it("drops an already in-flight official DNS config after selecting a custom server", () => {
    const body = `
    scheduleTask([&, buffer, phone, date] {
        TL_help_configSimple *config = Datacenter::decodeSimpleConfig(buffer);
        if (config == nullptr) {
            delegate->onRequestNewServerIpAndPort(requestingSecondAddress, instanceNum);
        }
        buffer->reuse();
    });
`;
    const patched = discardLateSpecialConfig(body, "ConnectionsManager.cpp");

    expect(patched).toContain("discard a late official DNS config after switching servers");
    expect(patched).toContain(`if (!enableSpecialConfig) {
            requestingSecondAddress = 0;
            buffer->reuse();
            return;
        }`);
    expect(patched.indexOf("if (!enableSpecialConfig)")).toBeLessThan(
      patched.indexOf("Datacenter::decodeSimpleConfig(buffer)"),
    );
    expect(discardLateSpecialConfig(patched, "ConnectionsManager.cpp")).toBe(patched);
  });
});
