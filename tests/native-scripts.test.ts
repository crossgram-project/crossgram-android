import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const ciScript = new URL("../scripts/ci/build-upstream.sh", import.meta.url);
const releaseWorkflow = new URL("../.github/workflows/release.yml", import.meta.url);

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
    expect(source).toContain('node scripts/ci/api-identity.mjs "$CLIENT" "$SOURCE_ROOT"');
    expect(source).toContain('EXTRA_GRADLE_ARGS+=("-PMG_BUILD_TAG=$VERSION")');
    expect(source).toContain('EXTRA_GRADLE_ARGS+=("--no-parallel")');
    expect(source).toContain("GRADLE_MAX_WORKERS=1");
    expect(source).toContain('--max-workers="$GRADLE_MAX_WORKERS"');
    expect(source).toContain('ORG_GRADLE_PROJECT_RELEASE_KEYSTORE_FILE');
    expect(source).toContain('NATIVE_DEPS_NDK_DIR');
  });
});
