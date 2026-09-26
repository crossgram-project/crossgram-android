import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const reactionsHelper =
  "features/reactions/files/java/org/telegram/messenger/crossgram_reactions/CrossgramReactions.java";
/** crossgram.getFeatures#c3e6b915, as signed Java ints. */
const GET_FEATURES_CONSTRUCTOR = 0xc3e6b915 | 0;

let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "crossgram-reactions-java-"));
  // The poke fixtures already provide the Android and org.json stubs both
  // helpers need, so this harness only adds the reaction helper next to them.
  await cp("tests/fixtures/poke-java/src", path.join(directory, "src"), { recursive: true });
  await cp(
    "features/poke/files/java/org/telegram/messenger/crossgram_poke/CrossgramPoke.java",
    path.join(directory, "src/org/telegram/messenger/crossgram_poke/CrossgramPoke.java"),
  );
  await mkdir(path.join(directory, "src/org/telegram/messenger/crossgram_reactions"), { recursive: true });
  await cp(reactionsHelper, path.join(directory, "src/org/telegram/messenger/crossgram_reactions/CrossgramReactions.java"));
  await cp("tests/fixtures/reactions-java/src/ReactionsHarness.java", path.join(directory, "src/ReactionsHarness.java"));
  const sources = await collectSources(path.join(directory, "src"));
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

describe("Android reaction support helper e2e", () => {
  it("asks once per conversation and keeps official servers unchanged", async () => {
    const { stdout } = await exec("java", [
      "-Dfile.encoding=UTF-8",
      "-cp", path.join(directory, "out"),
      "ReactionsHarness",
    ], { maxBuffer: 1024 * 1024 });
    const report = stdout.split("\n").find((line) => line.startsWith("unknown-allowed=")) ?? stdout;

    // Unknown keeps the client's own rules, but the query is already in flight.
    expect(report).toContain("unknown-allowed=true;");
    expect(report).toContain(`features-request=int:${GET_FEATURES_CONSTRUCTOR},peer:dialog-42;`);
    // Only the refused conversation loses the entry.
    expect(report).toContain("refused-allowed=false;");
    expect(report).toContain("sibling-allowed=true;");
    expect(report).toContain("sibling-allowed-after=true;");
    // A relay without the method keeps private-chat reactions and is not asked again.
    expect(report).toContain("official-allowed=true;");
    expect(report).toContain("official-allowed-after=true;");
    expect(report).toContain("requests=3;");
    // Warming sends the same query; the self-chat is never asked about.
    expect(report).toContain("warm-requests=4;");
  }, 120_000);
});
