package org.telegram.messenger.crossgram_upload;

import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;

/** Pure-Java hash pass shared by the upload patch and its host-side E2E test. */
public final class CrossgramFastUploadHash {
    private static final long FIRST_CHUNK_LIMIT = 10L * 1024 * 1024;

    public static final class Result {
        public final long size;
        public final byte[] md5;
        public final byte[] sha1;
        public final byte[] file10mMd5;

        Result(long size, byte[] md5, byte[] sha1, byte[] file10mMd5) {
            this.size = size;
            this.md5 = md5;
            this.sha1 = sha1;
            this.file10mMd5 = file10mMd5;
        }
    }

    private CrossgramFastUploadHash() {}

    public static Result compute(File file) throws Exception {
        MessageDigest md5 = MessageDigest.getInstance("MD5");
        MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
        MessageDigest first = MessageDigest.getInstance("MD5");
        byte[] buffer = new byte[256 * 1024];
        long size = 0;
        try (FileInputStream input = new FileInputStream(file)) {
            while (true) {
                int read = input.read(buffer);
                if (read < 0) break;
                md5.update(buffer, 0, read);
                sha1.update(buffer, 0, read);
                if (size < FIRST_CHUNK_LIMIT) {
                    int accepted = (int) Math.min(read, FIRST_CHUNK_LIMIT - size);
                    first.update(buffer, 0, accepted);
                }
                size += read;
            }
        }
        return new Result(size, md5.digest(), sha1.digest(), first.digest());
    }
}
