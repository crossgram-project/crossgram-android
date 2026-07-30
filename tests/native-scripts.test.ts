import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const ciScript = new URL("../scripts/ci/build-upstream.sh", import.meta.url);

describe("build scripts", () => {
  it("writes portable artifact checksums", async () => {
    const source = await readFile(ciScript, "utf8");

    expect(source).toContain('cd "$OUTPUT_ROOT"');
    expect(source).toContain('sha256sum ./*.apk > "SHA256SUMS-${CLIENT}-${VARIANT}.txt"');
    expect(source).not.toContain('sha256sum "$OUTPUT_ROOT"/*.apk');
  });

  it("prepares Mercurygram and Forkgram's extra build inputs", async () => {
    const source = await readFile(ciScript, "utf8");

    expect(source).toContain('mercurygram)');
    expect(source).toContain('> "$SOURCE_ROOT/API_KEYS"');
    expect(source).toContain('EXTRA_GRADLE_ARGS+=("-PMG_BUILD_TAG=$VERSION")');
    expect(source).toContain('forkgram)');
    expect(source).toContain('ORG_GRADLE_PROJECT_APP_ID');
    expect(source).toContain('ORG_GRADLE_PROJECT_RELEASE_KEYSTORE_FILE');
    expect(source).toContain('NATIVE_DEPS_NDK_DIR');
  });
});
