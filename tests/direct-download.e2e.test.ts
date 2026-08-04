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
let requests = 0;
let rangeHeaders: Array<string | undefined> = [];
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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
public final class Harness {
  public static void main(String[] args) throws Exception {
    CrossgramDirectHttp.Transfer transfer = new CrossgramDirectHttp.Transfer(args[0]);
    CountDownLatch done = new CountDownLatch(2);
    String[] results = new String[2];
    transfer.read(1, Long.parseLong(args[1]), Integer.parseInt(args[2]), (bytes, error) -> {
      results[0] = error != null ? "RELAY:" + error : new String(bytes, StandardCharsets.UTF_8);
      done.countDown();
    });
    transfer.read(2, Long.parseLong(args[3]), Integer.parseInt(args[4]), (bytes, error) -> {
      results[1] = error != null ? "RELAY:" + error : new String(bytes, StandardCharsets.UTF_8);
      done.countDown();
    });
    if (!done.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("transfer timed out");
    transfer.close();
    System.out.print(results[0] + "|" + results[1]);
  }
}
`, "utf8");
  await exec("javac", [
    path.join(packageDir, "CrossgramDirectHttp.java"),
    path.join(packageDir, "Harness.java"),
  ]);

  const server = createServer((request, response) => {
    requests++;
    rangeHeaders.push(request.headers.range);
    if (request.url === "/whole") {
      response.writeHead(200, { "content-length": payload.length });
      response.end(payload);
      return;
    }
    if (request.url === "/failure") {
      response.writeHead(503).end("unavailable");
      return;
    }
    response.writeHead(404).end();
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

async function run(url: string, firstOffset: number, firstLimit: number,
  secondOffset: number, secondLimit: number): Promise<string> {
  const result = await exec("java", [
    "-cp", directory,
    "org.telegram.messenger.crossgram_direct.Harness",
    url,
    String(firstOffset),
    String(firstLimit),
    String(secondOffset),
    String(secondLimit),
  ]);
  return result.stdout;
}

describe("Android direct HTTP client e2e", () => {
  it("serves multiple FileLoadOperation parts from one normal HTTP request", async () => {
    requests = 0;
    rangeHeaders = [];
    expect(await run(`${baseUrl}/whole`, 5, 8, 13, 9)).toBe(
      `${payload.subarray(5, 13).toString()}|${payload.subarray(13, 22).toString()}`,
    );
    expect(requests).toBe(1);
    expect(rangeHeaders).toEqual([undefined]);
  });

  it("reports one failed whole-file request so FileLoadOperation can fall back to relay", async () => {
    requests = 0;
    expect(await run(`${baseUrl}/failure`, 5, 8, 13, 9)).toContain(
      "RELAY:direct HTTP expected 200, got 503",
    );
    expect(requests).toBe(1);
  });
});
