import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  patchConnectionsJavaSource,
  patchCustomDatacenterRoutingSource,
  patchDatacenterPortSource,
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

describe("server switch login entry", () => {
  it("adds one independent top-left icon and is idempotent", async () => {
    const icon = await readFile(path.join(root, "java-snippets/login-server-icon.java"), "utf8");
    const legacy = await readFile(path.join(root, "java-snippets/legacy-standalone-login-button.java"), "utf8");
    const patched = patchLoginIconSource(loginActivity(), file, icon, legacy);

    expect(patched).toContain("private ImageView serverSwitchButton;");
    expect(patched).toContain("serverSwitchButton = new ImageView(context);");
    expect(patched).toContain("Gravity.LEFT | Gravity.TOP");
    expect(patched).toContain("AndroidUtilities.statusBarHeight");
    expect(patched).toContain("serverSwitchLayout.topMargin");
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
});

describe("server switch initialization", () => {
  it("restores the selected custom datacenters after tgnet cleanup", () => {
    const source = `package org.telegram.tgnet;

import org.telegram.messenger.FileLog;

public class ConnectionsManager {
    public ConnectionsManager(int currentAccount) {
        init(currentAccount);
    }

    public void cleanup(boolean resetKeys) {
        native_cleanUp(currentAccount, resetKeys);
    }

    public static void onRequestNewServerIpAndPort(int currentAccount) {
        requestNewServerIpAndPort(currentAccount);
    }

    public static native void native_applyDatacenterAddress(int currentAccount, int dcId, String ip, int port);
}`;
    const connectionsFile = "TMessagesProj/src/main/java/org/telegram/tgnet/ConnectionsManager.java";
    const patched = patchConnectionsJavaSource(source, connectionsFile);

    expect(patched).toContain("native_cleanUp(currentAccount, resetKeys);\n        ServerSwitchConfig.applyForInitialization(currentAccount);");
    expect(patched.indexOf("native_cleanUp(currentAccount, resetKeys);")).toBeLessThan(
      patched.indexOf("ServerSwitchConfig.applyForInitialization(currentAccount);", patched.indexOf("public void cleanup")),
    );
    expect(patchConnectionsJavaSource(patched, connectionsFile)).toBe(patched);
  });

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

  it("keeps custom routes for generic and media connections after help.getConfig", () => {
    const managerFile = "TMessagesProj/jni/tgnet/ConnectionsManager.cpp";
    const source = `void ConnectionsManager::updateDcSettings(uint32_t dcNum, bool workaround, bool retry) {
    auto request = new TL_help_getConfig();
    sendRequest(request, [&](TLObject *response) {
        if (response != nullptr) {
            auto config = (TL_config *) response;
            std::map<uint32_t, std::unique_ptr<DatacenterInfo>> map;
            size_t count = config->dc_options.size();
        }
    });
}

void ConnectionsManager::applyDatacenterAddress(uint32_t datacenterId, std::string ipAddress, uint32_t port) {
    scheduleTask([&, datacenterId, ipAddress, port] {
        Datacenter *datacenter = getDatacenterWithId(datacenterId);
        if (datacenter != nullptr) {
            std::vector<TcpAddress> addresses;
            addresses.emplace_back(ipAddress, port, 0, "");
            datacenter->replaceAddresses(addresses, 0);
            datacenter->resetAddressAndPortNum();
        }
    });
}`;
    const patched = patchCustomDatacenterRoutingSource(source, managerFile);

    expect(patched).toContain(
      "size_t count = customServerId.empty() ? config->dc_options.size() : 0;",
    );
    expect(patched).toContain("std::vector<TcpAddress> emptyAddresses;");
    expect(patched).toContain("datacenter->replaceAddresses(addresses, 0);");
    expect(patched).toContain("datacenter->replaceAddresses(emptyAddresses, 1);");
    expect(patched).toContain("datacenter->replaceAddresses(addresses, 2);");
    expect(patched).toContain("datacenter->replaceAddresses(emptyAddresses, 3);");
    expect(patched.indexOf("replaceAddresses(addresses, 2)")).toBeLessThan(
      patched.indexOf("resetAddressAndPortNum()"),
    );
    expect(patchCustomDatacenterRoutingSource(patched, managerFile)).toBe(patched);
  });

  it("keeps the configured port of a custom server instead of Telegram's default ports", () => {
    const datacenterFile = "TMessagesProj/jni/tgnet/Datacenter.cpp";
    const source = `int32_t Datacenter::getCurrentPort(uint32_t flags) {
    TcpAddress *address = &((*addresses) [currentAddressNum]);
    int32_t port;
    if (!address->secret.empty()) {
        port = -1;
    } else {
        port = defaultPorts[currentPortNum];
    }
    if (port == -1) {
        return address->port;
    }
    return port;
}

bool Datacenter::isCustomPort(uint32_t flags) {
    uint32_t currentPortNum;
    return defaultPorts[currentPortNum] != -1;
}`;
    const patched = patchDatacenterPortSource(source, datacenterFile);
    // With a custom server the port slot resolves to -1, which makes the
    // existing branch below return the address's own configured port.
    expect(patched).toContain(
      "port = ConnectionsManager::getInstance(instanceNum).hasCustomServer()\n                ? -1 : defaultPorts[currentPortNum];",
    );
    expect(patched).toContain("return address->port;");
    expect(patched).toContain(
      "return !ConnectionsManager::getInstance(instanceNum).hasCustomServer()\n            && defaultPorts[currentPortNum] != -1;",
    );
    expect(patchDatacenterPortSource(patched, datacenterFile)).toBe(patched);
    expect(() => patchDatacenterPortSource("int32_t Datacenter::getCurrentPort() {}", datacenterFile))
      .toThrow(/expected one semantic match, found 0/);
  });

  it("patches the port selection of every upstream it builds", async () => {
    const { existsSync } = await import("node:fs");
    const datacenterFile = "TMessagesProj/jni/tgnet/Datacenter.cpp";
    for (const relative of [
      "upstream-check/nagram", "upstream-check/telegram", "upstream-check/nnngram",
      "upstream-check/nullgram", "mercurygram", "forkgram",
    ]) {
      const file = path.resolve("..", "work", "references", relative, datacenterFile);
      if (!existsSync(file)) continue;
      const patched = patchDatacenterPortSource(await readFile(file, "utf8"), datacenterFile);
      expect(patched.match(/hasCustomServer\(\)/g), relative).toHaveLength(2);
    }
  });

  it("defines the custom server predicate once for a fresh and an already-patched manager", async () => {
    const methods = await readFile(path.join(root, "native/manager-methods.cpp"), "utf8");
    // The predicate is inserted by its own idempotent step so trees patched
    // before it existed gain it too; the template must not define it again.
    expect(methods).not.toContain("hasCustomServer");
    const patch = await readFile(path.resolve("features/server-switch/patch.ts"), "utf8");
    expect(patch).toContain('"bool ConnectionsManager::hasCustomServer() const"');
    expect(patch).toContain('"bool hasCustomServer() const;"');
    expect(patch.indexOf("await patchDatacenter(root, changedFiles);"))
      .toBeGreaterThan(patch.indexOf("await patchManagerCpp(root, changedFiles);"));
  });
});
