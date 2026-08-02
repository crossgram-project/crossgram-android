package org.telegram.messenger.crossgram_direct;

import org.json.JSONObject;
import org.telegram.messenger.FileLog;
import org.telegram.messenger.Utilities;
import org.telegram.tgnet.ConnectionsManager;
import org.telegram.tgnet.InputSerializedData;
import org.telegram.tgnet.OutputSerializedData;
import org.telegram.tgnet.TLObject;
import org.telegram.tgnet.TLRPC;

import java.net.HttpURLConnection;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** Crossgram's optional direct-download transport. Every failure falls back to upload.getFile. */
public final class CrossgramDirectDownload {
    public static final String TRANSPORT_DIRECT = "direct";
    public static final String TRANSPORT_RELAY = "relay";
    public static final String TRANSPORT_RESOLVING = "resolving";

    private static final int GET_FILE_URL_CONSTRUCTOR = 0x7520f6ea;
    private static final AtomicInteger NEXT_HTTP_TOKEN = new AtomicInteger(-1);
    private static final ConcurrentHashMap<Integer, HttpURLConnection[]> HTTP_REQUESTS = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, String> REPORTED_TRANSPORTS = new ConcurrentHashMap<>();

    public interface ResolveCallback {
        void onResult(ResolvedUrl result, String error);
    }

    public interface RangeCallback {
        void onResult(byte[] bytes, String error);
    }

    public static final class ResolvedUrl {
        public final String url;
        public final long expiresAt;

        ResolvedUrl(String url, long expiresAt) {
            this.url = url;
            this.expiresAt = expiresAt;
        }
    }

    private CrossgramDirectDownload() {}

    public static boolean supports(TLRPC.InputFileLocation location) {
        if (!(location instanceof TLRPC.TL_inputDocumentFileLocation)
                && !(location instanceof TLRPC.TL_inputPhotoFileLocation)) {
            return false;
        }
        // The relay's generated `m` preview is stored locally and has no QQ CDN URL.
        // Older relays returned the original image URL here, which produced a valid
        // file header followed by a truncated image when Android requested the
        // advertised preview size. Keep previews on upload.getFile on every version.
        if (location instanceof TLRPC.TL_inputPhotoFileLocation
                && "m".equals(location.thumb_size)) {
            return false;
        }
        return supportsFileReference(location.file_reference);
    }

    /** Returns true for bridge-backed photos/documents before an InputFileLocation is constructed. */
    public static boolean supports(Object parentObject) {
        if (parentObject instanceof TLRPC.Photo) {
            return supportsFileReference(((TLRPC.Photo) parentObject).file_reference);
        }
        if (parentObject instanceof TLRPC.Document) {
            return supportsFileReference(((TLRPC.Document) parentObject).file_reference);
        }
        return false;
    }

    private static boolean supportsFileReference(byte[] reference) {
        return CrossgramBridgeFileReference.supports(reference);
    }

    /** Clears a stale result and exposes URL resolution to the message-cell indicator. */
    public static void begin(String fileName) {
        setReportedTransport(fileName, TRANSPORT_RESOLVING);
    }

    public static String getReportedTransport(String fileName) {
        return fileName == null ? null : REPORTED_TRANSPORTS.get(fileName);
    }

    public static void resolve(int account, int dcId, TLRPC.InputFileLocation location, ResolveCallback callback) {
        GetFileUrl request = new GetFileUrl();
        request.location = location;
        ConnectionsManager.getInstance(account).sendRequest(request, (response, error) -> {
            if (!(response instanceof TLRPC.TL_dataJSON)) {
                callback.onResult(null, error != null ? error.text : "DIRECT_URL_INVALID_RESPONSE");
                return;
            }
            try {
                JSONObject json = new JSONObject(((TLRPC.TL_dataJSON) response).data);
                String url = json.getString("url");
                long expiresAt = json.getLong("expiresAt");
                if ((!url.startsWith("https://") && !url.startsWith("http://"))
                        || expiresAt <= System.currentTimeMillis()
                        || !json.optBoolean("supportsRange", false)) {
                    throw new IllegalArgumentException("invalid direct URL metadata");
                }
                callback.onResult(new ResolvedUrl(url, expiresAt), null);
            } catch (Exception parseError) {
                callback.onResult(null, "DIRECT_URL_INVALID_JSON");
            }
        }, null, null, 0, dcId, ConnectionsManager.ConnectionTypeGeneric, true);
    }

    public static int loadRange(String url, long offset, int limit, RangeCallback callback) {
        int token = NEXT_HTTP_TOKEN.getAndDecrement();
        HttpURLConnection[] handle = new HttpURLConnection[1];
        HTTP_REQUESTS.put(token, handle);
        Utilities.globalQueue.postRunnable(() -> {
            byte[] result = null;
            String error = null;
            try {
                result = CrossgramDirectHttp.loadRange(url, offset, limit, handle);
            } catch (Exception exception) {
                error = exception.getMessage() != null ? exception.getMessage() : exception.getClass().getSimpleName();
            }
            if (HTTP_REQUESTS.remove(token) != handle) return;
            byte[] finalResult = result;
            String finalError = error;
            Utilities.stageQueue.postRunnable(() -> callback.onResult(finalResult, finalError));
        });
        return token;
    }

    public static void cancelRequest(int account, int token, boolean notifyServer) {
        cancelRequest(account, token, notifyServer, null);
    }

    public static void cancelRequest(int account, int token, boolean notifyServer, Runnable callback) {
        HttpURLConnection[] handle = HTTP_REQUESTS.remove(token);
        if (handle == null) {
            ConnectionsManager.getInstance(account).cancelRequest(token, notifyServer, callback);
            return;
        }
        if (handle[0] != null) handle[0].disconnect();
        if (callback != null) Utilities.stageQueue.postRunnable(callback);
    }

    public static void failNotRunningRequest(int account, int token) {
        if (token < 0) {
            cancelRequest(account, token, true);
        } else {
            ConnectionsManager.getInstance(account).failNotRunningRequest(token);
        }
    }

    public static void report(String fileName, String transport, String reason) {
        setReportedTransport(fileName, transport);
        FileLog.d("crossgram_download_transport=" + transport + " file=" + fileName + " reason=" + reason);
    }

    private static void setReportedTransport(String fileName, String transport) {
        if (fileName == null || fileName.isEmpty()) return;
        if (REPORTED_TRANSPORTS.size() >= 512 && !REPORTED_TRANSPORTS.containsKey(fileName)) {
            REPORTED_TRANSPORTS.clear();
        }
        REPORTED_TRANSPORTS.put(fileName, transport);
    }

    private static final class GetFileUrl extends TLObject {
        TLRPC.InputFileLocation location;

        @Override
        public TLObject deserializeResponse(InputSerializedData stream, int constructor, boolean exception) {
            return TLRPC.TL_dataJSON.TLdeserialize(stream, constructor, exception);
        }

        @Override
        public void serializeToStream(OutputSerializedData stream) {
            stream.writeInt32(GET_FILE_URL_CONSTRUCTOR);
            location.serializeToStream(stream);
        }
    }
}
