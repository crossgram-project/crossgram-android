package org.telegram.messenger.crossgram_upload;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;

/** Pure-Java hash pass shared by the upload patch and its host-side E2E test. */
public final class CrossgramFastUploadHash {
    private static final long FIRST_CHUNK_LIMIT = 10L * 1024 * 1024;
    private static final int SHA1_CHECKPOINT_SIZE = 1024 * 1024;

    public static final class Result {
        public final long size;
        public final byte[] md5;
        public final byte[] sha1;
        public final byte[] sha1Checkpoints;
        public final byte[] file10mMd5;

        Result(long size, byte[] md5, byte[] sha1, byte[] sha1Checkpoints, byte[] file10mMd5) {
            this.size = size;
            this.md5 = md5;
            this.sha1 = sha1;
            this.sha1Checkpoints = sha1Checkpoints;
            this.file10mMd5 = file10mMd5;
        }
    }

    private CrossgramFastUploadHash() {}

    public static Result compute(File file) throws Exception {
        MessageDigest md5 = MessageDigest.getInstance("MD5");
        MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
        MessageDigest first = MessageDigest.getInstance("MD5");
        Sha1IntermediateState sha1State = new Sha1IntermediateState();
        ByteArrayOutputStream sha1Checkpoints = new ByteArrayOutputStream();
        byte[] buffer = new byte[256 * 1024];
        long size = 0;
        try (FileInputStream input = new FileInputStream(file)) {
            while (true) {
                int read = input.read(buffer);
                if (read < 0) break;
                md5.update(buffer, 0, read);
                if (size < FIRST_CHUNK_LIMIT) {
                    int accepted = (int) Math.min(read, FIRST_CHUNK_LIMIT - size);
                    first.update(buffer, 0, accepted);
                }
                int offset = 0;
                while (offset < read) {
                    long processed = size + offset;
                    int accepted = (int) Math.min(
                            read - offset, SHA1_CHECKPOINT_SIZE - processed % SHA1_CHECKPOINT_SIZE);
                    sha1.update(buffer, offset, accepted);
                    sha1State.update(buffer, offset, accepted);
                    offset += accepted;
                    if ((size + offset) % SHA1_CHECKPOINT_SIZE == 0) {
                        sha1Checkpoints.write(sha1State.digestLittleEndian(), 0, 20);
                    }
                }
                size += read;
            }
        }
        byte[] finalSha1 = sha1.digest();
        byte[] checkpoints = sha1Checkpoints.toByteArray();
        if (size > 0 && size % SHA1_CHECKPOINT_SIZE == 0) {
            System.arraycopy(finalSha1, 0, checkpoints, checkpoints.length - 20, 20);
        } else {
            byte[] withFinal = new byte[checkpoints.length + 20];
            System.arraycopy(checkpoints, 0, withFinal, 0, checkpoints.length);
            System.arraycopy(finalSha1, 0, withFinal, checkpoints.length, 20);
            checkpoints = withFinal;
        }
        return new Result(size, md5.digest(), finalSha1, checkpoints, first.digest());
    }

    /** SHA-1 compression state before final padding, as required by QQ Highway. */
    private static final class Sha1IntermediateState {
        private int h0 = 0x67452301;
        private int h1 = 0xefcdab89;
        private int h2 = 0x98badcfe;
        private int h3 = 0x10325476;
        private int h4 = 0xc3d2e1f0;
        private final int[] words = new int[80];
        private final byte[] block = new byte[64];
        private int blockLength;

        void update(byte[] input, int offset, int length) {
            if (blockLength > 0) {
                int accepted = Math.min(length, block.length - blockLength);
                System.arraycopy(input, offset, block, blockLength, accepted);
                blockLength += accepted;
                offset += accepted;
                length -= accepted;
                if (blockLength == block.length) {
                    compress(block, 0);
                    blockLength = 0;
                }
            }
            while (length >= block.length) {
                compress(input, offset);
                offset += block.length;
                length -= block.length;
            }
            if (length > 0) {
                System.arraycopy(input, offset, block, 0, length);
                blockLength = length;
            }
        }

        byte[] digestLittleEndian() {
            if (blockLength != 0) {
                throw new IllegalStateException("SHA-1 checkpoint is not aligned to a compression block");
            }
            byte[] result = new byte[20];
            writeLittleEndian(result, 0, h0);
            writeLittleEndian(result, 4, h1);
            writeLittleEndian(result, 8, h2);
            writeLittleEndian(result, 12, h3);
            writeLittleEndian(result, 16, h4);
            return result;
        }

        private void compress(byte[] input, int inputOffset) {
            for (int index = 0; index < 16; index++) {
                int offset = inputOffset + index * 4;
                words[index] = (input[offset] & 0xff) << 24
                        | (input[offset + 1] & 0xff) << 16
                        | (input[offset + 2] & 0xff) << 8
                        | input[offset + 3] & 0xff;
            }
            for (int index = 16; index < 80; index++) {
                words[index] = Integer.rotateLeft(
                        words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16], 1);
            }
            int a = h0;
            int b = h1;
            int c = h2;
            int d = h3;
            int e = h4;
            for (int index = 0; index < 80; index++) {
                int value;
                int constant;
                if (index < 20) {
                    value = (b & c) | (~b & d);
                    constant = 0x5a827999;
                } else if (index < 40) {
                    value = b ^ c ^ d;
                    constant = 0x6ed9eba1;
                } else if (index < 60) {
                    value = (b & c) | (b & d) | (c & d);
                    constant = 0x8f1bbcdc;
                } else {
                    value = b ^ c ^ d;
                    constant = 0xca62c1d6;
                }
                int next = Integer.rotateLeft(a, 5) + value + e + constant + words[index];
                e = d;
                d = c;
                c = Integer.rotateLeft(b, 30);
                b = a;
                a = next;
            }
            h0 += a;
            h1 += b;
            h2 += c;
            h3 += d;
            h4 += e;
        }

        private static void writeLittleEndian(byte[] output, int offset, int value) {
            output[offset] = (byte) value;
            output[offset + 1] = (byte) (value >>> 8);
            output[offset + 2] = (byte) (value >>> 16);
            output[offset + 3] = (byte) (value >>> 24);
        }
    }
}
