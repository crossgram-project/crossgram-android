import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const payload = Buffer.from("crossgram-direct-client-e2e-payload");
let directory = "";
let baseUrl = "";
let closeServer: (() => Promise<void>) | undefined;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "crossgram-android-direct-e2e-"));
  const packageDir = path.join(directory, "org", "telegram", "messenger", "crossgram_direct");
  await mkdir(packageDir, { recursive: true });
  await copyFile(
    path.resolve("features/direct-download/files/java/org/telegram/messenger/crossgram_direct/CrossgramDirectHttp.java"),
    path.join(packageDir, "CrossgramDirectHttp.java"),
  );
  await writeFile(path.join(packageDir, "Harness.java"), `package org.telegram.messenger.crossgram_direct;
import java.nio.charset.StandardCharsets;
public final class Harness {
  public static void main(String[] args) throws Exception {
    try {
      byte[] bytes = CrossgramDirectHttp.loadRange(args[0], Long.parseLong(args[1]), Integer.parseInt(args[2]), null);
      System.out.print("DIRECT:" + new String(bytes, StandardCharsets.UTF_8));
    } catch (Exception error) {
      System.out.print("RELAY:" + error.getMessage());
    }
  }
}
`, "utf8");
  await exec("javac", [
    path.join(packageDir, "CrossgramDirectHttp.java"),
    path.join(packageDir, "Harness.java"),
  ]);

  const server = createServer((request, response) => {
    if (request.url === "/no-range") {
      response.writeHead(200, { "content-length": payload.length });
      response.end(payload);
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
    if (!match) {
      response.writeHead(400).end();
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), payload.length - 1);
    const body = payload.subarray(start, end + 1);
    response.writeHead(206, {
      "content-length": body.length,
      "content-range": `bytes ${start}-${end}/${payload.length}`,
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

afterAll(async () => {
  await closeServer?.();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function run(url: string, offset: number, limit: number): Promise<string> {
  const result = await exec("java", [
    "-cp", directory,
    "org.telegram.messenger.crossgram_direct.Harness",
    url,
    String(offset),
    String(limit),
  ]);
  return result.stdout;
}

describe("Android direct HTTP client e2e", () => {
  it("downloads the requested byte range and reports direct transport", async () => {
    expect(await run(`${baseUrl}/range`, 10, 8)).toBe(`DIRECT:${payload.subarray(10, 18).toString()}`);
  });

  it("rejects a server that ignores Range so FileLoadOperation can use relay", async () => {
    expect(await run(`${baseUrl}/no-range`, 5, 8)).toContain("RELAY:direct HTTP expected 206, got 200");
  });
});
