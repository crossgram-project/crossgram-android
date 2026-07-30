import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_HASH,
  DEFAULT_API_ID,
  resolveApiIdentity,
  writeApiIdentity,
} from "../scripts/ci/api-identity.mjs";

async function buildVarsFixture(source: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "crossgram-api-identity-"));
  const directory = path.join(
    root,
    "TMessagesProj",
    "src",
    "main",
    "java",
    "org",
    "telegram",
    "messenger",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "BuildVars.java"), source, "utf8");
  return root;
}

describe("Android Telegram API identity", () => {
  it("uses the Crossgram identity by default and accepts complete overrides", () => {
    expect(resolveApiIdentity({})).toEqual({
      apiId: DEFAULT_API_ID,
      apiHash: DEFAULT_API_HASH,
    });
    expect(resolveApiIdentity({
      CROSSGRAM_TELEGRAM_API_ID: "12345",
      CROSSGRAM_TELEGRAM_API_HASH: "ABCDEF0123456789ABCDEF0123456789",
    })).toEqual({
      apiId: "12345",
      apiHash: "abcdef0123456789abcdef0123456789",
    });
  });

  it("rejects partial or malformed overrides", () => {
    expect(() => resolveApiIdentity({ CROSSGRAM_TELEGRAM_API_ID: "12345" }))
      .toThrow(/provided together/);
    expect(() => resolveApiIdentity({
      CROSSGRAM_TELEGRAM_API_ID: "not-a-number",
      CROSSGRAM_TELEGRAM_API_HASH: "abcdef0123456789abcdef0123456789",
    })).toThrow(/decimal integer/);
    expect(() => resolveApiIdentity({
      CROSSGRAM_TELEGRAM_API_ID: "12345",
      CROSSGRAM_TELEGRAM_API_HASH: "short",
    })).toThrow(/32 hexadecimal/);
  });

  it.each(["nagram", "telegram", "nnngram", "nullgram"])(
    "patches %s BuildVars declarations idempotently",
    async (client) => {
      const root = await buildVarsFixture([
        "public class BuildVars {",
        "  public static final int APP_ID = 4;",
        '  public static final String APP_HASH = "old";',
        "}",
        "",
      ].join("\n"));
      await writeApiIdentity(client, root);
      await writeApiIdentity(client, root);
      const source = await readFile(path.join(
        root,
        "TMessagesProj/src/main/java/org/telegram/messenger/BuildVars.java",
      ), "utf8");
      expect(source).toContain(`APP_ID = ${DEFAULT_API_ID};`);
      expect(source).toContain(`APP_HASH = "${DEFAULT_API_HASH}";`);
      expect(source).not.toContain("APP_ID = 4;");
    },
  );

  it("writes Mercurygram API_KEYS and Forkgram Gradle properties", async () => {
    const mercurygram = await mkdtemp(path.join(os.tmpdir(), "crossgram-mercurygram-"));
    await writeApiIdentity("mercurygram", mercurygram);
    expect(await readFile(path.join(mercurygram, "API_KEYS"), "utf8"))
      .toBe(`APP_ID = ${DEFAULT_API_ID}\nAPP_HASH = ${DEFAULT_API_HASH}\n`);

    const forkgram = await mkdtemp(path.join(os.tmpdir(), "crossgram-forkgram-"));
    await writeFile(
      path.join(forkgram, "gradle.properties"),
      "APP_ID=0\nAPP_HASH=0\nCHECK_UPDATES=0\n",
      "utf8",
    );
    await writeApiIdentity("forkgram", forkgram);
    await writeApiIdentity("forkgram", forkgram);
    expect(await readFile(path.join(forkgram, "gradle.properties"), "utf8"))
      .toBe(
        `APP_ID=${DEFAULT_API_ID}\nAPP_HASH=${DEFAULT_API_HASH}\nCHECK_UPDATES=0\n`,
      );
  });
});
