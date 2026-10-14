import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const helper = "features/server-switch/files/java/org/telegram/messenger/server_switch/ServerSwitchDialogs.java";

let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "crossgram-server-switch-java-"));
  await cp("tests/fixtures/server-switch-java/src", path.join(directory, "src"), { recursive: true });
  await cp(helper, path.join(directory, "src/org/telegram/messenger/server_switch/ServerSwitchDialogs.java"));
  const sources = await collectSources(path.join(directory, "src"));
  // Compiling here also type-checks the injected dialog against the client API it calls.
  await exec("javac", ["-encoding", "UTF-8", "-d", path.join(directory, "out"), ...sources]);
}, 180_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function collectSources(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectSources(full));
    else if (entry.name.endsWith(".java")) files.push(full);
  }
  return files;
}

/**
 * The harness prints one report line and throws when a dialog dies, so a regression to a
 * shared string resource (the crash this covers) fails the suite instead of printing.
 */
async function runHarness(): Promise<string> {
  const { stdout } = await exec("java", [
    "-Dfile.encoding=UTF-8",
    "-cp", path.join(directory, "out"),
    "Harness",
  ], { maxBuffer: 1024 * 1024 });
  return stdout;
}

describe("Android server switch dialogs against a shrunken resource table", () => {
  it("opens the server list although the shared strings are gone", async () => {
    const report = await runHarness();

    // The release table cannot resolve Cancel/OK any more ...
    expect(report).toContain("shared-cancel=missing;");
    expect(report).toContain("shared-ok=missing;");
    // ... yet the list still shows up, using this feature's own strings.
    expect(report).toContain("shown=true;");
    expect(report).toContain("title=Server;");
    expect(report).toContain("negative=Cancel;");
    expect(report).toContain("items=Official configuration|\u2713 CrossGram-Shanghai|Add configuration;");
    expect(report).toContain("shared-ids-requested=false;");
  });

  it("uses only its own strings for the paste dialog and reports invalid input", async () => {
    const report = await runHarness();

    expect(report).toContain("add-title=Add server configuration;");
    expect(report).toContain("add-ok=OK;");
    expect(report).toContain("add-clipboard=Read clipboard;");
    expect(report).toContain("add-cancel=Cancel;");
    expect(report).toContain("add-hint=Paste the server configuration JSON here;");
    expect(report).toContain("add-error=no configuration was provided;");
    expect(report).toContain("add-shared-ids-requested=false;");
    expect(report).toContain("official-selected=true;");
  });

  it("degrades to built-in wording instead of crashing when its own strings are missing too", async () => {
    const report = await runHarness();

    expect(report).toContain("fallback-shown=true;");
    expect(report).toContain("fallback-title=Server;");
    expect(report).toContain("fallback-negative=Cancel;");
    // The earlier "official configuration" click left that entry selected, so it keeps its mark.
    expect(report).toContain("fallback-items=\u2713 Official configuration|CrossGram-Shanghai|Add configuration;");
  });
});
