import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const ciScript = new URL("../scripts/ci/build-upstream.sh", import.meta.url);
const nativeToolsScript = new URL("../scripts/ci/install-native-tools.sh", import.meta.url);
const releaseWorkflow = new URL("../.github/workflows/release.yml", import.meta.url);
const abiHelper = new URL("../scripts/ci/native-abi-list.sh", import.meta.url);

const exec = promisify(execFile);

/** Git Bash and WSL need the POSIX spelling of a Windows path. */
function posixPath(target: string): string {
  return process.platform === "win32"
    ? target.replace(/^([A-Za-z]):\\/, (_, drive: string) => "/" + drive.toLowerCase() + "/").replaceAll("\\", "/")
    : target;
}


describe("build scripts", () => {
  it("writes portable artifact checksums", async () => {
    const source = await readFile(ciScript, "utf8");

    expect(source).toContain('cd "$OUTPUT_ROOT"');
    expect(source).toContain('sha256sum ./*.apk > "SHA256SUMS-${CLIENT}-${VARIANT}.txt"');
    expect(source).not.toContain('sha256sum "$OUTPUT_ROOT"/*.apk');
  });

  it("injects one default API identity while allowing complete secret overrides", async () => {
    const [script, workflow] = await Promise.all([
      readFile(ciScript, "utf8"),
      readFile(releaseWorkflow, "utf8"),
    ]);
    expect(script).toContain('node scripts/ci/api-identity.mjs "$CLIENT" "$SOURCE_ROOT"');
    expect(workflow).toContain("secrets.CROSSGRAM_TELEGRAM_API_ID");
    expect(workflow).toContain("secrets.CROSSGRAM_TELEGRAM_API_HASH");
    expect(workflow).toContain("TDLIB_NDK_VERSION");
    expect(workflow).toContain('packages+=("ndk;$TDLIB_NDK_VERSION")');
    expect(workflow).not.toContain("require CROSSGRAM_TELEGRAM_API_ID");
    expect(script).not.toContain("missing Telegram API ID secret");
  });

  it("prepares Mercurygram and Forkgram's extra build inputs", async () => {
    const source = await readFile(ciScript, "utf8");

    expect(source).toContain('mercurygram)');
    expect(source).toContain("TMessagesProj/jni/third_party/libvpx");
    expect(source).toContain("TMessagesProj/jni/third_party/ffmpeg");
    expect(source).toContain("TMessagesProj/jni/third_party/dav1d");
    // Every listed submodule has to live where the fork actually keeps it:
    // upstream moved the native ones under TMessagesProj/jni/third_party.
    expect(source).not.toMatch(
      /^\s+TMessagesProj\/jni\/(?!third_party\/)(?:libvpx|ffmpeg|dav1d|boringssl|openh264|libyuv|tlottie) \\/m,
    );
    expect(source).toContain('node scripts/ci/api-identity.mjs "$CLIENT" "$SOURCE_ROOT"');
    expect(source).toContain('EXTRA_GRADLE_ARGS+=("-PMG_BUILD_TAG=$VERSION")');
    expect(source).toContain('EXTRA_GRADLE_ARGS+=("--no-parallel")');
    expect(source).toContain("GRADLE_MAX_WORKERS=1");
    expect(source).toContain('--max-workers="$GRADLE_MAX_WORKERS"');
    expect(source).toContain('ORG_GRADLE_PROJECT_RELEASE_KEYSTORE_FILE');
    expect(source).toContain('NATIVE_DEPS_NDK_DIR');
  });

  it("bounds and retries flaky apt operations without reinstalling tools for Nagram", async () => {
    const [ci, nativeTools, workflow] = await Promise.all([
      readFile(ciScript, "utf8"),
      readFile(nativeToolsScript, "utf8"),
      readFile(releaseWorkflow, "utf8"),
    ]);

    expect(workflow).toContain("bash scripts/ci/install-native-tools.sh");
    // Forkgram compiles tlottie with Cargo and needs every Android target.
    expect(workflow).toContain("if: matrix.id == 'forkgram'");
    expect(workflow).toContain("rustup target add");
    expect(workflow).toContain("aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android");
    expect(nativeTools).toContain("Acquire::Retries=3");
    expect(nativeTools).toContain('timeout --signal=TERM --kill-after=30s "$limit"');
    expect(nativeTools).toContain("run_apt 5m update");
    expect(nativeTools).toContain("run_apt 15m install -y");
    expect(ci).not.toContain("sudo apt-get");
  });

  it("gives Nagram the native dependency layout and its ABI list", async () => {
    const [ci, e2e, e2eWorkflow] = await Promise.all([
      readFile(ciScript, "utf8"),
      readFile(new URL("../scripts/ci/build-e2e-nagram.sh", import.meta.url), "utf8"),
      readFile(new URL("../.github/workflows/android-server-e2e.yml", import.meta.url), "utf8"),
    ]);

    // Upstream builds libvpx, dav1d and FFmpeg from TMessagesProj/jni/third_party
    // and selects the ABIs through ABIS; the release and the E2E APK both have
    // to run dav1d before FFmpeg packages the shared include tree.
    for (const script of [ci, e2e]) {
      expect(script).toContain("./run init libs libvpx");
      expect(script.indexOf("./run init libs libvpx")).toBeLessThan(script.indexOf("./run init libs dav1d"));
      expect(script.indexOf("./run init libs dav1d")).toBeLessThan(script.indexOf("./run init libs ffmpeg"));
      expect(script.indexOf("./run init libs ffmpeg")).toBeLessThan(script.indexOf("./run init libs boringssl"));
      expect(script).toMatch(/export ABIS=/);
    }
    // Bash cannot export an array, so the list has to cross the process
    // boundary as a scalar that the native scripts inherit.
    expect(ci).toContain('export ABIS="$NATIVE_ABI_LIST"');
    expect(ci).toContain('NATIVE_ABI_LIST=$(native_abi_list "$VARIANT")');
    expect(e2e).toContain('export ABIS="$(native_abi_list x86_64)"');
    expect(ci).not.toMatch(/export ABIS="\$\{ABIS\[/);
    // dav1d is a Meson project and libvpx/FFmpeg need an x86 assembler.
    for (const tool of ["meson", "nasm", "pkg-config"]) {
      expect(e2eWorkflow).toContain(tool);
    }
  });

  it("resolves every variant to an ABI list the native scripts can inherit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "crossgram-abi-list-"));
    try {
      const harness = path.join(directory, "harness.sh");
      await writeFile(
        harness,
        [
          "set -euo pipefail",
          'source "' + posixPath(fileURLToPath(abiHelper)) + '"',
          'ABIS="$(native_abi_list "$1")"',
          "export ABIS",
          'bash -c \'printf "%s\\n" "$ABIS"\'',
          "",
        ].join("\n"),
        "utf8",
      );

      const abiFor = async (variant: string) =>
        (await exec("bash", [posixPath(harness), variant])).stdout.trim();
      expect(await abiFor("arm64")).toBe("arm64-v8a");
      expect(await abiFor("x86_64")).toBe("x86_64");
      expect(await abiFor("armAll")).toBe("armeabi-v7a arm64-v8a");
      expect(await abiFor("universal")).toBe("armeabi-v7a arm64-v8a x86 x86_64");
      await expect(abiFor("mips")).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists a bounded compiler cache for native builds", async () => {
    const workflow = await readFile(releaseWorkflow, "utf8");

    expect(workflow).toContain("uses: actions/cache@v6");
    expect(workflow).toContain("path: .cache/ccache");
    expect(workflow).toContain("CCACHE_MAXSIZE: 500M");
    expect(workflow).toContain("CCACHE_COMPILERCHECK: content");
    expect(workflow).toContain("ccache --zero-stats");
    expect(workflow).toContain("ccache --show-stats --verbose");
    expect(workflow).toContain("matrix.id }}-${{ matrix.variant");
  });
});
