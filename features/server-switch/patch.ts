import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import {
  PatchError,
  addJavaImport,
  editDeclarationBody,
  replaceRegexOnce,
} from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));

export interface PatchResult {
  changedFiles: string[];
}

async function template(relative: string): Promise<string> {
  return readUtf8(path.join(featureRoot, "files", relative));
}

async function editFile(
  root: string,
  relative: string,
  changed: string[],
  edit: (source: string) => string | Promise<string>,
): Promise<void> {
  const file = path.join(root, relative);
  const source = await readUtf8(file);
  const updated = await edit(source);
  if (await writeUtf8IfChanged(file, updated)) changed.push(relative);
}

async function installFile(
  root: string,
  target: string,
  source: string,
  changed: string[],
): Promise<void> {
  if (await writeUtf8IfChanged(path.join(root, target), await template(source))) changed.push(target);
}

export function patchConnectionsJavaSource(initial: string, file: string): string {
    let source = addJavaImport(initial, "org.telegram.messenger.server_switch.ServerSwitchConfig", file);
    source = source.replace(
      "ServerSwitchConfig.apply(currentAccount);",
      "ServerSwitchConfig.applyForInitialization(currentAccount);",
    );
    source = editDeclarationBody(
      source,
      /(?:public|private|protected)\s+ConnectionsManager\s*\(/,
      file,
      "ConnectionsManager constructor",
      (body) => replaceRegexOnce(
        body,
        /^(\s*)init\(/m,
        "$1ServerSwitchConfig.applyForInitialization(currentAccount);\n$1init(",
        "ServerSwitchConfig.applyForInitialization(currentAccount);",
        file,
        "initialize the account's selected server before tgnet starts",
      ),
    );
    source = editDeclarationBody(
      source,
      /public\s+static\s+void\s+onRequestNewServerIpAndPort\s*\(/,
      file,
      "ConnectionsManager.onRequestNewServerIpAndPort",
      (body) => {
        if (body.includes("ServerSwitchConfig.isSpecialConfigEnabled")) return body;
        return `\n        if (!ServerSwitchConfig.isSpecialConfigEnabled(currentAccount)) {\n            return;\n        }${body}`;
      },
    );
    source = editDeclarationBody(
      source,
      /public\s+void\s+cleanup\s*\(/,
      file,
      "ConnectionsManager.cleanup",
      (body) => replaceRegexOnce(
        body,
        /(^\s*native_cleanUp\(currentAccount, resetKeys\);[ \t]*$)/m,
        "$1\n        ServerSwitchConfig.applyForInitialization(currentAccount);",
        "ServerSwitchConfig.applyForInitialization(currentAccount);",
        file,
        "restore the selected custom server after tgnet cleanup resets datacenters",
      ),
    );
    const nativeDeclaration = "    public static native void native_setServerConfig(int currentAccount, String configId, String rsaKey, boolean enableSpecialConfig, boolean resetDatacenters);";
    if (/public\s+static\s+native\s+void\s+native_setServerConfig\s*\(/.test(source)) {
      source = source.replace(
        /^[ \t]*public\s+static\s+native\s+void\s+native_setServerConfig\s*\([^;]+;[ \t]*$/m,
        nativeDeclaration,
      );
    } else {
      source = replaceRegexOnce(
        source,
        /(^[ \t]*public\s+static\s+native\s+void\s+native_applyDatacenterAddress\s*\([^;]+;[ \t]*$)/m,
        `$1\n\n${nativeDeclaration}`,
        "native_setServerConfig(int currentAccount",
        file,
        "declare the server configuration JNI method",
      );
    }
    return source;
}

async function patchConnectionsJava(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/src/main/java/org/telegram/tgnet/ConnectionsManager.java";
  await editFile(root, file, changed, (initial) => patchConnectionsJavaSource(initial, file));
}

async function patchWrapper(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/jni/TgNetWrapper.cpp";
  const wrapper = await template("native/wrapper-method.cpp");
  await editFile(root, file, changed, (initial) => {
    let source = initial.replace(
      /jboolean enableSpecialConfig\)\s*\{(?=[\s\S]*?ConnectionsManager::getInstance\(instanceNum\)\.setServerConfig)/,
      "jboolean enableSpecialConfig, jboolean resetDatacenters) {",
    ).replace(
      /std::string\(configIdStr\),\s*std::string\(rsaKeyStr\),\s*enableSpecialConfig\);/,
      "std::string(configIdStr), std::string(rsaKeyStr), enableSpecialConfig,\n            resetDatacenters);",
    ).replace(
      /\{"native_setServerConfig",\s*"\(ILjava\/lang\/String;Ljava\/lang\/String;Z\)V"/,
      '{"native_setServerConfig", "(ILjava/lang/String;Ljava/lang/String;ZZ)V"',
    );
    source = replaceRegexOnce(
      source,
      /(?=void\s+setProxySettings\s*\()/,
      `${wrapper}\n`,
      "void setServerConfig(JNIEnv",
      file,
      "insert the JNI server configuration bridge",
    );
    source = replaceRegexOnce(
      source,
      /(^[ \t]*\{"native_applyDatacenterAddress"[\s\S]*?\(void\s*\*\)\s*applyDatacenterAddress\},[ \t]*$)/m,
      '$1\n        {"native_setServerConfig", "(ILjava/lang/String;Ljava/lang/String;ZZ)V", (void *) setServerConfig},',
      '{"native_setServerConfig"',
      file,
      "register the JNI server configuration bridge",
    );
    return source;
  });
}

async function patchManagerHeader(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/jni/tgnet/ConnectionsManager.h";
  await editFile(root, file, changed, (initial) => {
    let source = initial;
    const managerDeclaration = "    void setServerConfig(std::string configId, std::string rsaKey, bool enableSpecialConfig,\n                         bool resetDatacenters);";
    if (/void\s+setServerConfig\s*\(/.test(source)) {
      source = source.replace(
        /^[ \t]*void\s+setServerConfig\s*\([^;]+;[ \t]*$/m,
        managerDeclaration,
      );
    } else {
      source = replaceRegexOnce(
        source,
        /(^[ \t]*void\s+applyDatacenterAddress\s*\([^;]+;[ \t]*$)/m,
        `$1\n${managerDeclaration}\n    const std::string &getCustomServerRsaKey() const;`,
        "void setServerConfig(std::string configId",
        file,
        "declare ConnectionsManager server configuration methods",
      );
    }
    source = replaceRegexOnce(
      source,
      /(^[ \t]*bool\s+testBackend\s*=\s*false;[ \t]*$)/m,
      "$1\n    bool enableSpecialConfig = true;\n    std::string customServerId;\n    std::string customServerRsaKey;",
      "std::string customServerId;",
      file,
      "add per-account native server configuration state",
    );
    return source;
  });
}

function replaceDelegateCalls(
  body: string,
  file: string,
  label: string,
  expected: number,
  resetWhenDisabled: boolean,
): string {
  if (body.includes("if (enableSpecialConfig)")) return body;
  const pattern = /^([ \t]*)delegate->onRequestNewServerIpAndPort\(requestingSecondAddress, instanceNum\);[ \t]*$/gm;
  const matches = [...body.matchAll(pattern)];
  if (matches.length !== expected) {
    throw new PatchError(file, `${label}: expected ${expected} fallback requests, found ${matches.length}`);
  }
  const updated = body.replace(pattern, (_line, indent: string) => {
    const reset = resetWhenDisabled ? ` else {\n${indent}    requestingSecondAddress = 0;\n${indent}}` : "";
    return `${indent}if (enableSpecialConfig) {\n${indent}    delegate->onRequestNewServerIpAndPort(requestingSecondAddress, instanceNum);\n${indent}}${reset}`;
  });
  if (!resetWhenDisabled) {
    const anchor = /^([ \t]*)buffer->reuse\(\);[ \t]*$/m;
    const match = updated.match(anchor);
    if (!match) throw new PatchError(file, `${label}: could not find buffer cleanup`);
    const indent = match[1] ?? "";
    return updated.replace(anchor, `${indent}if (!enableSpecialConfig) {\n${indent}    requestingSecondAddress = 0;\n${indent}}\n${indent}buffer->reuse();`);
  }
  return updated;
}

async function patchManagerCpp(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/jni/tgnet/ConnectionsManager.cpp";
  const methods = await template("native/manager-methods.cpp");
  await editFile(root, file, changed, (initial) => {
    let source = initial.replace(
      /bool specialConfigEnabled\)\s*\{(?=[\s\S]*?scheduleTask\(\[this, configId)/,
      "bool specialConfigEnabled, bool resetDatacenters) {",
    );
    if (source.includes("ConnectionsManager::setServerConfig") && !source.includes("if (!resetDatacenters)")) {
      source = editDeclarationBody(
        source,
        /void\s+ConnectionsManager::setServerConfig\s*\(/,
        file,
        "ConnectionsManager::setServerConfig",
        (body) => `\n    if (!resetDatacenters) {\n        customServerId = std::move(configId);\n        customServerRsaKey = std::move(rsaKey);\n        enableSpecialConfig = specialConfigEnabled;\n        return;\n    }${body}`,
      );
    }
    source = editDeclarationBody(
      source,
      /void\s+ConnectionsManager::onConnectionClosed\s*\(/,
      file,
      "ConnectionsManager::onConnectionClosed",
      (body) => replaceDelegateCalls(body, file, "onConnectionClosed special-config guard", 1, true),
    );
    source = editDeclarationBody(
      source,
      /void\s+ConnectionsManager::applyDnsConfig\s*\(/,
      file,
      "ConnectionsManager::applyDnsConfig",
      (body) => replaceDelegateCalls(body, file, "applyDnsConfig special-config guard", 2, false),
    );
    source = replaceRegexOnce(
      source,
      /(?=ConnectionState\s+ConnectionsManager::getConnectionState\s*\()/,
      `${methods}\n`,
      "ConnectionsManager::setServerConfig(std::string configId",
      file,
      "insert ConnectionsManager server configuration methods",
    );
    return source;
  });
}

async function patchHandshake(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/jni/tgnet/Handshake.cpp";
  const fingerprint = await template("native/rsa-fingerprint.cpp");
  const customKey = await template("native/handshake-custom-key.cpp");
  await editFile(root, file, changed, (initial) => {
    let source = replaceRegexOnce(
      initial,
      /(?=Handshake::Handshake\s*\()/,
      `${fingerprint}\n`,
      "getRsaPublicKeyFingerprint(const std::string",
      file,
      "insert MTProto RSA fingerprint calculation",
    );
    source = editDeclarationBody(
      source,
      /void\s+Handshake::processHandshakeResponse_resPQ\s*\(/,
      file,
      "Handshake::processHandshakeResponse_resPQ",
      (body) => {
        if (body.includes("getCustomServerRsaKey()")) return body;
        let updated = replaceRegexOnce(
          body,
          /(\}\s*else\s*\{\s*\n)(\s*)if\s*\(serverPublicKeys\.empty\(\)\)\s*\{/,
          `$1${customKey}$2if (customKey.empty() && serverPublicKeys.empty()) {`,
          "customKey.empty() && serverPublicKeys.empty()",
          file,
          "select a custom RSA key for non-CDN handshakes",
        );
        updated = replaceRegexOnce(
          updated,
          /size_t\s+count2\s*=\s*serverPublicKeysFingerprints\.size\(\);/,
          "size_t count2 = customKey.empty() ? serverPublicKeysFingerprints.size() : 0;",
          "customKey.empty() ? serverPublicKeysFingerprints.size() : 0",
          file,
          "prevent official RSA fallback for a custom server",
        );
        return updated;
      },
    );
    return source;
  });
}

function removeLegacyLoginEntries(source: string, file: string, legacyButton: string): string {
  let updated = source.replace(legacyButton.trimEnd(), "");
  updated = updated
    .replace(/^\s*private static final int SERVER_SWITCH_MENU_ID = 0x5357;\r?\n/m, "")
    .replace(/^\s*moreButtonView\.addSubItem\(SERVER_SWITCH_MENU_ID, LocaleController\.getString\(R\.string\.ServerSwitchTitle\)\);\r?\n/m, "")
    .replace(
      /if\s*\(id\s*==\s*SERVER_SWITCH_MENU_ID\)\s*\{\s*ServerSwitchDialogs\.showSelector\(this, currentAccount, null\);\s*\}\s*else\s+if\s*\(id\s*==\s*0\)\s*\{/,
      "if (id == 0) {",
    )
    .replace(
      /menu\.addSubItem\(menu_custom_dc,\s*R\.drawable\.msg_retry,\s*LocaleController\.getString\(R\.string\.ServerSwitchTitle\)\)\s*\r?\n\s*\.setContentDescription\(LocaleController\.getString\(R\.string\.ServerSwitchTitle\)\);/,
      "menu.addSubItem(menu_custom_dc, R.drawable.msg_retry, LocaleController.getString(R.string.CustomBackend))\n                .setContentDescription(LocaleController.getString(R.string.CustomBackend));",
    );
  if (updated.includes("menu_custom_dc")) {
    updated = editDeclarationBody(
      updated,
      /else\s+if\s*\(id\s*==\s*menu_custom_dc\)\s*\{/,
      file,
      "restore Nagram custom backend branch",
      (body) => body.includes("ServerSwitchDialogs.showSelector(this, currentAccount, null);")
        ? "\n                PhoneView phoneView = (PhoneView)views[VIEW_PHONE_INPUT];\n                if (phoneView.testBackendCheckBox != null) {\n                    if (phoneView.testBackendCheckBox.getVisibility() == View.GONE)\n                        phoneView.testBackendCheckBox.setVisibility(View.VISIBLE);\n                    else\n                        phoneView.testBackendCheckBox.setVisibility(View.GONE);\n                }\n            "
        : body,
    );
  }
  return updated;
}

export function patchLoginIconSource(
  initial: string,
  file: string,
  icon: string,
  legacyButton: string,
): string {
  let source = removeLegacyLoginEntries(initial, file, legacyButton);
  source = addJavaImport(source, "org.telegram.messenger.server_switch.ServerSwitchDialogs", file);
  source = replaceRegexOnce(
    source,
    /(^[ \t]*private\s+ImageView\s+backButtonView;[ \t]*$)/m,
    "$1\n    private ImageView serverSwitchButton;",
    "private ImageView serverSwitchButton;",
    file,
    "declare the server switch icon",
  );
  source = editDeclarationBody(
    source,
    /public\s+View\s+createView\s*\(\s*Context\s+context\s*\)/,
    file,
    "LoginActivity.createView",
    (body) => {
      const markerStart = "        // CROSSGRAM SERVER SWITCH ICON BEGIN";
      const markerEnd = "        // CROSSGRAM SERVER SWITCH ICON END";
      const markedStart = body.indexOf(markerStart);
      if (markedStart >= 0) {
        const markedEnd = body.indexOf(markerEnd, markedStart);
        if (markedEnd < 0) throw new PatchError(file, "LoginActivity.createView: unterminated server icon block");
        return `${body.slice(0, markedStart)}${icon.trimEnd()}${body.slice(markedEnd + markerEnd.length)}`;
      }
      const existingAssignment = body.indexOf("serverSwitchButton = new ImageView(context);");
      if (existingAssignment >= 0) {
        const existingStart = body.lastIndexOf("        if (activityMode == MODE_LOGIN) {", existingAssignment);
        const existingEnd = body.indexOf("\n        }", existingAssignment);
        if (existingStart < 0 || existingEnd < 0) {
          throw new PatchError(file, "LoginActivity.createView: could not replace the existing server icon");
        }
        return `${body.slice(0, existingStart)}${icon.trimEnd()}${body.slice(existingEnd + "\n        }".length)}`;
      }
      const anchor = "\n        return fragmentView;";
      const index = body.lastIndexOf(anchor);
      if (index < 0) throw new PatchError(file, "LoginActivity.createView: could not find final fragment return");
      return `${body.slice(0, index)}\n\n${icon.trimEnd()}${body.slice(index)}`;
    },
  );
  source = replaceRegexOnce(
    source,
    /(?=^[ \t]*public\s+void\s+setPage\s*\()/m,
    "    private void updateServerSwitchButtonVisibility(int page) {\n        if (serverSwitchButton != null) {\n            serverSwitchButton.setVisibility(activityMode == MODE_LOGIN && page == VIEW_PHONE_INPUT\n                    ? View.VISIBLE : View.GONE);\n        }\n    }\n\n",
    "void updateServerSwitchButtonVisibility(int page)",
    file,
    "add server switch icon visibility helper",
  );
  source = editDeclarationBody(
    source,
    /public\s+void\s+setPage\s*\(/,
    file,
    "LoginActivity.setPage",
    (body) => body.includes("updateServerSwitchButtonVisibility(page);")
      ? body
      : `\n        updateServerSwitchButtonVisibility(page);${body}`,
  );
  return source;
}

async function patchLoginIcon(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/src/main/java/org/telegram/ui/LoginActivity.java";
  const icon = await template("java-snippets/login-server-icon.java");
  const legacyButton = await template("java-snippets/legacy-standalone-login-button.java");
  await editFile(root, file, changed, (initial) => patchLoginIconSource(initial, file, icon, legacyButton));
}

export async function applyServerSwitch(root: string, _upstream: Upstream): Promise<PatchResult> {
  const changedFiles: string[] = [];
  await installFile(root, "TMessagesProj/src/main/java/org/telegram/messenger/server_switch/ServerSwitchConfig.java", "java/org/telegram/messenger/server_switch/ServerSwitchConfig.java", changedFiles);
  await installFile(root, "TMessagesProj/src/main/java/org/telegram/messenger/server_switch/ServerSwitchDialogs.java", "java/org/telegram/messenger/server_switch/ServerSwitchDialogs.java", changedFiles);
  await installFile(root, "TMessagesProj/src/main/res/values/server_switch_strings.xml", "res/values/server_switch_strings.xml", changedFiles);
  await installFile(root, "TMessagesProj/src/main/res/values-zh-rCN/server_switch_strings.xml", "res/values-zh-rCN/server_switch_strings.xml", changedFiles);

  await patchConnectionsJava(root, changedFiles);
  await patchWrapper(root, changedFiles);
  await patchManagerHeader(root, changedFiles);
  await patchManagerCpp(root, changedFiles);
  await patchHandshake(root, changedFiles);

  await patchLoginIcon(root, changedFiles);

  return { changedFiles };
}
