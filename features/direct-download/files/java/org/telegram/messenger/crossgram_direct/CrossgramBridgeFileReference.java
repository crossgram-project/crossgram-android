package org.telegram.messenger.crossgram_direct;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/** 校验文件引用是否属于支持 `crossgram.getFileUrl` 的服务端桥接资源 */
final class CrossgramBridgeFileReference {
    private static final Pattern MEDIA = Pattern.compile("bridge-media:[1-9][0-9]*");
    private static final Pattern STICKER = Pattern.compile(
            "bridge-sticker:[^:\\x00-\\x1f\\x7f]+:[^\\x00-\\x1f\\x7f]+:[0-9]+");
    private static final Pattern REACTION = Pattern.compile(
            "bridge-reaction-resource:[1-9][0-9]*:[0-9]+");

    private CrossgramBridgeFileReference() {}

    /**
     * 判断 bridge 文件声明的长度是否仅为上限数
     *
     * QQ 720 预览图常上报 0 字节, Telegram 拒绝 0 字节 PhotoSize, 故由 relay 按原图大小填充缩略图 `m` 预览; 其余资源长度均为精确结果
     */
    static boolean hasUpperBoundSize(byte[] reference, boolean photo, String thumbSize) {
        return photo && "m".equals(thumbSize) && supports(reference);
    }

    /** 对于长度仅为上限数的文件, 收到分块小于请求长度时即视为已到真实末尾 */
    static boolean endsAtShortPart(byte[] reference, boolean photo, String thumbSize,
            long received, long requested) {
        return received >= 0 && received < requested && hasUpperBoundSize(reference, photo, thumbSize);
    }

    /** 长度仅为上限数的文件完成后允许小于原声明长度, 但不得为空白文件 */
    static boolean acceptsShorterFile(byte[] reference, boolean photo, String thumbSize,
            long advertised, long actual) {
        return actual > 0 && actual < advertised && hasUpperBoundSize(reference, photo, thumbSize);
    }

    static boolean supports(byte[] reference) {
        if (reference == null || reference.length == 0) return false;
        final String value;
        try {
            value = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(reference))
                    .toString();
        } catch (CharacterCodingException ignored) {
            return false;
        }
        return MEDIA.matcher(value).matches()
                || STICKER.matcher(value).matches()
                || REACTION.matcher(value).matches();
    }
}
