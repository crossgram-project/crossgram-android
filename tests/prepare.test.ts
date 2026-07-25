import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { prepareBuild } from "../src/build/prepare.js";
import { getUpstream } from "../src/upstreams.js";

async function fixture(relative: string, content: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-prepare-"));
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return root;
}

describe("prepareBuild", () => {
  it("replaces an existing Groovy ABI override when the variant changes", async () => {
    const relative = "TMessagesProj/build.gradle";
    const root = await fixture(relative, "plugins { id 'com.android.application' }\nandroid {}\n");
    await mkdir(path.join(root, "TMessagesProj_App"), { recursive: true });
    await writeFile(
      path.join(root, "TMessagesProj_App/build.gradle"),
      "plugins { id 'com.android.application' }\nandroid {}\n",
      "utf8",
    );
    await mkdir(path.join(root, "gradle/wrapper"), { recursive: true });
    await writeFile(
      path.join(root, "gradle/wrapper/gradle-wrapper.properties"),
      "distributionUrl=https\\://services.gradle.org/distributions/gradle-7.0.2-all.zip\n",
      "utf8",
    );
    await prepareBuild(root, getUpstream("telegram"), "arm64");
    const changed = await prepareBuild(root, getUpstream("telegram"), "universal");
    const source = await readFile(path.join(root, relative), "utf8");

    expect(changed).toContain(relative);
    expect(source).toContain("'x86', 'x86_64'");
    expect(source).toContain("productFlavors.configureEach");
    expect(source.match(/CROSSGRAM ABI OVERRIDE BEGIN/g)).toHaveLength(1);
    expect(await readFile(path.join(root, "gradle/wrapper/gradle-wrapper.properties"), "utf8"))
      .toContain("gradle-8.7-bin.zip");
    expect(await prepareBuild(root, getUpstream("telegram"), "universal")).toEqual([]);
  });

  it("writes valid Kotlin DSL syntax for a single ABI", async () => {
    const relative = "TMessagesProj/build.gradle.kts";
    const root = await fixture(relative, "plugins { alias(libs.plugins.android.application) }\nandroid {}\n");
    await prepareBuild(root, getUpstream("nnngram"), "x86_64");
    const source = await readFile(path.join(root, relative), "utf8");

    expect(source).toContain('abiFilters.addAll(setOf("x86_64"))');
    expect(source).toContain("productFlavors.configureEach");
    expect(source).toContain("isEnable = false");
  });

  it("makes Nagram native dependency scripts targetable and NDK-compatible on x86", async () => {
    const relative = "TMessagesProj/build.gradle";
    const root = await fixture(relative, "plugins { id 'com.android.application' }\nandroid {}\n");
    const nativeFiles: Record<string, string> = {
      "TMessagesProj/jni/build_boringssl.sh": "build arm64 arm\n",
      "TMessagesProj/jni/build_ffmpeg_clang.sh": "build arm64 arm\n",
      "TMessagesProj/jni/build_libvpx_clang.sh": [
        'OPTIMIZE_CFLAGS="-O3 -march=x86-64 -mtune=intel -msse4.2 -mpopcnt -m64 -fPIC"',
        'OPTIMIZE_CFLAGS="-O3 -march=i686 -mtune=intel -msse3 -mfpmath=sse -m32 -fPIC"',
        "build arm64 arm",
        "",
      ].join("\n"),
    };
    for (const [nativeRelative, content] of Object.entries(nativeFiles)) {
      const file = path.join(root, nativeRelative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, "utf8");
    }

    await prepareBuild(root, getUpstream("nagram"), "x86_64");
    const libvpx = await readFile(path.join(root, "TMessagesProj/jni/build_libvpx_clang.sh"), "utf8");
    expect(libvpx).toContain("build ${CROSSGRAM_NATIVE_TARGETS:-arm64 arm}");
    expect(libvpx).toContain("CROSSGRAM NDK-compatible x86_64 flags");
    expect(libvpx).toContain("CROSSGRAM NDK-compatible x86 flags");
    expect(await prepareBuild(root, getUpstream("nagram"), "x86_64")).toEqual([]);
  });
});
