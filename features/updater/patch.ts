import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { PatchError, addJavaImport, editDeclarationBody } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const javaRoot = "TMessagesProj/src/main/java";
const helperPackage = "org/telegram/messenger/crossgram_update/CrossgramUpdate.java";
const helperRelative = javaRoot + "/" + helperPackage;
const launchActivityRelative = javaRoot + "/org/telegram/ui/LaunchActivity.java";
const helperImport = "org.telegram.messenger.crossgram_update.CrossgramUpdate";
const helperCall = "CrossgramUpdate.check(";

/**
 * The checkAppUpdate() overloads of the supported forks. Every fork exposes at
 * least one of them, and only the bodies change: the upstream call sites
 * (application start, resume, the settings and debug entries) keep working.
 */
export const updaterOverloads = [
  {
    label: "checkAppUpdate(boolean, Browser.Progress, boolean)",
    pattern: /public\s+void\s+checkAppUpdate\s*\(\s*boolean\s+force\s*,\s*Browser\.Progress\s+progress\s*,\s*boolean\s+updateAlways\s*\)/,
    withProgress: true,
  },
  {
    label: "checkAppUpdate(boolean, Browser.Progress, int)",
    pattern: /public\s+void\s+checkAppUpdate\s*\(\s*boolean\s+force\s*,\s*Browser\.Progress\s+progress\s*,\s*int\s+\w+\s*\)/,
    withProgress: true,
  },
  {
    label: "checkAppUpdate(boolean, Browser.Progress)",
    pattern: /public\s+void\s+checkAppUpdate\s*\(\s*boolean\s+force\s*,\s*Browser\.Progress\s+progress\s*\)/,
    withProgress: true,
  },
  {
    label: "checkAppUpdate(boolean)",
    pattern: /public\s+void\s+checkAppUpdate\s*\(\s*boolean\s+force\s*\)/,
    withProgress: false,
  },
] as const;

/** The Crossgram check, in the shape of the overload that is being replaced. */
function replacementBody(overload: { readonly withProgress: boolean }): string {
  if (!overload.withProgress) {
    return "\n        CrossgramUpdate.check(this, force, null);\n    ";
  }
  return [
    "",
    "        if (progress != null) {",
    "            progress.init();",
    "        }",
    "        CrossgramUpdate.check(this, force, () -> {",
    "            if (progress != null) {",
    "                progress.end();",
    "            }",
    "        });",
    "    ",
  ].join("\n");
}

function countMatches(source: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  return [...source.matchAll(new RegExp(pattern.source, flags))].length;
}

/**
 * Route every upstream update check through the Crossgram release manifest.
 * Idempotent: a body that already calls the helper is left alone.
 */
export function patchUpdaterLaunchActivity(initial: string, file = launchActivityRelative): string {
  let source = addJavaImport(initial, helperImport, file);
  let replaced = 0;
  for (const overload of updaterOverloads) {
    if (countMatches(source, overload.pattern) === 0) continue;
    source = editDeclarationBody(
      source,
      overload.pattern,
      file,
      "patch " + overload.label,
      (current) => (current.includes(helperCall) ? current : replacementBody(overload)),
    );
    replaced += 1;
  }
  if (replaced === 0 && !source.includes(helperCall)) {
    throw new PatchError(file, "could not find a checkAppUpdate overload to route to Crossgram");
  }
  return source;
}

/** Install the helper, with the upstream identity baked into it. */
async function installUpdaterHelper(
  root: string,
  upstream: Upstream,
  changedFiles: string[],
): Promise<void> {
  const source = await readUtf8(path.join(featureRoot, "files/java", helperPackage));
  const target = path.join(root, helperRelative);
  if (!/private static final String CLIENT = "[^"]*";/.test(source)) {
    throw new PatchError(helperRelative, "could not find the upstream client id placeholder");
  }
  const branded = source.replace(
    /private static final String CLIENT = "[^"]*";/,
    `private static final String CLIENT = "${upstream.id}";`,
  );
  if (await writeUtf8IfChanged(target, branded)) changedFiles.push(helperRelative);
}

export async function applyUpdater(root: string, upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  await installUpdaterHelper(root, upstream, changedFiles);
  const launchActivityTarget = path.join(root, launchActivityRelative);
  try {
    await access(launchActivityTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return changedFiles;
  }
  const source = await readUtf8(launchActivityTarget);
  const patched = patchUpdaterLaunchActivity(source, launchActivityRelative);
  if (await writeUtf8IfChanged(launchActivityTarget, patched)) changedFiles.push(launchActivityRelative);
  return changedFiles;
}
