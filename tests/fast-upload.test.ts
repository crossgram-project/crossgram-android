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

  it("computes full MD5/SHA-1 and first-10-MiB MD5 in one local pass", async () => {
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
    System.out.print(result.size + ":" + hex(result.md5) + ":" + hex(result.sha1) + ":" + hex(result.file10mMd5));
  }
}`);
      const payload = path.join(root, "payload.bin");
      await writeFile(payload, Buffer.from([1, 2, 3, 4]));
      await exec("javac", [path.join(packageDir, "CrossgramFastUploadHash.java"), path.join(packageDir, "Harness.java")]);
      const result = await exec("java", ["-cp", root, "org.telegram.messenger.crossgram_upload.Harness", payload]);
      expect(result.stdout).toBe(
        "4:08d6c05a21512a79a1dfeb9d2a8f262f:12dada1fff4d4787ade3333147202c3b443e376f:08d6c05a21512a79a1dfeb9d2a8f262f",
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
      expect(runtime).toContain("PREPARE_MEDIA_UPLOAD_CONSTRUCTOR = 0xf75adc0e");
      expect(runtime).toContain("AbstractSerializedData stream");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
