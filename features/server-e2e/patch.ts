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
  const helperNames = [
    "runCrossgramE2eHistory",
    "runCrossgramE2eWithMessage",
    "runCrossgramE2eDownload",
    "runCrossgramE2eSearch",
  ];
  const helperOffsets = helperNames.map((name) => method.indexOf(`    private boolean ${name}(`));
  if (helperOffsets.some((offset) => offset < 0)) {
    throw new Error("server E2E launch template is missing a helper declaration");
  }
  const helperBlocks = helperNames.map((name, index) => ({
    name,
    marker: `private boolean ${name}(`,
    source: method.slice(helperOffsets[index], helperOffsets[index + 1] ?? method.length).trimEnd(),
  }));
  let templateBody = "";
  editDeclarationBody(
    method,
    /private\s+boolean\s+handleCrossgramE2eIntent\s*\(/,
    "launch-method.java",
    "handleCrossgramE2eIntent template",
    (body) => {
      templateBody = body;
      return body;
    },
  );
  let source = initial;
  if (source.includes("boolean handleCrossgramE2eIntent(Intent intent)")) {
    source = editDeclarationBody(
      source,
      /private\s+boolean\s+handleCrossgramE2eIntent\s*\(/,
      file,
      "LaunchActivity.handleCrossgramE2eIntent",
      () => templateBody,
    );
  } else {
    source = replaceRegexOnce(
      source,
      /(?=^[ \t]*private\s+boolean\s+handleIntent\(Intent intent, boolean isNew, boolean restore, boolean fromPassword\)\s*\{)/m,
      `\n${method.trimEnd()}\n\n`,
      "boolean handleCrossgramE2eIntent(Intent intent)",
      file,
      "add direct page and function dispatcher",
    );
  }
  for (const helper of helperBlocks) {
    if (!source.includes(helper.marker)) {
      source = replaceRegexOnce(
        source,
        /(?=^[ \t]*private\s+boolean\s+handleIntent\(Intent intent, boolean isNew, boolean restore, boolean fromPassword\)\s*\{)/m,
        `\n${helper.source}\n\n`,
        helper.marker,
        file,
        `add direct ${helper.name} helper`,
      );
      continue;
    }
    let helperBody = "";
    editDeclarationBody(
      helper.source,
      new RegExp(`private\\s+boolean\\s+${helper.name}\\s*\\(`),
      "launch-method.java",
      `${helper.name} template`,
      (body) => {
        helperBody = body;
        return body;
      },
    );
    source = editDeclarationBody(
      source,
      new RegExp(`private\\s+boolean\\s+${helper.name}\\s*\\(`),
      file,
      `LaunchActivity.${helper.name}`,
      () => helperBody,
    );
  }
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

export function patchDirectDownloadE2eSource(initial: string, file: string): string {
  let source = replaceRegexOnce(
    initial,
    /(^[ \t]*private static final ConcurrentHashMap<Integer, HttpURLConnection\[\]> HTTP_REQUESTS = new ConcurrentHashMap<>\(\);[ \t]*$)/m,
    `$1
    private static volatile boolean crossgramE2eForceHttpFailure;`,
    "crossgramE2eForceHttpFailure",
    file,
    "add the debug-only direct HTTP failure hook",
  );
  source = replaceRegexOnce(
    source,
    /(?=^[ \t]*private CrossgramDirectDownload\(\) \{\}[ \t]*$)/m,
    `    public static void setCrossgramE2eForceHttpFailure(boolean value) {
        if (!org.telegram.messenger.BuildConfig.DEBUG) {
            throw new IllegalStateException("E2E hook requires a debug build");
        }
        crossgramE2eForceHttpFailure = value;
    }

`,
    "setCrossgramE2eForceHttpFailure(boolean value)",
    file,
    "expose the debug-only direct HTTP failure hook",
  );
  source = replaceRegexOnce(
    source,
    /^([ \t]*)callback\.onResult\(new ResolvedUrl\(url, expiresAt\), null\);[ \t]*$/m,
    `$1if (crossgramE2eForceHttpFailure) {
$1    url = "http://127.0.0.1:1/crossgram-e2e-force-failure";
$1}
$1callback.onResult(new ResolvedUrl(url, expiresAt), null);`,
    "crossgram-e2e-force-failure",
    file,
    "redirect the next debug direct HTTP attempt to a closed port",
  );
  return source;
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
    "TMessagesProj/src/main/java/org/telegram/messenger/crossgram_direct/CrossgramDirectDownload.java",
    changedFiles,
    (source) => patchDirectDownloadE2eSource(source, "CrossgramDirectDownload.java"),
  );
  await editFile(
    root,
    "TMessagesProj/jni/jni.c",
    changedFiles,
    (source) => patchNativeE2eSource(source, "jni.c"),
  );
  return { changedFiles };
}
