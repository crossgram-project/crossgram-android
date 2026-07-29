package org.telegram.messenger.crossgram_direct;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Pure-Java HTTP Range transport, kept independent so it can be exercised end-to-end on the JVM. */
public final class CrossgramDirectHttp {
    private CrossgramDirectHttp() {}

    public static byte[] loadRange(String url, long offset, int limit, HttpURLConnection[] handle) throws IOException {
        if (offset < 0 || limit <= 0) {
            throw new IllegalArgumentException("invalid byte range");
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        if (handle != null && handle.length > 0) {
            handle[0] = connection;
        }
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Range", "bytes=" + offset + "-" + (offset + limit - 1));
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_PARTIAL) {
                throw new IOException("direct HTTP expected 206, got " + status);
            }
            String contentRange = connection.getHeaderField("Content-Range");
            if (!startsAt(contentRange, offset)) {
                throw new IOException("direct HTTP returned invalid Content-Range: " + contentRange);
            }
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(limit, 64 * 1024))) {
                byte[] buffer = new byte[Math.min(limit, 32 * 1024)];
                int remaining = limit;
                while (remaining > 0) {
                    int count = input.read(buffer, 0, Math.min(buffer.length, remaining));
                    if (count < 0) break;
                    output.write(buffer, 0, count);
                    remaining -= count;
                }
                return output.toByteArray();
            }
        } finally {
            connection.disconnect();
            if (handle != null && handle.length > 0) {
                handle[0] = null;
            }
        }
    }

    static boolean startsAt(String contentRange, long offset) {
        if (contentRange == null) return false;
        String prefix = "bytes " + offset + "-";
        return contentRange.regionMatches(true, 0, prefix, 0, prefix.length());
    }
}
