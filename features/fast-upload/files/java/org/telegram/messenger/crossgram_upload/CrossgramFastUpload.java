package org.telegram.messenger.crossgram_upload;

import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.webkit.MimeTypeMap;

import org.telegram.messenger.FileLog;
import org.telegram.messenger.MessagesController;
import org.telegram.messenger.Utilities;
import org.telegram.tgnet.ConnectionsManager;
import org.telegram.tgnet.InputSerializedData;
import org.telegram.tgnet.OutputSerializedData;
import org.telegram.tgnet.TLObject;
import org.telegram.tgnet.TLRPC;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/** Hash-first Crossgram upload probe. A miss or any error falls back to saveFilePart. */
public final class CrossgramFastUpload {
    private static final int PREPARE_MEDIA_UPLOAD_V3_CONSTRUCTOR = 0xf75adc10;
    private static final int VIDEO_THUMBNAIL_MAX_SIDE = 320;
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
                request.sha1Checkpoints = hashes.sha1Checkpoints;
                request.file10mMd5 = hashes.file10mMd5;
                VideoMetadata metadata = fileType == ConnectionsManager.FileTypeVideo
                        ? videoMetadata(file) : VideoMetadata.EMPTY;
                request.width = metadata.width;
                request.height = metadata.height;
                request.duration = metadata.duration;
                request.thumbnail = metadata.thumbnail;
                request.thumbnailWidth = metadata.thumbnailWidth;
                request.thumbnailHeight = metadata.thumbnailHeight;
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

    private static VideoMetadata videoMetadata(File file) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        Bitmap frame = null;
        Bitmap thumbnail = null;
        try {
            retriever.setDataSource(file.getAbsolutePath());
            int width = positiveInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            int height = positiveInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            int rotation = positiveInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION));
            if ((rotation == 90 || rotation == 270) && width > 0 && height > 0) {
                int swap = width;
                width = height;
                height = swap;
            }
            long durationMs = positiveLong(
                    retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            byte[] thumbnailBytes = new byte[0];
            int thumbnailWidth = 0;
            int thumbnailHeight = 0;
            if (frame != null && frame.getWidth() > 0 && frame.getHeight() > 0) {
                double scale = Math.min(1.0, (double) VIDEO_THUMBNAIL_MAX_SIDE
                        / Math.max(frame.getWidth(), frame.getHeight()));
                thumbnailWidth = Math.max(1, (int) Math.round(frame.getWidth() * scale));
                thumbnailHeight = Math.max(1, (int) Math.round(frame.getHeight() * scale));
                thumbnail = scale < 1.0
                        ? Bitmap.createScaledBitmap(frame, thumbnailWidth, thumbnailHeight, true)
                        : frame;
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (thumbnail.compress(Bitmap.CompressFormat.JPEG, 82, output)) {
                    thumbnailBytes = output.toByteArray();
                } else {
                    thumbnailWidth = 0;
                    thumbnailHeight = 0;
                }
            }
            return new VideoMetadata(width, height, durationMs / 1000.0,
                    thumbnailBytes, thumbnailWidth, thumbnailHeight);
        } catch (Exception error) {
            FileLog.e(error);
            return VideoMetadata.EMPTY;
        } finally {
            if (thumbnail != null && thumbnail != frame) thumbnail.recycle();
            if (frame != null) frame.recycle();
            try {
                retriever.release();
            } catch (Exception ignore) {}
        }
    }

    private static int positiveInt(String value) {
        try {
            int parsed = Integer.parseInt(value);
            return Math.max(parsed, 0);
        } catch (Exception ignore) {
            return 0;
        }
    }

    private static long positiveLong(String value) {
        try {
            long parsed = Long.parseLong(value);
            return Math.max(parsed, 0);
        } catch (Exception ignore) {
            return 0;
        }
    }

    private static final class VideoMetadata {
        static final VideoMetadata EMPTY = new VideoMetadata(0, 0, 0, new byte[0], 0, 0);
        final int width;
        final int height;
        final double duration;
        final byte[] thumbnail;
        final int thumbnailWidth;
        final int thumbnailHeight;

        VideoMetadata(int width, int height, double duration, byte[] thumbnail,
                int thumbnailWidth, int thumbnailHeight) {
            this.width = width;
            this.height = height;
            this.duration = duration;
            this.thumbnail = thumbnail;
            this.thumbnailWidth = thumbnailWidth;
            this.thumbnailHeight = thumbnailHeight;
        }
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
        byte[] sha1Checkpoints;
        byte[] file10mMd5;
        int width;
        int height;
        double duration;
        byte[] thumbnail;
        int thumbnailWidth;
        int thumbnailHeight;

        @Override
        public TLObject deserializeResponse(InputSerializedData stream, int constructor, boolean exception) {
            return TLRPC.Bool.TLdeserialize(stream, constructor, exception);
        }

        @Override
        public void serializeToStream(OutputSerializedData stream) {
            stream.writeInt32(PREPARE_MEDIA_UPLOAD_V3_CONSTRUCTOR);
            peer.serializeToStream(stream);
            stream.writeInt64(fileId);
            stream.writeString(name);
            stream.writeInt64(size);
            stream.writeString(kind);
            stream.writeString(mimeType);
            stream.writeByteArray(md5);
            stream.writeByteArray(sha1);
            stream.writeByteArray(sha1Checkpoints);
            stream.writeByteArray(file10mMd5);
            stream.writeInt32(width);
            stream.writeInt32(height);
            stream.writeDouble(duration);
            stream.writeByteArray(thumbnail);
            stream.writeInt32(thumbnailWidth);
            stream.writeInt32(thumbnailHeight);
        }
    }
}
