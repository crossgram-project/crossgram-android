package org.telegram.messenger.crossgram_direct;

import org.json.JSONObject;
import org.telegram.messenger.FileLog;
import org.telegram.messenger.Utilities;
import org.telegram.tgnet.ConnectionsManager;
import org.telegram.tgnet.InputSerializedData;
import org.telegram.tgnet.OutputSerializedData;
import org.telegram.tgnet.TLObject;
import org.telegram.tgnet.TLRPC;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** Crossgram 可选直连下载通道；任何异常均自动回退到 upload.getFile。 */
public final class CrossgramDirectDownload {
    public static final String TRANSPORT_DIRECT = "direct";
    public static final String TRANSPORT_RELAY = "relay";
    public static final String TRANSPORT_RESOLVING = "resolving";

    private static final int GET_FILE_URL_CONSTRUCTOR = 0x7520f6ea;
    private static final AtomicInteger NEXT_HTTP_TOKEN = new AtomicInteger(-1);
    private static final ConcurrentHashMap<Integer, Transfer> HTTP_REQUESTS = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, String> REPORTED_TRANSPORTS = new ConcurrentHashMap<>();

    public interface ResolveCallback {
        void onResult(ResolvedUrl result, String error);
    }

    public interface ReadCallback {
        void onResult(byte[] bytes, String error);
    }

    public static final class Transfer {
        private final CrossgramDirectHttp.Transfer http;

        private Transfer(CrossgramDirectHttp.Transfer http) {
            this.http = http;
        }
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
        // relay 本地生成的 `m` 级缩略图没有 QQ CDN 地址。
        // 旧版 relay 曾误返回原图地址，导致客户端按预览大小截断读取后只得到半截图片；因此 `m` 预览始终走 upload.getFile。
        if (location instanceof TLRPC.TL_inputPhotoFileLocation
                && "m".equals(location.thumb_size)) {
            return false;
        }
        return supportsFileReference(location.file_reference);
    }

    /** 在构造 InputFileLocation 前提前判断照片或文档是否来自 bridge。 */
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

    /**
     * 判断是否为固定走中转的 bridge 文件（如图片 `m` 预览），以便消息气泡仍能显示「中转」角标。
     */
    public static boolean isRelayOnlyBridgeFile(TLRPC.InputFileLocation location) {
        return (location instanceof TLRPC.TL_inputDocumentFileLocation
                || location instanceof TLRPC.TL_inputPhotoFileLocation)
                && supportsFileReference(location.file_reference)
                && !supports(location);
    }

    /**
     * 判断该 bridge 文件声明的大小是否仅为上限值（即图片 `m` 预览，详见 CrossgramBridgeFileReference）。
     *
     * Telegram 顺序拼装器对已知大小的文件必须读满声明字节数才会结束；
     * 若 relay 提前返回短尾块，后续请求会一直卡在不会到达的偏移量上并占死下载队列槽位，直到应用重启。
     */
    public static boolean hasUpperBoundSize(TLRPC.InputFileLocation location) {
        return location != null && CrossgramBridgeFileReference.hasUpperBoundSize(
                location.file_reference, location instanceof TLRPC.TL_inputPhotoFileLocation, location.thumb_size);
    }

    /** 对大小仅为上限值的文件，当 relay 返回的分块小于请求长度时即视为到达文件末尾。 */
    public static boolean endsAtShortPart(TLRPC.InputFileLocation location, long received, long requested) {
        return location != null && CrossgramBridgeFileReference.endsAtShortPart(
                location.file_reference, location instanceof TLRPC.TL_inputPhotoFileLocation, location.thumb_size,
                received, requested);
    }

    /** 保留已下载完成的上限大小预览图，避免因实际长度小于声明长度而被当成损坏文件删掉。 */
    public static boolean acceptsShorterFinalFile(TLRPC.InputFileLocation location, long advertised, long actual) {
        return location != null && CrossgramBridgeFileReference.acceptsShorterFile(
                location.file_reference, location instanceof TLRPC.TL_inputPhotoFileLocation, location.thumb_size,
                advertised, actual);
    }

    public static void reportShortEnd(String fileName, long downloaded, long advertised) {
        FileLog.d("crossgram_download_short_end file=" + fileName
                + " bytes=" + downloaded + " advertised=" + advertised);
    }

    /** 清除旧状态并将当前文件标记为「连接中」，供消息气泡角标展示。 */
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
                        || expiresAt <= System.currentTimeMillis()) {
                    throw new IllegalArgumentException("invalid direct URL metadata");
                }
                callback.onResult(new ResolvedUrl(url, expiresAt), null);
            } catch (Exception parseError) {
                callback.onResult(null, "DIRECT_URL_INVALID_JSON");
            }
        }, null, null, 0, dcId, ConnectionsManager.ConnectionTypeGeneric, true);
    }

    public static Transfer open(String url) {
        return open(url, 0);
    }

    /** 打开直连传输并指定期望总字节数 {@code expectedLength}，未读满前不视为正常结束。 */
    public static Transfer open(String url, long expectedLength) {
        try {
            return new Transfer(new CrossgramDirectHttp.Transfer(url, expectedLength));
        } catch (Exception error) {
            return null;
        }
    }

    public static int read(Transfer transfer, long offset, int limit, ReadCallback callback) {
        if (transfer == null) {
            callback.onResult(null, "DIRECT_HTTP_NOT_OPEN");
            return 0;
        }
        int token = NEXT_HTTP_TOKEN.getAndDecrement();
        HTTP_REQUESTS.put(token, transfer);
        transfer.http.read(token, offset, limit, (bytes, error) -> {
            if (HTTP_REQUESTS.remove(token) != transfer) return;
            Utilities.stageQueue.postRunnable(() -> callback.onResult(bytes, error));
        });
        return token;
    }

    public static void close(Transfer transfer) {
        if (transfer == null) return;
        for (Integer token : HTTP_REQUESTS.keySet()) {
            if (HTTP_REQUESTS.remove(token, transfer)) transfer.http.cancel(token);
        }
        transfer.http.close();
    }

    public static void cancelRequest(int account, int token, boolean notifyServer) {
        cancelRequest(account, token, notifyServer, null);
    }

    public static void cancelRequest(int account, int token, boolean notifyServer, Runnable callback) {
        Transfer transfer = HTTP_REQUESTS.remove(token);
        if (transfer == null) {
            ConnectionsManager.getInstance(account).cancelRequest(token, notifyServer, callback);
            return;
        }
        transfer.http.cancel(token);
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
