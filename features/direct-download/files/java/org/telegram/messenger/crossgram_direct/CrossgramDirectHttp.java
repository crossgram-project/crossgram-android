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

/** One normal HTTP transfer shared by every part requested by FileLoadOperation. */
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
        private final File cacheFile;
        private final RandomAccessFile cache;
        private final Map<Integer, PendingRead> pending = new LinkedHashMap<>();
        private HttpURLConnection connection;
        private ScheduledFuture<?> cleanup;
        private long downloaded;
        private boolean complete;
        private boolean closed;
        private String failure;

        public Transfer(String url) throws IOException {
            this.url = url;
            cacheFile = File.createTempFile("crossgram-direct-", ".cache");
            cache = new RandomAccessFile(cacheFile, "rw");
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
            synchronized (this) {
                if (cleanup != null) {
                    cleanup.cancel(false);
                    cleanup = null;
                }
                pending.put(token, new PendingRead(token, offset, limit, callback));
                ready = collectReadyLocked();
                if (complete || failure != null) scheduleCleanupLocked();
            }
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
                int status = opened.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) {
                    throw new IOException("direct HTTP expected 200, got " + status);
                }
                try (InputStream input = opened.getInputStream()) {
                    byte[] buffer = new byte[64 * 1024];
                    while (true) {
                        int count = input.read(buffer);
                        if (count < 0) break;
                        if (count == 0) continue;
                        synchronized (this) {
                            if (closed) return;
                            cache.seek(downloaded);
                            cache.write(buffer, 0, count);
                            downloaded += count;
                            ready = collectReadyLocked();
                        }
                        runCompletions(ready);
                        ready = null;
                    }
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
                        cache.seek(read.offset);
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
