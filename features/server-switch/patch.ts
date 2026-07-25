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

async function patchConnectionsJava(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/src/main/java/org/telegram/tgnet/ConnectionsManager.java";
  await editFile(root, file, changed, (initial) => {
    let source = addJavaImport(initial, "org.telegram.messenger.server_switch.ServerSwitchConfig", file);
    source = editDeclarationBody(
      source,
      /(?:public|private|protected)\s+ConnectionsManager\s*\(/,
      file,
      "ConnectionsManager constructor",
      (body) => replaceRegexOnce(
        body,
        /^(\s*)init\(/m,
        "$1ServerSwitchConfig.apply(currentAccount);\n$1init(",
        "ServerSwitchConfig.apply(currentAccount);",
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
    source = replaceRegexOnce(
      source,
      /(^[ \t]*public\s+static\s+native\s+void\s+native_applyDatacenterAddress\s*\([^;]+;[ \t]*$)/m,
      "$1\n\n    public static native void native_setServerConfig(int currentAccount, String configId, String rsaKey, boolean enableSpecialConfig);",
      "native_setServerConfig(int currentAccount",
      file,
      "declare the server configuration JNI method",
    );
    return source;
  });
}

async function patchWrapper(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/jni/TgNetWrapper.cpp";
  const wrapper = await template("native/wrapper-method.cpp");
  await editFile(root, file, changed, (initial) => {
    let source = replaceRegexOnce(
      initial,
      /(?=void\s+setProxySettings\s*\()/,
      `${wrapper}\n`,
      "void setServerConfig(JNIEnv",
      file,
      "insert the JNI server configuration bridge",
    );
    source = replaceRegexOnce(
      source,
      /(^[ \t]*\{"native_applyDatacenterAddress"[\s\S]*?\(void\s*\*\)\s*applyDatacenterAddress\},[ \t]*$)/m,
      '$1\n        {"native_setServerConfig", "(ILjava/lang/String;Ljava/lang/String;Z)V", (void *) setServerConfig},',
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
    let source = replaceRegexOnce(
      initial,
      /(^[ \t]*void\s+applyDatacenterAddress\s*\([^;]+;[ \t]*$)/m,
      "$1\n    void setServerConfig(std::string configId, std::string rsaKey, bool enableSpecialConfig);\n    const std::string &getCustomServerRsaKey() const;",
      "void setServerConfig(std::string configId",
      file,
      "declare ConnectionsManager server configuration methods",
    );
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
    let source = editDeclarationBody(
      initial,
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

async function patchNagramMenu(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/src/main/java/org/telegram/ui/LoginActivity.java";
  await editFile(root, file, changed, (initial) => {
    let source = addJavaImport(initial, "org.telegram.messenger.server_switch.ServerSwitchDialogs", file);
    source = replaceRegexOnce(
      source,
      /menu\.addSubItem\(menu_custom_dc,\s*R\.drawable\.msg_retry,\s*LocaleController\.getString\(R\.string\.CustomBackend\)\)\s*\n\s*\.setContentDescription\(LocaleController\.getString\(R\.string\.CustomBackend\)\);/,
      "menu.addSubItem(menu_custom_dc, R.drawable.msg_retry, LocaleController.getString(R.string.ServerSwitchTitle))\n                .setContentDescription(LocaleController.getString(R.string.ServerSwitchTitle));",
      "menu_custom_dc, R.drawable.msg_retry, LocaleController.getString(R.string.ServerSwitchTitle)",
      file,
      "rename Nagram's custom backend menu",
    );
    source = editDeclarationBody(
      source,
      /else\s+if\s*\(id\s*==\s*menu_custom_dc\)\s*\{/,
      file,
      "Nagram custom backend branch",
      (body) => body.includes("ServerSwitchDialogs.showSelector")
        ? body
        : "\n                ServerSwitchDialogs.showSelector(this, currentAccount, null);\n            ",
    );
    return source;
  });
}

async function patchMoreMenu(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/src/main/java/org/telegram/ui/LoginActivity.java";
  await editFile(root, file, changed, (initial) => {
    let source = addJavaImport(initial, "org.telegram.messenger.server_switch.ServerSwitchDialogs", file);
    source = replaceRegexOnce(
      source,
      /(public\s+class\s+LoginActivity\b[^\{]*\{)/,
      "$1\n    private static final int SERVER_SWITCH_MENU_ID = 0x5357;",
      "SERVER_SWITCH_MENU_ID = 0x5357",
      file,
      "declare a collision-resistant server menu id",
    );
    source = replaceRegexOnce(
      source,
      /^(\s*)(?=moreButtonView\.setDelegate\s*\(\s*id\s*->\s*\{)/m,
      "$1moreButtonView.addSubItem(SERVER_SWITCH_MENU_ID, LocaleController.getString(R.string.ServerSwitchTitle));\n$1",
      "addSubItem(SERVER_SWITCH_MENU_ID",
      file,
      "add server selector to the login overflow menu",
    );
    source = editDeclarationBody(
      source,
      /moreButtonView\.setDelegate\s*\(\s*id\s*->\s*\{/,
      file,
      "login overflow delegate",
      (body) => {
        if (body.includes("id == SERVER_SWITCH_MENU_ID")) return body;
        return replaceRegexOnce(
          body,
          /if\s*\(id\s*==\s*0\)\s*\{/,
          "if (id == SERVER_SWITCH_MENU_ID) {\n                ServerSwitchDialogs.showSelector(this, currentAccount, null);\n            } else if (id == 0) {",
          "id == SERVER_SWITCH_MENU_ID",
          file,
          "handle the server selector menu item",
        );
      },
    );
    return source;
  });
}

async function patchStandaloneButton(root: string, changed: string[]): Promise<void> {
  const file = "TMessagesProj/src/main/java/org/telegram/ui/LoginActivity.java";
  const button = await template("java-snippets/standalone-login-button.java");
  await editFile(root, file, changed, (initial) => {
    let source = addJavaImport(initial, "org.telegram.messenger.server_switch.ServerSwitchDialogs", file);
    source = editDeclarationBody(
      source,
      /public\s+View\s+createView\s*\(\s*Context\s+context\s*\)/,
      file,
      "LoginActivity.createView",
      (body) => replaceRegexOnce(
        body,
        /(^\s*fragmentView\s*=\s*sizeNotifierFrameLayout;\s*$)/m,
        `$1\n\n${button.trimEnd()}`,
        "TextView serverSwitchButton",
        file,
        "add the official client's login-page server button",
      ),
    );
    return source;
  });
}

export async function applyServerSwitch(root: string, upstream: Upstream): Promise<PatchResult> {
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

  if (upstream.loginUi === "nagram-menu") await patchNagramMenu(root, changedFiles);
  else if (upstream.loginUi === "more-menu") await patchMoreMenu(root, changedFiles);
  else await patchStandaloneButton(root, changedFiles);

  return { changedFiles };
}
