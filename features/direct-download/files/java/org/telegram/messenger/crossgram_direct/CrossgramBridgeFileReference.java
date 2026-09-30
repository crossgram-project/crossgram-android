package org.telegram.messenger.crossgram_direct;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/** Strictly recognizes the bridge references for which crossgram.getFileUrl is defined. */
final class CrossgramBridgeFileReference {
    private static final Pattern MEDIA = Pattern.compile("bridge-media:[1-9][0-9]*");
    private static final Pattern STICKER = Pattern.compile(
            "bridge-sticker:[^:\\x00-\\x1f\\x7f]+:[^\\x00-\\x1f\\x7f]+:[0-9]+");
    private static final Pattern REACTION = Pattern.compile(
            "bridge-reaction-resource:[1-9][0-9]*:[0-9]+");

    private CrossgramBridgeFileReference() {}

    /**
     * Whether the advertised size of a bridge file is only an upper bound.
     *
     * QQ reports zero bytes for many native 720-tier previews and Telegram
     * rejects a zero-byte PhotoSize, so the relay publishes the photo `m`
     * preview with the original's byte count. Every other bridge size is exact.
     */
    static boolean hasUpperBoundSize(byte[] reference, boolean photo, String thumbSize) {
        return photo && "m".equals(thumbSize) && supports(reference);
    }

    /** A part shorter than requested is the real end of an upper-bound-sized file. */
    static boolean endsAtShortPart(byte[] reference, boolean photo, String thumbSize,
            long received, long requested) {
        return received >= 0 && received < requested && hasUpperBoundSize(reference, photo, thumbSize);
    }

    /** A finished upper-bound-sized file may be shorter than advertised, but never empty. */
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
