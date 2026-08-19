#!/usr/bin/env node
import path from "node:path";

import { applyServerE2e } from "../features/server-e2e/patch.js";
import { applyServerSwitch } from "../features/server-switch/patch.js";
import { applyDirectDownload } from "../features/direct-download/patch.js";
import { applyMergedForward } from "../features/merged-forward/patch.js";
import { applyReactionOrder } from "../features/reaction-order/patch.js";
import { applyRawAnimation } from "../features/raw-animation/patch.js";
import { applyFastUpload } from "../features/fast-upload/patch.js";
import { applyBrand, getBrand } from "./branding.js";
import { prepareBuild, type BuildVariant } from "./build/prepare.js";
import { emitGithubMatrices } from "./discover.js";
import { getUpstream } from "./upstreams.js";

function option(name: string, required = true): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "patch") {
    const upstream = getUpstream(option("client")!);
    const root = path.resolve(option("source")!);
    const result = await applyServerSwitch(root, upstream);
    const directDownloadFiles = await applyDirectDownload(root, upstream);
    const mergedForwardFiles = await applyMergedForward(root, upstream);
    const reactionOrderFiles = await applyReactionOrder(root, upstream);
    const rawAnimationFiles = await applyRawAnimation(root, upstream);
    const fastUploadFiles = await applyFastUpload(root, upstream);
    console.log(JSON.stringify({
      client: upstream.id,
      source: root,
      changedFiles: [...result.changedFiles, ...directDownloadFiles, ...mergedForwardFiles, ...reactionOrderFiles, ...rawAnimationFiles, ...fastUploadFiles],
    }, null, 2));
  } else if (command === "e2e") {
    const upstream = getUpstream(option("client")!);
    if (upstream.id !== "nagram") throw new Error("The Android server E2E driver currently targets Nagram");
    const root = path.resolve(option("source")!);
    const result = await applyServerE2e(root);
    console.log(JSON.stringify({ client: upstream.id, source: root, ...result }, null, 2));
  } else if (command === "discover") {
    const result = await emitGithubMatrices(option("github-output", false));
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "prepare-build") {
    const upstream = getUpstream(option("client")!);
    const root = path.resolve(option("source")!);
    const variant = option("variant") as BuildVariant;
    const changedFiles = await prepareBuild(root, upstream, variant);
    console.log(JSON.stringify({ client: upstream.id, variant, changedFiles }, null, 2));
  } else if (command === "brand") {
    const upstream = getUpstream(option("client")!);
    const root = path.resolve(option("source")!);
    const brand = getBrand(option("brand")!);
    const changedFiles = await applyBrand(root, upstream, brand);
    console.log(JSON.stringify({ client: upstream.id, brand: brand.id, changedFiles }, null, 2));
  } else {
    throw new Error("Usage: cli.ts <patch|e2e|discover|prepare-build|brand> [options]");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
