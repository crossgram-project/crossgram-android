import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { editDeclarationBody, replaceRegexOnce } from "../../src/core/text-edit.js";

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

async function installFile(root: string, target: string, source: string, changed: string[]): Promise<void> {
  if (await writeUtf8IfChanged(path.join(root, target), await template(source))) changed.push(target);
}

export function patchLoginE2eSource(initial: string, file: string, methods: string): string {
  let source = replaceRegexOnce(
    initial,
    /(?=^[ \t]*@Override\r?$\r?\n^[ \t]*public\s+void\s+saveSelfArgs\(Bundle outState\))/m,
    `${methods.trimEnd()}\n\n`,
    "void runCrossgramE2eLogin(String phone, String code)",
    file,
    "add direct login page driver",
  );
  source = editDeclarationBody(
    source,
    /public\s+void\s+setPage\s*\(/,
    file,
    "LoginActivity.setPage",
    (body) => {
      if (body.includes("maybeRunCrossgramE2eCode(page);")) return body;
      return `${body.trimEnd()}\n        maybeRunCrossgramE2eCode(page);\n    `;
    },
  );
  return source;
}

export function patchLaunchE2eSource(initial: string, file: string, method: string): string {
  const historyBranch = method.match(
    /        if \("history"\.equals\(command\)\) \{[\s\S]*?(?=        if \("send"\.equals\(command\)\) \{)/,
  )?.[0];
  if (!historyBranch) throw new Error("server E2E launch template has no history branch");
  let source = replaceRegexOnce(
    initial,
    /(?=^[ \t]*private\s+boolean\s+handleIntent\(Intent intent, boolean isNew, boolean restore, boolean fromPassword\)\s*\{)/m,
    `\n${method.trimEnd()}\n\n`,
    "boolean handleCrossgramE2eIntent(Intent intent)",
    file,
    "add direct page and function dispatcher",
  );
  source = replaceRegexOnce(
    source,
    /[ \t]*String message = intent\.getStringExtra\("crossgram_e2e_message"\);/,
    `            String encodedMessage = intent.getStringExtra("crossgram_e2e_message_base64");\n            String message = encodedMessage == null\n                    ? intent.getStringExtra("crossgram_e2e_message")\n                    : new String(android.util.Base64.decode(encodedMessage, android.util.Base64.DEFAULT),\n                            java.nio.charset.StandardCharsets.UTF_8);`,
    "crossgram_e2e_message_base64",
    file,
    "encode adb text message extras safely",
  );
  source = replaceRegexOnce(
    source,
    /(?=        if \("send"\.equals\(command\)\) \{)/,
    `${historyBranch}\n`,
    "history_loaded source=",
    file,
    "add direct history loading probe",
  );
  source = editDeclarationBody(
    source,
    /private\s+boolean\s+handleIntent\(Intent intent, boolean isNew, boolean restore, boolean fromPassword, Browser\.Progress progress, boolean rebuildFragments, boolean openedTelegram\)\s*\{/,
    file,
    "LaunchActivity.handleIntent",
    (body) => body.includes("handleCrossgramE2eIntent(intent)")
      ? body
      : `\n        if (handleCrossgramE2eIntent(intent)) {\n            return true;\n        }${body}`,
  );
  return source;
}

export function patchNativeE2eSource(initial: string, file: string): string {
  const marker = "/* CROSSGRAM E2E: accept the ephemeral debug signing certificate. */";
  if (initial.includes(marker)) return initial;
  return replaceRegexOnce(
    initial,
    /[ \t]*if \(verifySign\(env\) != JNI_OK\) \{\r?\n[ \t]*return JNI_ERR;\r?\n[ \t]*\}/,
    `\n    ${marker}`,
    marker,
    file,
    "allow the dedicated debug E2E APK signing certificate",
  );
}

export async function applyServerE2e(root: string): Promise<PatchResult> {
  const changedFiles: string[] = [];
  await installFile(
    root,
    "TMessagesProj/src/main/java/org/telegram/ui/CrossgramE2eActivity.java",
    "java/org/telegram/ui/CrossgramE2eActivity.java",
    changedFiles,
  );
  await installFile(
    root,
    "TMessagesProj/src/debug/AndroidManifest.xml",
    "debug/AndroidManifest.xml",
    changedFiles,
  );
  await editFile(
    root,
    "TMessagesProj/src/main/java/org/telegram/ui/LoginActivity.java",
    changedFiles,
    async (source) => patchLoginE2eSource(source, "LoginActivity.java", await template("java-snippets/login-methods.java")),
  );
  await editFile(
    root,
    "TMessagesProj/src/main/java/org/telegram/ui/LaunchActivity.java",
    changedFiles,
    async (source) => patchLaunchE2eSource(source, "LaunchActivity.java", await template("java-snippets/launch-method.java")),
  );
  await editFile(
    root,
    "TMessagesProj/jni/jni.c",
    changedFiles,
    (source) => patchNativeE2eSource(source, "jni.c"),
  );
  return { changedFiles };
}
