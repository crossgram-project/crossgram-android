import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const script = path.resolve("scripts/ci/release-manifest.py");
const python = process.platform === "win32" ? "python" : "python3";

describe("release update manifest", () => {
  it("records the URLs GitHub actually serves the APKs under", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "crossgram-release-manifest-"));
    try {
      const nagram = "nagram-1248-arm64-qq-Nagram-v12.10.1(1248).apk";
      const forkgram = "forkgram-12.10.6.0-arm64-qq-app.apk";
      await writeFile(path.join(directory, nagram), "nagram-bytes");
      await writeFile(path.join(directory, forkgram), "forkgram-bytes");
      await writeFile(path.join(directory, "SHA256SUMS-nagram-arm64.txt"), `abc  ./${nagram}\n`);
      await writeFile(path.join(directory, "notes.md"), "说明\n");

      await exec(python, [script, directory, "crossgram-project/crossgram-android", "107", path.join(directory, "notes.md")]);

      const files = (await readdir(directory)).sort();
      expect(files).toContain("nagram-1248-arm64-qq-Nagram-v12.10.1.1248.apk");
      expect(files).not.toContain(nagram);
      expect(await readFile(path.join(directory, "SHA256SUMS-nagram-arm64.txt"), "utf8"))
        .toBe("abc  ./nagram-1248-arm64-qq-Nagram-v12.10.1.1248.apk\n");

      const manifest = JSON.parse(await readFile(path.join(directory, "crossgram-update.json"), "utf8"));
      expect(manifest.build).toBe(107);
      expect(manifest.notes).toBe("说明");
      const byClient = Object.fromEntries(manifest.assets.map((asset: { client: string }) => [asset.client, asset]));
      expect(byClient.nagram).toMatchObject({
        version: "1248",
        variant: "arm64",
        brand: "qq",
        url: "https://github.com/crossgram-project/crossgram-android/releases/download/crossgram-107/nagram-1248-arm64-qq-Nagram-v12.10.1.1248.apk",
        size: "nagram-bytes".length,
        sha256: createHash("sha256").update("nagram-bytes").digest("hex"),
      });
      expect(byClient.forkgram.url).toMatch(/\/crossgram-107\/forkgram-12\.10\.6\.0-arm64-qq-app\.apk$/);
      for (const asset of manifest.assets) {
        expect(path.basename(asset.url)).toMatch(/^[A-Za-z0-9._-]+$/);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("is what the release workflow publishes", async () => {
    const workflow = await readFile(".github/workflows/release.yml", "utf8");
    expect(workflow).toContain("python3 scripts/ci/release-manifest.py release-assets");
    // The upload list must be taken after the rename, or it names files that no longer exist.
    expect(workflow.indexOf("release-manifest.py")).toBeLessThan(
      workflow.indexOf("files=(release-assets/*.apk"),
    );
  });
});
