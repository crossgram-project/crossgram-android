import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  applyFastUpload, patchFileUploadOperation, patchSendMessagesHelper,
} from "../features/fast-upload/patch.js";
import { getUpstream } from "../src/upstreams.js";

const exec = promisify(execFile);

const uploadFixture = `package org.telegram.messenger;

import org.telegram.tgnet.TLRPC;

public class FileUploadOperation {
    private int currentAccount;
    private int currentType;
    private boolean isEncrypted;
    private long estimatedSize;
    private String uploadingFilePath;
    private int state;
    private long currentFileId;
    private long totalFileSize;
    private int totalPartsCount;
    private long uploadedBytesCount;
    private boolean slowNetwork;
    private Object delegate;
    protected long lastProgressUpdateTime;

    public void start() {
        if (state != 0) {
            return;
        }
        state = 1;
        Utilities.stageQueue.postRunnable(() -> {
            preferences = ApplicationLoader.applicationContext.getSharedPreferences("uploadinfo", 0);
            slowNetwork = ApplicationLoader.isConnectionSlow();
            if (BuildVars.LOGS_ENABLED) {
                FileLog.d("start upload on slow network = " + slowNetwork);
            }
            for (int a = 0, count = (slowNetwork ? initialRequestsSlowNetworkCount : initialRequestsCount); a < count; a++) {
                startUploadRequest();
            }
        });
    }

    protected void onNetworkChanged(final boolean slow) {}
    private void startUploadRequest() {}
    private void cleanup() {}
}
`;

const sendFixture = `package org.telegram.messenger;

import java.util.ArrayList;

public class SendMessagesHelper {
    private int currentAccount;
    private void putToDelayedMessages(String location, DelayedMessage message) {
        ArrayList<DelayedMessage> arrayList = delayedMessages.get(location);
        if (arrayList == null) {
            arrayList = new ArrayList<>();
            delayedMessages.put(location, arrayList);
        }
        arrayList.add(message);
    }
}
`;

describe("Android hash-first upload patch", () => {
  it("queries hashes before upload, finishes a cache hit, and preserves normal fallback", () => {
    const patched = patchFileUploadOperation(uploadFixture);
    expect(patched).toContain("CrossgramFastUpload.prepare(currentAccount, uploadingFilePath");
    expect(patched).toContain("finishCrossgramFastUpload(result);");
    expect(patched).toContain("startCrossgramUploadRequests();");
    expect(patched).toContain("delegate.didFinishUploadingFile(this, result, null, null, null);");
    expect(patchFileUploadOperation(patched)).toBe(patched);
  });

  it("binds the delayed upload path to its destination conversation", () => {
    const patched = patchSendMessagesHelper(sendFixture);
    expect(patched).toContain(
      "CrossgramFastUpload.bind(location, currentAccount, message.obj.getDialogId());",
    );
    expect(patchSendMessagesHelper(patched)).toBe(patched);
  });

  it("computes full hashes and a final SHA-1 checkpoint in one local pass", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgram-fast-upload-hash-"));
    const packageDir = path.join(root, "org/telegram/messenger/crossgram_upload");
    try {
      await mkdir(packageDir, { recursive: true });
      const source = path.resolve(
        "features/fast-upload/files/java/org/telegram/messenger/crossgram_upload/CrossgramFastUploadHash.java",
      );
      await writeFile(path.join(packageDir, "CrossgramFastUploadHash.java"), await readFile(source));
      await writeFile(path.join(packageDir, "Harness.java"), `package org.telegram.messenger.crossgram_upload;
import java.io.File;
public final class Harness {
  private static String hex(byte[] value) {
    StringBuilder out = new StringBuilder();
    for (byte item : value) out.append(String.format("%02x", item & 255));
    return out.toString();
  }
  public static void main(String[] args) throws Exception {
    CrossgramFastUploadHash.Result result = CrossgramFastUploadHash.compute(new File(args[0]));
    System.out.print(result.size + ":" + hex(result.md5) + ":" + hex(result.sha1) + ":"
        + hex(result.sha1Checkpoints) + ":" + hex(result.file10mMd5));
  }
}`);
      const payload = path.join(root, "payload.bin");
      await writeFile(payload, Buffer.from([1, 2, 3, 4]));
      await exec("javac", [path.join(packageDir, "CrossgramFastUploadHash.java"), path.join(packageDir, "Harness.java")]);
      const result = await exec("java", ["-cp", root, "org.telegram.messenger.crossgram_upload.Harness", payload]);
      expect(result.stdout).toBe(
        "4:08d6c05a21512a79a1dfeb9d2a8f262f:12dada1fff4d4787ade3333147202c3b443e376f:"
        + "12dada1fff4d4787ade3333147202c3b443e376f:08d6c05a21512a79a1dfeb9d2a8f262f",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits little-endian cumulative SHA-1 state at 1 MiB and the standard final digest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgram-fast-upload-checkpoints-"));
    const packageDir = path.join(root, "org/telegram/messenger/crossgram_upload");
    try {
      await mkdir(packageDir, { recursive: true });
      const source = path.resolve(
        "features/fast-upload/files/java/org/telegram/messenger/crossgram_upload/CrossgramFastUploadHash.java",
      );
      await writeFile(path.join(packageDir, "CrossgramFastUploadHash.java"), await readFile(source));
      await writeFile(path.join(packageDir, "Harness.java"), `package org.telegram.messenger.crossgram_upload;
import java.io.File;
public final class Harness {
  private static String hex(byte[] value) {
    StringBuilder out = new StringBuilder();
    for (byte item : value) out.append(String.format("%02x", item & 255));
    return out.toString();
  }
  public static void main(String[] args) throws Exception {
    CrossgramFastUploadHash.Result result = CrossgramFastUploadHash.compute(new File(args[0]));
    System.out.print(result.size + ":" + hex(result.md5) + ":" + hex(result.sha1) + ":"
        + hex(result.sha1Checkpoints) + ":" + hex(result.file10mMd5));
  }
}`);
      const payload = path.join(root, "payload.bin");
      const bytes = Buffer.allocUnsafe(1024 * 1024 + 17);
      for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 31 + 7) & 0xff;
      await writeFile(payload, bytes);
      await exec("javac", [path.join(packageDir, "CrossgramFastUploadHash.java"), path.join(packageDir, "Harness.java")]);
      const result = await exec("java", ["-cp", root, "org.telegram.messenger.crossgram_upload.Harness", payload]);
      expect(result.stdout).toBe(
        "1048593:ec44d86550a74d4be24feae4f44586f4:d1ab4c8c4fd8c7c634c9ba29ff752b0311dbe9c8:"
        + "ab9a20fd6c98fc1f8f0c985cd552ff14c6feacfdd1ab4c8c4fd8c7c634c9ba29ff752b0311dbe9c8:"
        + "ec44d86550a74d4be24feae4f44586f4",
      );

      await writeFile(payload, bytes.subarray(0, 1024 * 1024));
      const exact = await exec("java", ["-cp", root, "org.telegram.messenger.crossgram_upload.Harness", payload]);
      expect(exact.stdout).toBe(
        "1048576:3f2c8bd9cfde6550fdff4b36617c3261:95421610b8ddd86c86e3269bfd24d2a79199245f:"
        + "95421610b8ddd86c86e3269bfd24d2a79199245f:3f2c8bd9cfde6550fdff4b36617c3261",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("installs both runtime classes and patches the upload/send anchors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgram-fast-upload-install-"));
    try {
      const upload = path.join(root, "TMessagesProj/src/main/java/org/telegram/messenger/FileUploadOperation.java");
      const send = path.join(root, "TMessagesProj/src/main/java/org/telegram/messenger/SendMessagesHelper.java");
      await mkdir(path.dirname(upload), { recursive: true });
      await writeFile(upload, uploadFixture);
      await writeFile(send, sendFixture);
      const changed = await applyFastUpload(root, getUpstream("telegram"));
      expect(changed).toContain("TMessagesProj/src/main/java/org/telegram/messenger/FileUploadOperation.java");
      expect(changed).toContain("TMessagesProj/src/main/java/org/telegram/messenger/SendMessagesHelper.java");
      const runtime = await readFile(path.join(path.dirname(upload),
        "crossgram_upload/CrossgramFastUpload.java"), "utf8");
      expect(runtime).toContain("PREPARE_MEDIA_UPLOAD_V2_CONSTRUCTOR = 0xf75adc0f");
      expect(runtime).toContain("request.sha1Checkpoints = hashes.sha1Checkpoints;");
      expect(runtime).toMatch(/writeByteArray\(sha1\);\s+stream\.writeByteArray\(sha1Checkpoints\);\s+stream\.writeByteArray\(file10mMd5\);/);
      expect(runtime).toContain("AbstractSerializedData stream");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
