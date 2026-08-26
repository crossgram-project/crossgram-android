package org.telegram.messenger.crossgram_direct;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/** Strictly recognizes the bridge references for which crossgram.getFileUrl is defined. */
final class CrossgramBridgeFileReference {
    private static final Pattern MEDIA = Pattern.compile("bridge-media:[1-9][0-9]*(?::[1-9][0-9]*)?");
    private static final Pattern STICKER = Pattern.compile(
            "bridge-sticker:[^:\\x00-\\x1f\\x7f]+:[^\\x00-\\x1f\\x7f]+:[0-9]+");
    private static final Pattern REACTION = Pattern.compile(
            "bridge-reaction-resource:[1-9][0-9]*:[0-9]+");

    private CrossgramBridgeFileReference() {}

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
