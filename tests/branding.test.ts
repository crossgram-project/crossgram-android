import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyBrand, getBrand } from "../src/branding.js";
import { getUpstream } from "../src/upstreams.js";

async function createApp(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-brand-"));
  const files: Record<string, string> = {
    "TMessagesProj/build.gradle": "plugins { id 'com.android.application' }\nandroid {}\ndefaultConfig.applicationId = \"xyz.nextalone.nagram\"\n",
    "TMessagesProj/google-services.json": JSON.stringify({
      project_info: { project_number: "1" },
      client: [{ client_info: { mobilesdk_app_id: "app", android_client_info: { package_name: "xyz.nextalone.nagram" } } }],
    }),
    "TMessagesProj/src/main/AndroidManifest.xml": [
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
      '  <application android:label="Telegram" android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" />',
      "</manifest>",
      "",
    ].join("\n"),
  };
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }
  return root;
}

describe("applyBrand", () => {
  it("switches titles, package suffixes and the downloaded official icon in place", async () => {
    const root = await createApp();
    await applyBrand(root, getUpstream("nagram"), getBrand("qq"));
    await applyBrand(root, getUpstream("nagram"), getBrand("wechat"));

    const gradle = await readFile(path.join(root, "TMessagesProj/build.gradle"), "utf8");
    const manifest = await readFile(path.join(root, "TMessagesProj/src/main/AndroidManifest.xml"), "utf8");
    const title = await readFile(path.join(root, "TMessagesProj/src/main/res/values/crossgram_brand.xml"), "utf8");
    const storedIcon = await readFile(path.join(root, "TMessagesProj/src/main/res/mipmap-xxxhdpi/crossgram_launcher.jpg"));
    const googleServices = await readFile(path.join(root, "TMessagesProj/google-services.json"), "utf8");

    expect(gradle).toContain('applicationIdSuffix ".crossgram.wechat"');
    expect(gradle).not.toContain(".crossgram.qq");
    expect(gradle.match(/CROSSGRAM BRAND OVERRIDE BEGIN/g)).toHaveLength(1);
    expect(manifest).toContain('android:label="@string/CrossgramAppName"');
    expect(manifest.match(/@mipmap\/crossgram_launcher/g)).toHaveLength(2);
    expect(title).toContain("微信 · Cross");
    expect(storedIcon.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(googleServices).toContain('"package_name": "xyz.nextalone.nagram.crossgram.wechat"');
    expect(googleServices).not.toContain("crossgram.qq");
  });

  it("creates a local Firebase placeholder and disables private uploads when config is unpublished", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "crossgram-brand-private-firebase-"));
    const files: Record<string, string> = {
      "TMessagesProj/build.gradle.kts": [
        "plugins {",
        "    alias(libs.plugins.android.application)",
        "    alias(libs.plugins.firebase.crashlytics)",
        "    alias(libs.plugins.google.services)",
        "}",
        'android { defaultConfig.applicationId = "xyz.nextalone.nnngram" }',
        "the<CrashlyticsExtension>().nativeSymbolUploadEnabled = true",
        "",
      ].join("\n"),
      "TMessagesProj/src/main/AndroidManifest.xml": [
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        '  <application android:label="Nnngram" android:icon="@mipmap/ic_launcher" />',
        "</manifest>",
        "",
      ].join("\n"),
    };
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(root, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, "utf8");
    }

    await applyBrand(root, getUpstream("nnngram"), getBrand("qq"));
    const gradle = await readFile(path.join(root, "TMessagesProj/build.gradle.kts"), "utf8");
    const googleServices = await readFile(path.join(root, "TMessagesProj/google-services.json"), "utf8");
    expect(gradle).toContain("CROSSGRAM: private Crashlytics uploads disabled");
    expect(gradle).toContain("CROSSGRAM: private Crashlytics mapping upload disabled");
    expect(gradle).toMatch(/^\s*alias\(libs\.plugins\.google\.services\)/m);
    expect(googleServices).toContain('"package_name": "xyz.nextalone.nnngram.crossgram.qq"');
    await applyBrand(root, getUpstream("nnngram"), getBrand("wechat"));
    expect(await readFile(path.join(root, "TMessagesProj/google-services.json"), "utf8"))
      .toContain('"package_name": "xyz.nextalone.nnngram.crossgram.wechat"');
  });
});
