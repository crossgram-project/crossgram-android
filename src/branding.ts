import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { readUtf8, writeBinaryIfChanged, writeUtf8IfChanged } from "./core/files.js";
import { PatchError } from "./core/text-edit.js";
import type { Upstream } from "./upstreams.js";

export type BrandId = "qq" | "wechat" | "wecom" | "dingtalk" | "discord";

export interface Brand {
  id: BrandId;
  title: string;
  storefront: "cn" | "us";
  bundleId: string;
}

export const brands: readonly Brand[] = [
  { id: "qq", title: "QQ · Cross", storefront: "cn", bundleId: "com.tencent.mqq" },
  { id: "wechat", title: "微信 · Cross", storefront: "cn", bundleId: "com.tencent.xin" },
  { id: "wecom", title: "企业微信 · Cross", storefront: "cn", bundleId: "com.tencent.ww" },
  { id: "dingtalk", title: "钉钉 · Cross", storefront: "cn", bundleId: "com.laiwang.DingTalk" },
  { id: "discord", title: "Discord · Cross", storefront: "us", bundleId: "com.hammerandchisel.discord" },
] as const;

export function getBrand(id: string): Brand {
  const brand = brands.find((candidate) => candidate.id === id);
  if (!brand) throw new Error(`Unknown brand: ${id}`);
  return brand;
}

async function downloadOfficialIcon(brand: Brand): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.resolve("assets", "branding", `${brand.id}.jpg`)));
}

function brandGradleBlock(brand: Brand, kotlinDsl: boolean): string {
  if (kotlinDsl) {
    return `// CROSSGRAM BRAND OVERRIDE BEGIN
android {
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".crossgram.${brand.id}"
        }
        getByName("release") {
            applicationIdSuffix = ".crossgram.${brand.id}"
        }
    }
}
// CROSSGRAM BRAND OVERRIDE END`;
  }
  return `// CROSSGRAM BRAND OVERRIDE BEGIN
android {
    buildTypes {
        debug {
            applicationIdSuffix ".crossgram.${brand.id}"
        }
        release {
            applicationIdSuffix ".crossgram.${brand.id}"
        }
    }
}
// CROSSGRAM BRAND OVERRIDE END`;
}

function updateBrandBlock(source: string, brand: Brand, kotlinDsl: boolean): string {
  const block = brandGradleBlock(brand, kotlinDsl);
  const pattern = /\/\/ CROSSGRAM BRAND OVERRIDE BEGIN[\s\S]*?\/\/ CROSSGRAM BRAND OVERRIDE END/;
  if (pattern.test(source)) return source.replace(pattern, block);
  return `${source.trimEnd()}\n\n${block}\n`;
}

function applicationIdFromGradle(gradle: string, properties: string | undefined, file: string): string {
  const literal = gradle.match(/defaultConfig\.applicationId\s*=\s*["']([^"']+)["']/)?.[1];
  if (literal) return literal;
  if (/defaultConfig\.applicationId\s*=\s*APP_PACKAGE\b/.test(gradle)) {
    const value = properties?.match(/^APP_PACKAGE\s*=\s*(.+?)\s*$/m)?.[1];
    if (value) return value;
  }
  throw new PatchError(file, "could not determine the original application ID");
}

interface GoogleServicesClient {
  client_info?: {
    android_client_info?: { package_name?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface GoogleServices {
  client?: GoogleServicesClient[];
  [key: string]: unknown;
}

function patchGoogleServices(source: string, baseId: string, brand: Brand, file: string): string {
  let config: GoogleServices;
  try {
    config = JSON.parse(source) as GoogleServices;
  } catch (error) {
    throw new PatchError(file, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const clients = config.client;
  const original = clients?.find((client) => client.client_info?.android_client_info?.package_name === baseId);
  if (!clients || !original) {
    throw new PatchError(file, `could not find Google Services client for ${baseId}`);
  }
  const brandedId = `${baseId}.crossgram.${brand.id}`;
  const branded = structuredClone(original);
  const android = branded.client_info?.android_client_info;
  if (!android) throw new PatchError(file, "Google Services client has no Android package metadata");
  android.package_name = brandedId;
  config.client = [
    ...clients.filter((client) => !client.client_info?.android_client_info?.package_name?.startsWith(`${baseId}.crossgram.`)),
    branded,
  ];
  return `${JSON.stringify(config, null, 2)}\n`;
}

function placeholderGoogleServices(baseId: string, brand: Brand, file: string): string {
  const placeholder: GoogleServices = {
    project_info: {
      project_number: "0",
      project_id: "crossgram-placeholder",
      storage_bucket: "crossgram-placeholder.invalid",
    },
    client: [{
      client_info: {
        mobilesdk_app_id: "1:0:android:00000000000000000000000000000000",
        android_client_info: { package_name: baseId },
      },
      oauth_client: [],
      api_key: [{ current_key: "not-configured" }],
      services: { appinvite_service: { other_platform_oauth_client: [] } },
    }],
    configuration_version: "1",
  };
  return patchGoogleServices(JSON.stringify(placeholder), baseId, brand, file);
}

function disablePrivateCrashlyticsUploads(source: string, file: string): string {
  const native = /^(\s*the<CrashlyticsExtension>\(\)\.nativeSymbolUploadEnabled\s*=\s*)(?:true|isCi)\s*$/m;
  const nativeMatches = [...source.matchAll(new RegExp(native.source, "gm"))];
  let updated = source;
  if (nativeMatches.length === 1) {
    updated = updated.replace(native, "$1false // CROSSGRAM: private Crashlytics uploads disabled");
  } else if (nativeMatches.length !== 0 || !source.includes("CROSSGRAM: private Crashlytics uploads disabled")) {
    throw new PatchError(file, `expected one Crashlytics native upload setting, found ${nativeMatches.length}`);
  }
  const mapping = /^(\s*mappingFileUploadEnabled\s*=\s*)isCi\s*$/m;
  const mappingMatches = [...updated.matchAll(new RegExp(mapping.source, "gm"))];
  if (mappingMatches.length > 1) {
    throw new PatchError(file, `expected at most one Crashlytics mapping upload setting, found ${mappingMatches.length}`);
  }
  if (mappingMatches.length === 1) {
    updated = updated.replace(mapping, "$1false // CROSSGRAM: private Crashlytics mapping upload disabled");
  } else if (!updated.includes("CROSSGRAM: private Crashlytics mapping upload disabled")) {
    const nativeLine = /^(\s*)the<CrashlyticsExtension>\(\)\.nativeSymbolUploadEnabled\s*=\s*false \/\/ CROSSGRAM: private Crashlytics uploads disabled\s*$/m;
    if (!nativeLine.test(updated)) {
      throw new PatchError(file, "could not place the Crashlytics mapping upload override");
    }
    updated = updated.replace(
      nativeLine,
      "$&\n$1configure<CrashlyticsExtension> {\n$1    mappingFileUploadEnabled = false // CROSSGRAM: private Crashlytics mapping upload disabled\n$1}",
    );
  }
  return updated;
}

function patchManifest(source: string, file: string): string {
  const match = source.match(/<application\b[\s\S]*?>/);
  if (!match) throw new PatchError(file, "could not find the application manifest element");
  let application = match[0];
  application = application.replace(/android:label="[^"]+"/, 'android:label="@string/CrossgramAppName"');
  if (!application.includes("android:label=")) {
    application = application.replace(/<application\b/, '<application\n        android:label="@string/CrossgramAppName"');
  }
  let updated = source.replace(match[0], application);
  updated = updated.replace(/android:icon="@mipmap\/[^"]+"/g,
    'android:icon="@mipmap/crossgram_launcher"');
  updated = updated.replace(/android:roundIcon="@mipmap\/[^"]+"/g,
    'android:roundIcon="@mipmap/crossgram_launcher"');
  return updated;
}

export async function applyBrand(root: string, upstream: Upstream, brand: Brand): Promise<string[]> {
  const changed: string[] = [];
  const appGradle = upstream.id === "telegram"
    ? "TMessagesProj_App/build.gradle"
    : upstream.id === "nnngram" || upstream.id === "nullgram"
      ? "TMessagesProj/build.gradle.kts"
      : "TMessagesProj/build.gradle";
  const gradleFile = path.join(root, appGradle);
  const gradle = await readUtf8(gradleFile);
  if (!/com\.android\.application|libs\.plugins\.android\.application/.test(gradle)) {
    throw new PatchError(appGradle, "expected an Android application module");
  }
  if (await writeUtf8IfChanged(gradleFile, updateBrandBlock(gradle, brand, appGradle.endsWith(".kts")))) changed.push(appGradle);

  const googleServicesRelative = path.join(path.dirname(appGradle), "google-services.json").replaceAll("\\", "/");
  const googleServicesFile = path.join(root, googleServicesRelative);
  try {
    await access(googleServicesFile);
    let properties: string | undefined;
    try {
      properties = await readUtf8(path.join(root, "gradle.properties"));
    } catch {
      // Most forks use a literal application ID and need no properties file.
    }
    const baseId = applicationIdFromGradle(gradle, properties, appGradle);
    const googleServices = await readUtf8(googleServicesFile);
    if (await writeUtf8IfChanged(
      googleServicesFile,
      patchGoogleServices(googleServices, baseId, brand, googleServicesRelative),
    )) changed.push(googleServicesRelative);
    if (googleServices.includes('"project_id": "crossgram-placeholder"')) {
      const current = await readUtf8(gradleFile);
      const disabledUploads = disablePrivateCrashlyticsUploads(current, appGradle);
      if (await writeUtf8IfChanged(gradleFile, disabledUploads) && !changed.includes(appGradle)) changed.push(appGradle);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const current = await readUtf8(gradleFile);
    let properties: string | undefined;
    try {
      properties = await readUtf8(path.join(root, "gradle.properties"));
    } catch {
      // Kotlin forks use literal application IDs.
    }
    const baseId = applicationIdFromGradle(current, properties, appGradle);
    if (await writeUtf8IfChanged(
      googleServicesFile,
      placeholderGoogleServices(baseId, brand, googleServicesRelative),
    )) changed.push(googleServicesRelative);
    const disabledUploads = disablePrivateCrashlyticsUploads(current, appGradle);
    if (await writeUtf8IfChanged(gradleFile, disabledUploads) && !changed.includes(appGradle)) changed.push(appGradle);
  }

  const manifestRelatives = ["TMessagesProj/src/main/AndroidManifest.xml"];
  if (upstream.id === "telegram") {
    manifestRelatives.push(
      "TMessagesProj/config/debug/AndroidManifest.xml",
      "TMessagesProj/config/debug/AndroidManifest_SDK23.xml",
      "TMessagesProj/config/release/AndroidManifest.xml",
      "TMessagesProj/config/release/AndroidManifest_SDK23.xml",
      "TMessagesProj/config/release/AndroidManifest_standalone.xml",
    );
  }
  for (const manifestRelative of manifestRelatives) {
    const manifestFile = path.join(root, manifestRelative);
    const manifest = await readUtf8(manifestFile);
    if (await writeUtf8IfChanged(manifestFile, patchManifest(manifest, manifestRelative))) changed.push(manifestRelative);
  }

  const nameRelative = "TMessagesProj/src/main/res/values/crossgram_brand.xml";
  const nameXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="CrossgramAppName">${brand.title}</string>\n</resources>\n`;
  if (await writeUtf8IfChanged(path.join(root, nameRelative), nameXml)) changed.push(nameRelative);

  const icon = await downloadOfficialIcon(brand);
  const iconRelative = "TMessagesProj/src/main/res/mipmap-xxxhdpi/crossgram_launcher.jpg";
  if (await writeBinaryIfChanged(path.join(root, iconRelative), icon)) changed.push(iconRelative);
  return changed;
}
