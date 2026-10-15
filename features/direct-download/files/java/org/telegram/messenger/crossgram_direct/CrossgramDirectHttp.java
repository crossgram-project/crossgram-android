package org.telegram.messenger.crossgram_direct;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

/** 单次 FileLoadOperation 的所有分块请求共用的单条常规 HTTP 传输 */
public final class CrossgramDirectHttp {
    public interface ReadCallback {
        void onResult(byte[] bytes, String error);
    }

    private static final ScheduledExecutorService CLEANUP = Executors.newSingleThreadScheduledExecutor(
            new ThreadFactory() {
                @Override
                public Thread newThread(Runnable runnable) {
                    Thread thread = new Thread(runnable, "crossgram-direct-cleanup");
                    thread.setDaemon(true);
                    return thread;
                }
            });

    private CrossgramDirectHttp() {}

    public static final class Transfer implements AutoCloseable {
        private static final long IDLE_CLOSE_MINUTES = 10;

        private final String url;
        /** 服务端声明的文件长度 (未知时为 0), 避免响应流提前结束被误判成真 EOF */
        private final long expectedLength;
        private final File cacheFile;
        private final RandomAccessFile cache;
        private final Map<Integer, PendingRead> pending = new LinkedHashMap<>();
        private HttpURLConnection connection;
        private ScheduledFuture<?> cleanup;
        private long baseOffset = -1;
        private long downloaded;
        private boolean complete;
        private boolean closed;
        private String failure;

        public Transfer(String url) throws IOException {
            this(url, 0);
        }

        public Transfer(String url, long expectedLength) throws IOException {
            this.url = url;
            this.expectedLength = Math.max(0, expectedLength);
            cacheFile = File.createTempFile("crossgram-direct-", ".cache");
            cache = new RandomAccessFile(cacheFile, "rw");
        }

        private void start() {
            Thread worker = new Thread(new Runnable() {
                @Override
                public void run() {
                    download();
                }
            }, "crossgram-direct-http");
            worker.setDaemon(true);
            worker.start();
        }

        public void read(int token, long offset, int limit, ReadCallback callback) {
            if (offset < 0 || limit <= 0) {
                callback.onResult(null, "invalid byte range");
                return;
            }
            List<Completion> ready;
            boolean start = false;
            synchronized (this) {
                if (cleanup != null) {
                    cleanup.cancel(false);
                    cleanup = null;
                }
                if (baseOffset < 0) {
                    baseOffset = offset;
                    downloaded = offset;
                    start = true;
                } else if (offset < baseOffset) {
                    callback.onResult(null, "requested offset precedes direct HTTP resume point");
                    return;
                }
                pending.put(token, new PendingRead(token, offset, limit, callback));
                ready = collectReadyLocked();
                if (complete || failure != null) scheduleCleanupLocked();
            }
            if (start) start();
            runCompletions(ready);
        }

        public synchronized void cancel(int token) {
            pending.remove(token);
        }

        @Override
        public void close() {
            List<Completion> cancelled;
            synchronized (this) {
                if (closed) return;
                closed = true;
                if (cleanup != null) cleanup.cancel(false);
                cleanup = null;
                if (connection != null) connection.disconnect();
                failure = "direct HTTP transfer cancelled";
                cancelled = collectReadyLocked();
                try {
                    cache.close();
                } catch (IOException ignored) {
                }
            }
            runCompletions(cancelled);
            cacheFile.delete();
        }

        private void download() {
            List<Completion> ready = null;
            try {
                HttpURLConnection opened = (HttpURLConnection) new URL(url).openConnection();
                synchronized (this) {
                    if (closed) {
                        opened.disconnect();
                        return;
                    }
                    connection = opened;
                }
                opened.setInstanceFollowRedirects(true);
                opened.setConnectTimeout(15_000);
                opened.setReadTimeout(30_000);
                opened.setRequestProperty("Accept-Encoding", "identity");
                if (baseOffset > 0) {
                    opened.setRequestProperty("Range", "bytes=" + baseOffset + "-");
                }
                int status = opened.getResponseCode();
                if (!validResponse(opened, status, baseOffset)) {
                    throw new IOException("direct HTTP could not resume at " + baseOffset + ", got " + status);
                }
                // Telegram 将小于请求长度的分块当成文件末尾, 若响应体提前截断却标记为完成, 半截图片就会永久写进缓存
                long expectedEnd = expectedEnd(opened, baseOffset, expectedLength);
                try (InputStream input = opened.getInputStream()) {
                    byte[] buffer = new byte[64 * 1024];
                    while (true) {
                        int count = input.read(buffer);
                        if (count < 0) break;
                        if (count == 0) continue;
                        synchronized (this) {
                            if (closed) return;
                            cache.seek(downloaded - baseOffset);
                            cache.write(buffer, 0, count);
                            downloaded += count;
                            ready = collectReadyLocked();
                        }
                        runCompletions(ready);
                        ready = null;
                    }
                }
                if (expectedEnd > 0 && downloaded < expectedEnd) {
                    throw new IOException("direct HTTP body ended at " + downloaded + " of " + expectedEnd + " bytes");
                }
                synchronized (this) {
                    complete = true;
                    ready = collectReadyLocked();
                    scheduleCleanupLocked();
                }
            } catch (Exception error) {
                synchronized (this) {
                    if (!closed) {
                        failure = error.getMessage() != null ? error.getMessage() : error.getClass().getSimpleName();
                        ready = collectReadyLocked();
                        scheduleCleanupLocked();
                    }
                }
            } finally {
                synchronized (this) {
                    if (connection != null) connection.disconnect();
                    connection = null;
                }
                runCompletions(ready);
            }
        }

        private List<Completion> collectReadyLocked() {
            List<Completion> result = new ArrayList<>();
            for (java.util.Iterator<Map.Entry<Integer, PendingRead>> iterator = pending.entrySet().iterator();
                    iterator.hasNext();) {
                PendingRead read = iterator.next().getValue();
                if (failure != null || closed) {
                    iterator.remove();
                    result.add(new Completion(read.callback, null,
                            failure != null ? failure : "direct HTTP transfer cancelled"));
                    continue;
                }
                long available = Math.max(0, downloaded - read.offset);
                if (available < read.limit && !complete) continue;
                int count = (int) Math.min((long) read.limit, available);
                byte[] bytes = new byte[count];
                try {
                    if (count > 0) {
                        cache.seek(read.offset - baseOffset);
                        cache.readFully(bytes);
                    }
                    iterator.remove();
                    result.add(new Completion(read.callback, bytes, null));
                } catch (IOException error) {
                    iterator.remove();
                    result.add(new Completion(read.callback, null,
                            error.getMessage() != null ? error.getMessage() : error.getClass().getSimpleName()));
                }
            }
            return result;
        }

        private void scheduleCleanupLocked() {
            if (cleanup != null) cleanup.cancel(false);
            cleanup = CLEANUP.schedule(new Runnable() {
                @Override
                public void run() {
                    close();
                }
            }, IDLE_CLOSE_MINUTES, TimeUnit.MINUTES);
        }
    }

    private static void runCompletions(List<Completion> completions) {
        if (completions == null) return;
        for (Completion completion : completions) {
            completion.callback.onResult(completion.bytes, completion.error);
        }
    }

    /**
     * 响应流必须读到的绝对结束偏移: 取由 relay 声明的大小与 Content-Length 推算结束位置中的较大结果; 均未知时返回 0 (按响应流本身 EOF 结束)
     */
    static long expectedEnd(HttpURLConnection connection, long offset, long expectedLength) {
        long contentLength = connection.getContentLengthLong();
        long fromHeader = contentLength > 0 ? Math.max(0, offset) + contentLength : 0;
        return Math.max(fromHeader, expectedLength);
    }

    private static boolean validResponse(HttpURLConnection connection, int status, long offset) {
        if (offset == 0 && status == HttpURLConnection.HTTP_OK) return true;
        if (status != HttpURLConnection.HTTP_PARTIAL) return false;
        String contentRange = connection.getHeaderField("Content-Range");
        if (contentRange == null) return false;
        String prefix = "bytes " + offset + "-";
        return contentRange.regionMatches(true, 0, prefix, 0, prefix.length());
    }

    private static final class PendingRead {
        final int token;
        final long offset;
        final int limit;
        final ReadCallback callback;

        PendingRead(int token, long offset, int limit, ReadCallback callback) {
            this.token = token;
            this.offset = offset;
            this.limit = limit;
            this.callback = callback;
        }
    }

    private static final class Completion {
        final ReadCallback callback;
        final byte[] bytes;
        final String error;

        Completion(ReadCallback callback, byte[] bytes, String error) {
            this.callback = callback;
            this.bytes = bytes;
            this.error = error;
        }
    }
}
