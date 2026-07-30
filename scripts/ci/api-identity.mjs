import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_API_ID = "24862414";
export const DEFAULT_API_HASH = "1745670d4621f50d831db069ecc40285";

export function resolveApiIdentity(environment = process.env) {
  const apiId = environment.CROSSGRAM_TELEGRAM_API_ID?.trim() ?? "";
  const apiHash = environment.CROSSGRAM_TELEGRAM_API_HASH?.trim() ?? "";
  if (Boolean(apiId) !== Boolean(apiHash)) {
    throw new Error(
      "CROSSGRAM_TELEGRAM_API_ID and CROSSGRAM_TELEGRAM_API_HASH must be provided together",
    );
  }
  if (apiId && !/^\d+$/.test(apiId)) {
    throw new Error("CROSSGRAM_TELEGRAM_API_ID must be a decimal integer");
  }
  if (apiHash && !/^[0-9a-fA-F]{32}$/.test(apiHash)) {
    throw new Error("CROSSGRAM_TELEGRAM_API_HASH must be 32 hexadecimal characters");
  }
  return {
    apiId: apiId || DEFAULT_API_ID,
    apiHash: (apiHash || DEFAULT_API_HASH).toLowerCase(),
  };
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.replace("g", "")))
    ? [...source.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))]
    : [];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

async function writeBuildVars(root, { apiId, apiHash }) {
  const file = path.join(
    root,
    "TMessagesProj",
    "src",
    "main",
    "java",
    "org",
    "telegram",
    "messenger",
    "BuildVars.java",
  );
  const original = await readFile(file, "utf8");
  let source = replaceExactlyOnce(
    original,
    /public static (?:final )?int APP_ID = [^;]+;/,
    (match) => match.replace(/= [^;]+;/, `= ${apiId};`),
    "BuildVars.APP_ID declaration",
  );
  source = replaceExactlyOnce(
    source,
    /public static (?:final )?String APP_HASH = [^;]+;/,
    (match) => match.replace(/= [^;]+;/, `= "${apiHash}";`),
    "BuildVars.APP_HASH declaration",
  );
  if (source !== original) await writeFile(file, source, "utf8");
  return [path.relative(root, file).replaceAll("\\", "/")];
}

async function writeMercurygramKeys(root, { apiId, apiHash }) {
  const file = path.join(root, "API_KEYS");
  await writeFile(file, `APP_ID = ${apiId}\nAPP_HASH = ${apiHash}\n`, "utf8");
  return ["API_KEYS"];
}

function setGradleProperty(source, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, `${key}=${value}`);
  return `${source}${source.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
}

async function writeForkgramProperties(root, { apiId, apiHash }) {
  const file = path.join(root, "gradle.properties");
  const original = await readFile(file, "utf8");
  const source = setGradleProperty(
    setGradleProperty(original, "APP_ID", apiId),
    "APP_HASH",
    apiHash,
  );
  if (source !== original) await writeFile(file, source, "utf8");
  return ["gradle.properties"];
}

export async function writeApiIdentity(client, root, identity = resolveApiIdentity()) {
  switch (client) {
    case "nagram":
    case "telegram":
    case "nnngram":
    case "nullgram":
      return writeBuildVars(root, identity);
    case "mercurygram":
      return writeMercurygramKeys(root, identity);
    case "forkgram":
      return writeForkgramProperties(root, identity);
    default:
      throw new Error(`Unsupported Android client: ${client}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = process.argv[2];
  const root = process.argv[3];
  if (!client || !root) {
    throw new Error("Usage: api-identity.mjs <client> <source-root>");
  }
  const changedFiles = await writeApiIdentity(client, path.resolve(root));
  console.log(JSON.stringify({ client, changedFiles }));
}
