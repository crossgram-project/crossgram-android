package org.telegram.messenger.crossgram_upload;

import android.webkit.MimeTypeMap;

import org.telegram.messenger.FileLog;
import org.telegram.messenger.MessagesController;
import org.telegram.messenger.Utilities;
import org.telegram.tgnet.ConnectionsManager;
import org.telegram.tgnet.InputSerializedData;
import org.telegram.tgnet.OutputSerializedData;
import org.telegram.tgnet.TLObject;
import org.telegram.tgnet.TLRPC;

import java.io.File;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/** Hash-first Crossgram upload probe. A miss or any error falls back to saveFilePart. */
public final class CrossgramFastUpload {
    private static final int PREPARE_MEDIA_UPLOAD_CONSTRUCTOR = 0xf75adc0e;
    private static final int MAX_TARGETS = 512;
    private static final ConcurrentHashMap<String, Target> TARGETS = new ConcurrentHashMap<>();

    public interface Callback {
        void onResult(Result result);
    }

    public static final class Result {
        public final long fileId;
        public final long size;
        public final String name;
        public final boolean big;

        Result(long fileId, long size, String name) {
            this.fileId = fileId;
            this.size = size;
            this.name = name;
            this.big = size > 10L * 1024 * 1024;
        }
    }

    private static final class Target {
        final int account;
        final long dialogId;

        Target(int account, long dialogId) {
            this.account = account;
            this.dialogId = dialogId;
        }
    }

    private CrossgramFastUpload() {}

    public static void bind(String path, int account, long dialogId) {
        if (path == null || path.isEmpty() || dialogId == 0) return;
        if (TARGETS.size() >= MAX_TARGETS && !TARGETS.containsKey(path)) TARGETS.clear();
        TARGETS.put(path, new Target(account, dialogId));
    }

    public static boolean prepare(int account, String path, long fileId, int fileType, Callback callback) {
        Target target = TARGETS.remove(path);
        if (target == null || target.account != account) return false;
        File file = new File(path);
        if (!file.isFile() || file.length() <= 0) return false;
        TLRPC.InputPeer peer = MessagesController.getInstance(account).getInputPeer(target.dialogId);
        if (peer == null || peer instanceof TLRPC.TL_inputPeerEmpty) return false;
        Utilities.globalQueue.postRunnable(() -> {
            try {
                CrossgramFastUploadHash.Result hashes = CrossgramFastUploadHash.compute(file);
                PrepareMediaUpload request = new PrepareMediaUpload();
                request.peer = peer;
                request.fileId = fileId;
                request.name = file.getName();
                request.size = hashes.size;
                request.kind = fileType == ConnectionsManager.FileTypePhoto ? "image"
                        : fileType == ConnectionsManager.FileTypeVideo ? "video" : "file";
                request.mimeType = mimeType(request.name);
                request.md5 = hashes.md5;
                request.sha1 = hashes.sha1;
                request.file10mMd5 = hashes.file10mMd5;
                ConnectionsManager.getInstance(account).sendRequest(request, (response, error) -> {
                    boolean hit = response instanceof TLRPC.TL_boolTrue;
                    Utilities.stageQueue.postRunnable(() -> callback.onResult(
                            hit ? new Result(fileId, hashes.size, request.name) : null));
                });
            } catch (Exception error) {
                FileLog.e(error);
                Utilities.stageQueue.postRunnable(() -> callback.onResult(null));
            }
        });
        return true;
    }

    private static String mimeType(String name) {
        int dot = name.lastIndexOf('.');
        String extension = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        String resolved = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return resolved != null ? resolved : "application/octet-stream";
    }

    private static final class PrepareMediaUpload extends TLObject {
        TLRPC.InputPeer peer;
        long fileId;
        String name;
        long size;
        String kind;
        String mimeType;
        byte[] md5;
        byte[] sha1;
        byte[] file10mMd5;

        @Override
        public TLObject deserializeResponse(InputSerializedData stream, int constructor, boolean exception) {
            return TLRPC.Bool.TLdeserialize(stream, constructor, exception);
        }

        @Override
        public void serializeToStream(OutputSerializedData stream) {
            stream.writeInt32(PREPARE_MEDIA_UPLOAD_CONSTRUCTOR);
            peer.serializeToStream(stream);
            stream.writeInt64(fileId);
            stream.writeString(name);
            stream.writeInt64(size);
            stream.writeString(kind);
            stream.writeString(mimeType);
            stream.writeByteArray(md5);
            stream.writeByteArray(sha1);
            stream.writeByteArray(file10mMd5);
            stream.writeInt32(0);
            stream.writeInt32(0);
            stream.writeDouble(0);
        }
    }
}
