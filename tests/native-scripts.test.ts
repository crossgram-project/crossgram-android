import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const ffmpegScript = new URL("../scripts/native/build-ffmpeg-clang.sh", import.meta.url);

describe("native dependency scripts", () => {
  it("uses FFmpeg 7 component names and keeps x86_64 codelets enabled", async () => {
    const source = await readFile(ffmpegScript, "utf8");
    const x86_64Case = source.match(/x86_64\)([\s\S]*?)\n\s*;;/)?.[1];

    expect(source).toContain("--enable-decoder=hevc");
    expect(source).not.toContain("--enable-decoder=h265");
    expect(x86_64Case).toContain("--enable-x86asm");
    expect(x86_64Case).not.toContain("--disable-asm");
  });
});
