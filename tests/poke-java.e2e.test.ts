import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const helper = "features/poke/files/java/org/telegram/messenger/crossgram_poke/CrossgramPoke.java";
/** Constructor ids the relay answers, as signed Java ints. */
const GET_FEATURES_CONSTRUCTOR = 0xc3e6b915 | 0;
const SEND_POKE_CONSTRUCTOR = 0x9a2d47f0 | 0;
/** 戳一戳 / 1 次 built from escapes so this file stays readable. */
const POKE_LABEL = "\u6233\u4e00\u6233";
const count = (value: number) => `${value} \u6b21`;

let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "crossgram-poke-java-"));
  await cp("tests/fixtures/poke-java/src", path.join(directory, "src"), { recursive: true });
  await mkdir(path.join(directory, "src/org/telegram/messenger/crossgram_poke"), { recursive: true });
  await cp(helper, path.join(directory, "src/org/telegram/messenger/crossgram_poke/CrossgramPoke.java"));
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

describe("Android poke helper e2e", () => {
  it("queries features once, shows the rows, and serializes the poke bursts", async () => {
    const { stdout } = await exec("java", [
      "-Dfile.encoding=UTF-8",
      "-cp", path.join(directory, "out"),
      "Harness",
    ], { maxBuffer: 1024 * 1024 });
    // Only the harness report is compared; the helper also logs through FileLog.
    const report = stdout.split("\n").find((line) => line.startsWith("rows-before=")) ?? stdout;

    expect(report).toContain("rows-before=[];");
    expect(report).toContain("supported-before=false;");
    // crossgram.getFeatures#c3e6b915 peer:InputPeer
    expect(report).toContain(`features-request=int:${GET_FEATURES_CONSTRUCTOR},peer:dialog-42;`);
    expect(report).toContain("supported-after=true;");
    expect(report).toContain(`rows-after=[${POKE_LABEL}];`);
    // crossgram.sendPoke#9a2d47f0 peer:InputPeer user_id:InputUser count:int
    expect(report).toContain(
      `poke-request=int:${SEND_POKE_CONSTRUCTOR},peer:dialog-42,user:user-7,int:1;`,
    );
    expect(report).toContain(
      `rows-expanded=[${POKE_LABEL}|${count(1)}|${count(5)}|${count(10)}];`,
    );
    expect(report).toContain(
      `burst-request=int:${SEND_POKE_CONSTRUCTOR},peer:dialog-42,user:user-7,int:5;`,
    );
    expect(report).toContain(`options=[${POKE_LABEL}];`);
    // The rejected account keeps the row hidden even after another menu is built.
    expect(report).toContain("rows-rejected=[];");
  }, 120_000);
});
