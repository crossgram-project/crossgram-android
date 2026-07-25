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
    await prepareBuild(root, getUpstream("telegram"), "arm64");
    const changed = await prepareBuild(root, getUpstream("telegram"), "universal");
    const source = await readFile(path.join(root, relative), "utf8");

    expect(changed).toContain(relative);
    expect(source).toContain("'x86', 'x86_64'");
    expect(source).toContain("productFlavors.configureEach");
    expect(source.match(/CROSSGRAM ABI OVERRIDE BEGIN/g)).toHaveLength(1);
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
});
