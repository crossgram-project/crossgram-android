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
});
