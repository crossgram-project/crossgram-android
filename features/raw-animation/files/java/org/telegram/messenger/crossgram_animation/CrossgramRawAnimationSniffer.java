package org.telegram.messenger.crossgram_animation;

import java.io.EOFException;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

/** Lightweight PNG chunk sniffer used after a direct download has completed. */
public final class CrossgramRawAnimationSniffer {
    private static final byte[] PNG_SIGNATURE = new byte[] {
            (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    };
    private static final int MAX_CHUNK_BYTES = 64 * 1024 * 1024;

    private CrossgramRawAnimationSniffer() {}

    public static boolean isGif(File file) {
        if (file == null || !file.isFile()) return false;
        byte[] header = new byte[6];
        try (InputStream input = new FileInputStream(file)) {
            readFully(input, header, 0, header.length);
            return (header[0] == 'G' && header[1] == 'I' && header[2] == 'F'
                    && header[3] == '8' && (header[4] == '7' || header[4] == '9')
                    && header[5] == 'a');
        } catch (IOException ignored) {
            return false;
        }
    }

    public static boolean isAnimatedPng(File file) {
        if (file == null || !file.isFile()) return false;
        try (InputStream input = new FileInputStream(file)) {
            return isAnimatedPng(input);
        } catch (IOException ignored) {
            return false;
        }
    }

    static boolean isAnimatedPng(InputStream input) throws IOException {
        byte[] signature = new byte[PNG_SIGNATURE.length];
        readFully(input, signature, 0, signature.length);
        for (int i = 0; i < PNG_SIGNATURE.length; i++) {
            if (signature[i] != PNG_SIGNATURE[i]) return false;
        }

        byte[] header = new byte[8];
        while (true) {
            readFully(input, header, 0, header.length);
            long length = ((long) (header[0] & 0xff) << 24)
                    | ((long) (header[1] & 0xff) << 16)
                    | ((long) (header[2] & 0xff) << 8)
                    | (header[3] & 0xffL);
            if (length > MAX_CHUNK_BYTES) return false;
            int type = ((header[4] & 0xff) << 24)
                    | ((header[5] & 0xff) << 16)
                    | ((header[6] & 0xff) << 8)
                    | (header[7] & 0xff);
            if (type == 0x6163544c) { // acTL
                return length == 8;
            }
            if (type == 0x49444154 || type == 0x49454e44) { // IDAT / IEND
                return false;
            }
            skipFully(input, length + 4); // data + CRC
        }
    }

    private static void readFully(InputStream input, byte[] bytes, int offset, int length)
            throws IOException {
        while (length > 0) {
            int count = input.read(bytes, offset, length);
            if (count < 0) throw new EOFException("truncated PNG");
            offset += count;
            length -= count;
        }
    }

    private static void skipFully(InputStream input, long length) throws IOException {
        while (length > 0) {
            long skipped = input.skip(length);
            if (skipped <= 0) {
                if (input.read() < 0) throw new EOFException("truncated PNG chunk");
                skipped = 1;
            }
            length -= skipped;
        }
    }
}
