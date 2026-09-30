import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { patchFileLoadOperation } from "../features/direct-download/patch.js";

/**
 * Drives the real, patched upstream part assembler against the relay's answer
 * for a bridge photo preview advertised with its original's byte count.
 *
 * The production case: media 344056 is a 661,310-byte JPEG whose QQ preview
 * reports zero bytes, so the relay advertises the `m` preview at 661,310.
 * Telegram requests 32 KiB parts; the relay answers the real preview end with
 * a short part and then empty parts. Unpatched, the empty parts arrive at
 * offsets the sequential assembler is not at yet, park in delayedRequestInfos
 * forever, and the operation keeps its download-queue slot until restart.
 */
const references = path.resolve("..", "work", "references");
const upstreams = [
  "nagram",
  "forkgram",
  "mercurygram",
  "upstream-check/nnngram",
  "upstream-check/nullgram",
  "upstream-check/telegram",
];
const operationPath = "TMessagesProj/src/main/java/org/telegram/messenger/FileLoadOperation.java";
const available = upstreams.filter((name) => existsSync(path.join(references, name, operationPath)));

const CHUNK = 32 * 1024;
const PREVIEW = 6 * CHUNK + 15_208; // 211,816 bytes: what the relay actually streams.
const ADVERTISED = 661_310;

/** Each scenario: reference, location kind, thumb size, advertised size, streamed size. */
const scenarios = {
  upperBound: ["bridge-media:344056", "photo", "m", ADVERTISED, PREVIEW],
  exactSize: ["bridge-media:344056", "photo", "x", ADVERTISED, PREVIEW],
  exactPreview: ["bridge-media:344056", "photo", "m", PREVIEW, PREVIEW],
} as const;

let directory = "";
const results = new Map<string, string>();

/** Returns the full text of the one method declared by `signature`, braces included. */
function methodSource(source: string, signature: RegExp): string {
  const match = signature.exec(source);
  if (!match) throw new Error(`method not found: ${signature}`);
  const open = source.indexOf("{", match.index + match[0].length - 1);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(match.index, index + 1);
  }
  throw new Error(`unterminated method: ${signature}`);
}

/** The processRequestResult sequential-assembly branch that decides when a sized file ends. */
function assemblerBranch(patched: string): string {
  const method = methodSource(patched, /protected\s+boolean\s+processRequestResult\s*\(/);
  const start = method.indexOf("downloadedBytes += currentBytesSize;");
  const end = method.indexOf("if (key != null) {", start);
  if (start < 0 || end < 0) throw new Error("assembler branch anchors moved");
  return method.slice(start, end);
}

/** The size-mismatch guard start() runs before trusting an already finished file. */
function finalFileGuard(patched: string): string {
  const method = methodSource(patched, /public\s+boolean\s+start\s*\(\s*final\s+FileLoadOperationStream/);
  const match = /if \(finalFileExist && [\s\S]*?\) \{/.exec(method);
  if (!match) throw new Error("final file guard moved");
  return match[0];
}

/** One operation class per upstream, built from that upstream's patched code. */
function operationClass(className: string, patched: string): string {
  return `final class ${className} extends Operation {
  boolean part(int currentBytesSize, int chunkSize) {
    RequestInfo requestInfo = new RequestInfo();
    requestInfo.chunkSize = chunkSize;
    boolean finishedDownloading;
    boolean finishPreload = false;
    ${assemblerBranch(patched)}
    return finishedDownloading;
  }

  boolean deletesFinalFile(long actual) {
    boolean finalFileExist = true;
    boolean ungzip = false;
    Object parentObject = null;
    cacheFileFinal.length = actual;
    ${finalFileGuard(patched)}
      return true;
    }
    return false;
  }
}
`;
}

beforeAll(async () => {
  if (available.length === 0) return;
  directory = await mkdtemp(path.join(tmpdir(), "crossgram-upper-bound-e2e-"));
  const direct = path.join(directory, "org/telegram/messenger/crossgram_direct");
  const messenger = path.join(directory, "org/telegram/messenger");
  await mkdir(direct, { recursive: true });
  await writeFile(path.join(direct, "CrossgramBridgeFileReference.java"), await readFile(path.resolve(
    "features/direct-download/files/java/org/telegram/messenger/crossgram_direct/CrossgramBridgeFileReference.java",
  ), "utf8"), "utf8");
  // Same decisions as CrossgramDirectDownload, over the harness's location type.
  await writeFile(path.join(direct, "CrossgramDirectDownload.java"), `package org.telegram.messenger.crossgram_direct;
import org.telegram.messenger.Location;
public final class CrossgramDirectDownload {
  public static int shortEnds;
  public static boolean endsAtShortPart(Location location, long received, long requested) {
    return location != null && CrossgramBridgeFileReference.endsAtShortPart(
        location.file_reference, location.photo, location.thumb_size, received, requested);
  }
  public static boolean acceptsShorterFinalFile(Location location, long advertised, long actual) {
    return location != null && CrossgramBridgeFileReference.acceptsShorterFile(
        location.file_reference, location.photo, location.thumb_size, advertised, actual);
  }
  public static void reportShortEnd(String fileName, long downloaded, long advertised) { shortEnds++; }
}
`, "utf8");
  await writeFile(path.join(messenger, "Location.java"), `package org.telegram.messenger;
public final class Location {
  public byte[] file_reference; public boolean photo; public String thumb_size;
}
`, "utf8");
  await writeFile(path.join(messenger, "Operation.java"), `package org.telegram.messenger;
import java.util.ArrayList;
import java.util.List;
/** The FileLoadOperation state upstream's assembler branch and final-file guard read. */
abstract class Operation {
  static final class BuildVars { static final boolean LOGS_ENABLED = false; }
  static final class FileLog { static void d(String value) {} }
  static final class TLRPC { static final class TL_theme {} }
  static final class RequestInfo { int chunkSize; }
  static final class FinalFile { long length; String getName() { return "preview"; } long length() { return length; } }
  static final class Delegate { boolean isLocallyCreatedFile(String value) { return false; } }
  static final boolean FULL_LOGS = false;
  final String fileName = "-344056_109.jpg";
  final Delegate delegate = new Delegate();
  final FinalFile cacheFileFinal = new FinalFile();
  Location location = new Location();
  long totalBytesCount;
  long downloadedBytes;
  long preloadPrefixSize;
  int currentDownloadChunkSize = ${CHUNK};
  // Sequential assembly: photo sizes never enable upstream's out-of-order save.
  List<Object> notLoadedBytesRanges = null;
  List<Object> requestInfos = new ArrayList<>();
  boolean canFinishPreload() { return false; }
  abstract boolean part(int currentBytesSize, int chunkSize);
  abstract boolean deletesFinalFile(long actual);
}
`, "utf8");

  const classes: string[] = [];
  const operationFiles: string[] = [];
  for (const [index, name] of available.entries()) {
    const className = `Upstream${index}`;
    const source = await readFile(path.join(references, name, operationPath), "utf8");
    const file = path.join(messenger, `${className}.java`);
    await writeFile(file, `package org.telegram.messenger;
import org.telegram.messenger.crossgram_direct.CrossgramDirectDownload;
${operationClass(className, patchFileLoadOperation(source))}`, "utf8");
    classes.push(className);
    operationFiles.push(file);
  }
  await writeFile(path.join(messenger, "Harness.java"), `package org.telegram.messenger;
import java.nio.charset.StandardCharsets;
import org.telegram.messenger.crossgram_direct.CrossgramDirectDownload;
public final class Harness {
  static String run(Operation operation, String[] args, int offset) {
    CrossgramDirectDownload.shortEnds = 0;
    operation.location.file_reference = args[offset].getBytes(StandardCharsets.UTF_8);
    operation.location.photo = "photo".equals(args[offset + 1]);
    operation.location.thumb_size = args[offset + 2];
    operation.totalBytesCount = Long.parseLong(args[offset + 3]);
    long streamed = Long.parseLong(args[offset + 4]);
    int parts = 0;
    boolean finished = false;
    // The relay answers every part in order, short at the real end, then empty.
    while (!finished && parts < 64) {
      long remaining = Math.max(0, streamed - operation.downloadedBytes);
      int size = (int) Math.min(operation.currentDownloadChunkSize, remaining);
      finished = operation.part(size, operation.currentDownloadChunkSize);
      parts++;
      if (size == 0) break;
    }
    return "finished=" + finished
        + " parts=" + parts
        + " bytes=" + operation.downloadedBytes
        + " short_ends=" + CrossgramDirectDownload.shortEnds
        + " deletes_finished=" + operation.deletesFinalFile(operation.downloadedBytes);
  }

  public static void main(String[] args) throws Exception {
    StringBuilder output = new StringBuilder();
    for (int scenario = 0; scenario < args.length; scenario += 5) {
${classes.map((name) => `      output.append(run(new ${name}(), args, scenario)).append('\\n');`).join("\n")}
    }
    System.out.print(output);
  }
}
`, "utf8");
  await promisify(execFile)("javac", [
    "-encoding", "UTF-8",
    "-d", directory,
    path.join(direct, "CrossgramBridgeFileReference.java"),
    path.join(direct, "CrossgramDirectDownload.java"),
    path.join(messenger, "Location.java"),
    path.join(messenger, "Operation.java"),
    ...operationFiles,
    path.join(messenger, "Harness.java"),
  ]);
  const order = Object.keys(scenarios) as Array<keyof typeof scenarios>;
  const { stdout } = await promisify(execFile)("java", [
    "-cp", directory, "org.telegram.messenger.Harness",
    ...order.flatMap((key) => scenarios[key].map(String)),
  ]);
  const lines = stdout.trimEnd().split(/\r?\n/);
  order.forEach((key, scenario) => available.forEach((name, upstream) => {
    results.set(`${name}:${key}`, lines[scenario * available.length + upstream] ?? "");
  }));
}, 120_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe.skipIf(available.length === 0)("upper-bound-sized bridge preview e2e", () => {
  for (const name of available) {
    it(`${name}: finishes at the relay's short final part and keeps the preview`, () => {
      expect(results.get(`${name}:upperBound`)).toBe(
        `finished=true parts=7 bytes=${PREVIEW} short_ends=1 deletes_finished=false`,
      );
    });

    it(`${name}: still waits for the exact size of every other bridge file`, () => {
      // Exact sizes keep upstream behavior: a short body is never promoted to a
      // finished file, and a short file on disk is downloaded again.
      expect(results.get(`${name}:exactSize`)).toBe(
        `finished=false parts=8 bytes=${PREVIEW} short_ends=0 deletes_finished=true`,
      );
      expect(results.get(`${name}:exactPreview`)).toBe(
        `finished=true parts=7 bytes=${PREVIEW} short_ends=0 deletes_finished=false`,
      );
    });
  }
});
