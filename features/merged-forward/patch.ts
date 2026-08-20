import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { addJavaImport, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const browserFile = "TMessagesProj/src/main/java/org/telegram/messenger/browser/Browser.java";

export function patchBrowser(initial: string): string {
  let source = addJavaImport(
    initial,
    "org.telegram.messenger.crossgram_merged.CrossgramMergedForward",
    browserFile,
  );
  source = replaceRegexOnce(
    source,
    /(^[ \t]*if \(context == null \|\| uri == null\) \{\r?\n[ \t]*return;\r?\n[ \t]*\}[ \t]*$)/m,
    `$1
        if (CrossgramMergedForward.openUrl(context, uri)) {
            return;
        }`,
    "CrossgramMergedForward.openUrl(context, uri)",
    browserFile,
    "open synthetic merged-forward chats before generic t.me routing",
  );
  return source;
}

export async function applyMergedForward(root: string, _upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  const runtimeRelative = "org/telegram/messenger/crossgram_merged/CrossgramMergedForward.java";
  const runtimeSource = await readUtf8(path.join(featureRoot, "files", "java", runtimeRelative));
  const runtimeTarget = path.join(root, "TMessagesProj/src/main/java", runtimeRelative);
  if (await writeUtf8IfChanged(runtimeTarget, runtimeSource)) {
    changedFiles.push(path.relative(root, runtimeTarget));
  }

  const browserTarget = path.join(root, browserFile);
  if (await writeUtf8IfChanged(browserTarget, patchBrowser(await readUtf8(browserTarget)))) {
    changedFiles.push(browserFile);
  }
  return changedFiles;
}
