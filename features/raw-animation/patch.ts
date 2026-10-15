import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { PatchError, addJavaImport, editDeclarationBody, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const messageObjectFile = "TMessagesProj/src/main/java/org/telegram/messenger/MessageObject.java";
const imageLoaderFile = "TMessagesProj/src/main/java/org/telegram/messenger/ImageLoader.java";
const animatedEmojiFile = "TMessagesProj/src/main/java/org/telegram/ui/Components/AnimatedEmojiDrawable.java";
const gifVideoFile = "TMessagesProj/jni/gifvideo.cpp";
const snifferRelative = "org/telegram/messenger/crossgram_animation/CrossgramRawAnimationSniffer.java";
const ffmpegScripts = [
  // 覆盖各上游从源码编译 FFmpeg 的脚本路径（官方分支在原位置，Nagram 迁到 jni/third_party，Forkgram 和 Mercurygram 走 jni/prebuild）。
  "TMessagesProj/jni/build_ffmpeg_clang.sh",
  "TMessagesProj/jni/ffmpeg/build_ffmpeg/build_ffmpeg.sh",
  "TMessagesProj/jni/third_party/build_ffmpeg.sh",
  "TMessagesProj/jni/prebuild/build_ffmpeg.sh",
] as const;

export function patchMessageObjectRawAnimation(initial: string): string {
  let source = initial.replaceAll(
    "isAnyKindOfStickerOrEmoji(document)",
    "isCrossgramStickerOrEmojiDocument(document)",
  );
  source = editDeclarationBody(
    source,
    /public\s+static\s+boolean\s+isGifDocument\s*\(\s*WebFile\s+document\s*\)/,
    messageObjectFile,
    "MessageObject.isGifDocument(WebFile)",
    (body) => body.replace(
      /return\s+document\s*!=\s*null\s*&&\s*\(document\.mime_type\.equals\("image\/gif"\)\s*\|\|\s*isNewGifDocument\(document\)\s*\);/,
      'return document != null && (document.mime_type.equals("image/gif") || document.mime_type.equals("image/apng") || isNewGifDocument(document));',
    ),
  );
  source = editDeclarationBody(
    source,
    /public\s+static\s+boolean\s+isGifDocument\s*\(\s*TLRPC\.Document\s+document\s*,\s*boolean\s+hasGroup\s*\)/,
    messageObjectFile,
    "MessageObject.isGifDocument(Document, boolean)",
    (body) => body.replace(
      /return\s+document\s*!=\s*null\s*&&\s*document\.mime_type\s*!=\s*null\s*&&\s*\(document\.mime_type\.equals\("image\/gif"\)\s*&&\s*!hasGroup\s*\|\|\s*isNewGifDocument\(document\)\s*\);/,
      'return document != null && document.mime_type != null && ((document.mime_type.equals("image/gif") || isAnimatedPngDocument(document)) && !hasGroup && !isCrossgramStickerOrEmojiDocument(document) || isNewGifDocument(document));',
    ),
  );
  source = editDeclarationBody(
    source,
    /public\s+static\s+boolean\s+isStaticStickerDocument\s*\(\s*TLRPC\.Document\s+document\s*\)/,
    messageObjectFile,
    "MessageObject.isStaticStickerDocument",
    (body) => body.replace(
      /return\s+document\s*!=\s*null\s*&&\s*document\.mime_type\.equals\("image\/webp"\s*\);/,
      'return document != null && isRawStaticStickerMime(document.mime_type);',
    ),
  );
  source = editDeclarationBody(
    source,
    /public\s+static\s+boolean\s+isStickerDocument\s*\(\s*TLRPC\.Document\s+document\s*\)/,
    messageObjectFile,
    "MessageObject.isStickerDocument",
    (body) => body.replace(
      /return\s+"image\/webp"\.equals\(document\.mime_type\)\s*\|\|\s*"video\/webm"\.equals\(document\.mime_type\);/,
      'return isRawStickerMime(document.mime_type) || "video/webm".equals(document.mime_type);',
    ),
  );
  source = editDeclarationBody(
    source,
    /public\s+static\s+boolean\s+canAutoplayAnimatedSticker\s*\(\s*TLRPC\.Document\s+document\s*\)/,
    messageObjectFile,
    "MessageObject.canAutoplayAnimatedSticker",
    (body) => body.replace(
      /return\s+\(isAnimatedStickerDocument\(document, true\)\s*\|\|\s*isVideoStickerDocument\(document\)\)\s*&&/,
      "return (isAnimatedStickerDocument(document, true) || isVideoStickerDocument(document) || isRawAnimatedStickerDocument(document)) &&",
    ),
  );
  source = replaceRegexOnce(
    source,
    /(?=^[ \t]*public\s+static\s+boolean\s+isDocumentHasThumb\s*\()/m,
    `    /** APNG documents use the existing GIF/AnimatedFileDrawable UI pipeline. */
    public static boolean isAnimatedPngDocument(TLRPC.Document document) {
        if (document == null) return false;
        if ("image/apng".equalsIgnoreCase(document.mime_type)) return true;
        String fileName = FileLoader.getDocumentFileName(document);
        return fileName != null && fileName.toLowerCase(java.util.Locale.ROOT).endsWith(".apng");
    }

    /** Raw QQ sticker/reaction assets do not need WebP/WebM projection. */
    public static boolean isRawStickerMime(String mimeType) {
        return "image/webp".equalsIgnoreCase(mimeType)
                || "image/png".equalsIgnoreCase(mimeType)
                || "image/jpeg".equalsIgnoreCase(mimeType)
                || "image/jpg".equalsIgnoreCase(mimeType)
                || "image/gif".equalsIgnoreCase(mimeType)
                || "image/apng".equalsIgnoreCase(mimeType);
    }

    public static boolean isRawStaticStickerMime(String mimeType) {
        return isRawStickerMime(mimeType)
                && !"image/gif".equalsIgnoreCase(mimeType)
                && !"image/apng".equalsIgnoreCase(mimeType);
    }

    public static boolean isCrossgramStickerOrEmojiDocument(TLRPC.Document document) {
        if (document == null) return false;
        for (int index = 0, size = document.attributes.size(); index < size; index++) {
            TLRPC.DocumentAttribute attribute = document.attributes.get(index);
            if (attribute instanceof TLRPC.TL_documentAttributeSticker
                    || attribute instanceof TLRPC.TL_documentAttributeCustomEmoji) {
                return true;
            }
        }
        return false;
    }

    public static boolean isRawAnimatedStickerDocument(TLRPC.Document document) {
        if (document == null || !isCrossgramStickerOrEmojiDocument(document)) return false;
        if ("image/gif".equalsIgnoreCase(document.mime_type) || isAnimatedPngDocument(document)) {
            return true;
        }
        String fileName = FileLoader.getDocumentFileName(document);
        if (fileName == null) return false;
        fileName = fileName.toLowerCase(java.util.Locale.ROOT);
        return fileName.endsWith(".gif") || fileName.endsWith(".apng");
    }

`,
    "isAnimatedPngDocument(TLRPC.Document document)",
    messageObjectFile,
    "add APNG document classification",
  );
  return replaceRegexOnce(
    source,
    /(?=^[ \t]*public\s+static\s+boolean\s+isRawAnimatedStickerDocument\s*\()/m,
    `    public static boolean isCrossgramStickerOrEmojiDocument(TLRPC.Document document) {
        if (document == null) return false;
        for (int index = 0, size = document.attributes.size(); index < size; index++) {
            TLRPC.DocumentAttribute attribute = document.attributes.get(index);
            if (attribute instanceof TLRPC.TL_documentAttributeSticker
                    || attribute instanceof TLRPC.TL_documentAttributeCustomEmoji) {
                return true;
            }
        }
        return false;
    }

`,
    "isCrossgramStickerOrEmojiDocument(TLRPC.Document document)",
    messageObjectFile,
    "add upstream-independent sticker and custom emoji classification",
  );
}

export function patchImageLoaderRawAnimation(initial: string): string {
  let source = addJavaImport(
    initial,
    "org.telegram.messenger.crossgram_animation.CrossgramRawAnimationSniffer",
    imageLoaderFile,
  );
  source = replaceRegexOnce(
    source,
    /(^[ \t]*if\s*\(cacheImage\.imageLocation\.photoSize\s+instanceof\s+TLRPC\.TL_photoStrippedSize\)\s*\{)/m,
    `        if (cacheImage.imageType != FileLoader.IMAGE_TYPE_ANIMATION
                && (CrossgramRawAnimationSniffer.isAnimatedPng(cacheImage.finalFilePath)
                    || CrossgramRawAnimationSniffer.isGif(cacheImage.finalFilePath))) {
            cacheImage.imageType = FileLoader.IMAGE_TYPE_ANIMATION;
            FileLog.d("crossgram_raw_animation=content_sniffed file=" + cacheImage.finalFilePath);
        }

$1`,
    "crossgram_raw_animation=content_sniffed",
    imageLoaderFile,
    "sniff APNG after the original file reaches the client",
  );
  source = source.replace(
    "MessageObject.isGifDocument(imageLocation.webFile) || MessageObject.isGifDocument(imageLocation.document)",
    "MessageObject.isGifDocument(imageLocation.webFile) || MessageObject.isGifDocument(imageLocation.document)",
  );
  return source;
}

export function patchAnimatedEmojiRawAnimation(initial: string): string {
  let source = replaceRegexOnce(
    initial,
    /mediaLocation\s*=\s*null;\s*\n(\s*)mediaFilter\s*=\s*filter;/,
    "mediaLocation = MessageObject.isRawStickerMime(document.mime_type)\n"
      + "$1        ? ImageLocation.getForDocument(document) : null;\n"
      + "$1mediaFilter = filter;",
    "MessageObject.isRawStickerMime(document.mime_type)\n",
    animatedEmojiFile,
    "load raw custom emoji from the main document instead of an absent thumbnail",
  );
  source = replaceRegexOnce(
    source,
    /else\s+if\s*\(MessageObject\.isAnimatedStickerDocument\(document, true\)\)\s*\{\s*\n(\s*)imageReceiver\.setImage\(mediaLocation, mediaFilter \+ "_firstframe",/,
    "else if (MessageObject.isAnimatedStickerDocument(document, true)\n"
      + "$1        || MessageObject.isRawStickerMime(document.mime_type)) {\n"
      + "$1imageReceiver.setImage(mediaLocation, mediaFilter\n"
      + "$1        + (MessageObject.isRawAnimatedStickerDocument(document) ? \"_firstframe\" : \"\"),",
    "|| MessageObject.isRawStickerMime(document.mime_type))",
    animatedEmojiFile,
    "render raw static and animated custom emoji even when reaction animations are disabled",
  );
  return source;
}

/**
 * 原地改写单行 FFmpeg 配置项并保留行尾格式。
 * 上游既有反斜杠续行的单条命令，也有每行一项的数组写法；数组写法如果多出反斜杠会把下一项拼到一起。
 */
function rewriteConfigureLine(
  source: string,
  anchor: RegExp,
  rewrite: (line: string) => string,
  file: string,
  label: string,
): string {
  const flags = anchor.flags.includes("g") ? anchor.flags : anchor.flags + "g";
  const matches = [...source.matchAll(new RegExp(anchor.source, flags))];
  if (matches.length !== 1) {
    throw new PatchError(file, label + ": expected one semantic match, found " + matches.length);
  }
  return source.replace(
    new RegExp(anchor.source, anchor.flags.replace("g", "")),
    (line: string) => rewrite(line),
  );
}

/** 按锚点行的缩进与续行风格追加一行配置项。 */
function appendConfigureLine(match: string, option: string): string {
  const indent = /^[ \t]*/.exec(match)?.[0] ?? "";
  const continuation = /\\[ \t]*$/.test(match) ? " \\" : "";
  return match + "\n" + indent + option + continuation;
}

export function patchFfmpegRawAnimation(initial: string, file: string): string {
  let source = initial;
  if (!source.includes("--enable-zlib")) {
    source = rewriteConfigureLine(
      source,
      /^[ \t]*--disable-zlib[ \t]*(?:\\[ \t]*)?$/m,
      (line) => line.replace("--disable-zlib", "--enable-zlib"),
      file,
      "enable zlib for the APNG decoder",
    );
  }
  const apngFlags: readonly (readonly [string, string])[] = [
    ["--enable-decoder=apng", "enable the APNG codec"],
    // APNG 会拉入 pngdsp.o 等共享对象，但只有开启 PNG decoder 才会编译 aarch64/pngdsp_init.o，否则 ARM64 链接会因缺少 ff_pngdsp_init_aarch64 失败。
    ["--enable-decoder=png", "enable the PNG decoder the APNG codec links against"],
    ["--enable-demuxer=apng", "enable the APNG container"],
  ];
  for (const [flag, label] of apngFlags) {
    if (source.includes(flag)) continue;
    const kind = flag.replace("--enable-", "").split("=")[0]!;
    source = rewriteConfigureLine(
      source,
      new RegExp("^([ \\t]*)--enable-" + kind + "=gif[ \\t]*(?:\\\\[ \\t]*)?$", "m"),
      (line) => appendConfigureLine(line, flag),
      file,
      label,
    );
  }
  // GIF demuxer 按 1 KiB 裸块输出（AVSTREAM_PARSE_FULL_RAW），依赖 GIF parser 重组完整帧。
  // `--disable-everything` 会关掉该 parser，导致解码器只拿到首个分块、只画出残缺首帧且无法播放动画。
  // 紧挨 demuxer 开启，保证所有能解复用 GIF 的构建都能解析完整帧。
  if (!source.includes("--enable-parser=gif")) {
    source = rewriteConfigureLine(
      source,
      /^([ \t]*)--enable-demuxer=gif[ \t]*(?:\\[ \t]*)?$/m,
      (line) => appendConfigureLine(line, "--enable-parser=gif"),
      file,
      "enable the GIF parser the GIF demuxer depends on",
    );
  }
  if (!source.includes("--enable-zlib")) {
    throw new Error(file + ": FFmpeg zlib configuration anchor was not found");
  }
  return source;
}

/** 仅在锚点唯一存在时替换，兼容不含该锚点的上游分支。 */
function replaceRegexIfPresent(
  source: string,
  pattern: RegExp,
  replacement: string,
  marker: string,
): string {
  if (source.includes(marker)) return source;
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  if ([...source.matchAll(new RegExp(pattern.source, flags))].length !== 1) return source;
  return source.replace(pattern, replacement);
}

const videoFrameReaderFile = "TMessagesProj/jni/gifvideo/video_frame_reader.h";
const bitmapsCacheFile = "TMessagesProj/src/main/java/org/telegram/messenger/utils/BitmapsCache.java";

/**
 * VideoFrameReader 按时间戳 seek，但 QQ 转发的 GIF/APNG 贴纸与回应不含时间戳，av_seek_frame() 会直接失败并卡在末帧无法循环。
 * 保留原时间戳 seek 供普通视频使用，失败时依次回退到按帧号 seek 和手动回绕输入流。
 */
export function patchVideoFrameReader(initial: string, file: string): string {
  return replaceRegexOnce(
    initial,
    /(^[ \t]*)int ret = av_seek_frame\(m_fmt, m_streamIndex, pts, flags\);\r?\n([ \t]*)if \(ret < 0\) \{\r?\n[ \t]*return false;\r?\n[ \t]*\}/m,
    [
      "$1int ret = av_seek_frame(m_fmt, m_streamIndex, pts, flags);",
      "$2if (ret < 0) {",
      "$2    /* CROSSGRAM: GIF and APNG carry no timestamps, so the seek above is",
      "$2       rejected; the frame-index seek is what restarts those streams. */",
      "$2    ret = av_seek_frame(m_fmt, m_streamIndex, pts, flags | AVSEEK_FLAG_FRAME);",
      "$2}",
      "$2if (ret < 0 && pts <= 0 && m_fmt->pb != nullptr) {",
      "$2    ret = avio_seek(m_fmt->pb, 0, SEEK_SET) < 0 ? -1 : 0;",
      "$2}",
      "$2if (ret < 0) {",
      "$2    return false;",
      "$2}",
    ].join("\n"),
    "CROSSGRAM: GIF and APNG carry no timestamps",
    file,
    "restart timestamp-less containers",
  );
}


export function patchGifVideoRawAnimation(initial: string): string {
  let source = initial.replace(
    "    return crossgramDurationMs(info);\n}\n\nextern",
    "    return (int32_t) (info->fmt_ctx->duration * 1000 / AV_TIME_BASE);\n}\n\nextern",
  );
  source = source
    .replace(
      "dataArr[PARAM_NUM_DURATION] = (int32_t) (info->fmt_ctx->duration * 1000 / AV_TIME_BASE);",
      "dataArr[PARAM_NUM_DURATION] = crossgramDurationMs(info);",
    )
    .replace(
      "dataArr[4] = (int32_t) (info->fmt_ctx->duration * 1000 / AV_TIME_BASE);",
      "dataArr[4] = crossgramDurationMs(info);",
    );
  // Nagram 的 VideoFrameReader 从 avformat_find_stream_info() 读完的位置继续读。
  // 小体积贴纸在探测阶段就会读到文件末尾，导致后续无法推进帧，首次拉帧前需先回绕到开头。
  source = replaceRegexIfPresent(
    source,
    /^([ \t]*)info->reader = new VideoFrameReader\([^\r\n]*\);[ \t]*\r?$/m,
    [
      '$&',
      '$1/* CROSSGRAM: find_stream_info() already consumed this input. */',
      '$1if (info->reader != nullptr) {',
      '$1    info->reader->seek(0);',
      '$1}',
    ].join("\n"),
    "CROSSGRAM: find_stream_info() already consumed this input",
  );

  if (!source.includes("#include <libavutil/pixdesc.h>")) {
    // 新版 VideoFrameReader 包含 eval.h，旧版 AnimatedFileDrawable 包含 intmath.h；挑一个唯一存在的头文件作为插入锚点。
    const pixdescAnchor = source.includes("#include <libavutil/eval.h>")
      ? /(#include\s+<libavutil\/eval\.h>\s*\n)/
      : /(#include\s+<libavutil\/intmath\.h>\s*\n)/;
    source = replaceRegexOnce(
      source,
      pixdescAnchor,
      "$1#include <libavutil/pixdesc.h>\n",
      "#include <libavutil/pixdesc.h>",
      gifVideoFile,
      "inspect decoded APNG alpha formats",
    );
  }
  source = replaceRegexOnce(
    source,
    /(?=^extern\s+"C"\s+JNIEXPORT\s+void\s+JNICALL\s+Java_org_telegram_ui_Components_AnimatedFile(?:Native_nGetVideoInfo|Drawable_getVideoInfo))/m,
    `static int32_t crossgramDurationMs(VideoInfo *info) {
    if (info == nullptr || info->fmt_ctx == nullptr
            || info->fmt_ctx->duration == AV_NOPTS_VALUE
            || info->fmt_ctx->duration <= 0
            || info->fmt_ctx->duration > INT64_C(86400) * AV_TIME_BASE) {
        return 0;
    }
    return (int32_t) (info->fmt_ctx->duration * 1000 / AV_TIME_BASE);
}

`,
    "crossgramDurationMs(VideoInfo *info)",
    gifVideoFile,
    "avoid APNG AV_NOPTS_VALUE duration overflow",
  );
  source = source.replace(
    `static bool crossgramCanWriteFrame(const AVFrame *frame) {
    return frame != nullptr
            && frame->format > AV_PIX_FMT_NONE
            && frame->format < AV_PIX_FMT_NB;
}`,
    `static bool crossgramCanWriteFrame(const AVFrame *frame) {
    if (frame == nullptr
            || frame->format <= AV_PIX_FMT_NONE
            || frame->format >= AV_PIX_FMT_NB) {
        return false;
    }
    return frame->format == AV_PIX_FMT_YUVA420P
            || sws_isSupportedInput((AVPixelFormat) frame->format) > 0;
}`,
  );
  source = replaceRegexOnce(
    source,
    /(?=^static\s+(?:inline\s+)?void\s+writeFrameToBitmap\s*\()/m,
    `static bool crossgramFrameNeedsPremultiplication(const AVFrame *frame) {
    if (frame == nullptr || frame->format == AV_PIX_FMT_YUVA420P) {
        // I420AlphaToARGBMatrix below already attenuates YUVA pixels.
        return false;
    }
    const AVPixFmtDescriptor *descriptor = av_pix_fmt_desc_get((AVPixelFormat) frame->format);
    return descriptor != nullptr && (descriptor->flags & AV_PIX_FMT_FLAG_ALPHA) != 0;
}

static void crossgramPremultiplyBitmap(
        uint8_t *pixels, int32_t stride, int32_t width, int32_t height) {
    for (int32_t y = 0; y < height; y++) {
        uint8_t *pixel = pixels + y * stride;
        for (int32_t x = 0; x < width; x++, pixel += 4) {
            const uint32_t alpha = pixel[3];
            if (alpha == 255) continue;
            pixel[0] = (uint8_t) ((pixel[0] * alpha + 127) / 255);
            pixel[1] = (uint8_t) ((pixel[1] * alpha + 127) / 255);
            pixel[2] = (uint8_t) ((pixel[2] * alpha + 127) / 255);
        }
    }
}

`,
    "crossgramFrameNeedsPremultiplication(const AVFrame *frame)",
    gifVideoFile,
    "premultiply APNG alpha before Android Canvas composites the bitmap",
  );
  // 新版 Telegram 给旧版 writeFrameToBitmap 增加了 stride 参数，需同时兼容四参和五参签名。
  const legacyBitmapWriter = /static\s+(?:inline\s+)?void\s+writeFrameToBitmap\s*\(\s*JNIEnv\s*\*\s*env\s*,\s*VideoInfo\s*\*\s*info\s*,\s*jintArray\s+data\s*,\s*jobject\s+bitmap(?:\s*,\s*jint\s+stride)?\s*\)/;
  const modernBitmapWriter = /static\s+(?:inline\s+)?void\s+writeFrameToBitmap\s*\([^)]*AVFrame\s*\*\s*frame[^)]*\)/;
  const premultiplyBitmapWriter = (pattern: RegExp, frame: string): boolean => {
    let found = false;
    try {
      source = editDeclarationBody(
        source,
        pattern,
        gifVideoFile,
        "writeFrameToBitmap alpha output",
        (body) => {
          found = true;
          if (body.includes("crossgramPremultiplyBitmap(")) return body;
          const unlock = "    AndroidBitmap_unlockPixels(env, bitmap);";
          if (!body.includes(unlock)) {
            throw new PatchError(gifVideoFile, "writeFrameToBitmap unlock anchor was not found");
          }
          // 旧版局部变量名为 bitmapStride，新版则由形参传入 stride。
          const bitmapStride = body.includes("bitmapStride") ? "bitmapStride" : "stride";
          return body.replace(
            unlock,
            `    if (crossgramFrameNeedsPremultiplication(${frame})) {
        crossgramPremultiplyBitmap(
                (uint8_t *) pixels, ${bitmapStride}, bitmapWidth, bitmapHeight);
    }

${unlock}`,
          );
        },
      );
    } catch (error) {
      if (!(error instanceof PatchError) || found) throw error;
    }
    return found;
  };
  const patchedLegacyWriter = premultiplyBitmapWriter(legacyBitmapWriter, "info->frame");
  const patchedModernWriter = patchedLegacyWriter
    ? false
    : premultiplyBitmapWriter(modernBitmapWriter, "frame");
  if (!patchedLegacyWriter && !patchedModernWriter) {
    throw new PatchError(gifVideoFile, "writeFrameToBitmap declaration was not found");
  }
  const legacyFrameFormatCheck = String.raw`if\s*\(info->frame->format\s*==\s*AV_PIX_FMT_YUV444P\s*\|\|\s*info->frame->format\s*==\s*AV_PIX_FMT_YUV420P\s*\|\|\s*info->frame->format\s*==\s*AV_PIX_FMT_BGRA\s*\|\|\s*info->frame->format\s*==\s*AV_PIX_FMT_YUVJ420P\)\s*\{`;
  const seekPattern = new RegExp(
    `(extern\\s+"C"\\s+JNIEXPORT\\s+void\\s+JNICALL\\s+Java_org_telegram_ui_Components_AnimatedFile(?:Native_nSeekToMs|Drawable_seekToMs)[\\s\\S]*?)${legacyFrameFormatCheck}`,
  );
  const frameAtTimePattern = new RegExp(
    `(extern\\s+"C"\\s+JNIEXPORT\\s+int\\s+JNICALL\\s+Java_org_telegram_ui_Components_AnimatedFile(?:Native_nGetFrameAtTime|Drawable_getFrameAtTime)[\\s\\S]*?)${legacyFrameFormatCheck}`,
  );
  const playbackPattern = new RegExp(
    `(extern\\s+"C"\\s+JNIEXPORT\\s+jint\\s+JNICALL\\s+Java_org_telegram_ui_Components_AnimatedFile(?:Native_nGetVideoFrame|Drawable_getVideoFrame)[\\s\\S]*?)if\\s*\\((?:bitmap\\s*!=\\s*nullptr\\s*&&\\s*\\()?info->frame->format\\s*==\\s*AV_PIX_FMT_YUV420P\\s*\\|\\|\\s*info->frame->format\\s*==\\s*AV_PIX_FMT_BGRA\\s*\\|\\|\\s*info->frame->format\\s*==\\s*AV_PIX_FMT_YUVJ420P\\s*\\|\\|\\s*info->frame->format\\s*==\\s*AV_PIX_FMT_YUV444P\\s*\\|\\|\\s*info->frame->format\\s*==\\s*AV_PIX_FMT_YUVA420P\\)\\)?\\s*\\{`,
  );
  const legacyMarkers = [
    "CROSSGRAM: accept every swscale-supported format while seeking",
    "CROSSGRAM: accept every swscale-supported format during frame lookup",
    "CROSSGRAM: render every swscale-supported animation format",
  ];
  const hasAllLegacyMarkers = legacyMarkers.every((marker) => source.includes(marker));
  const hasAnyLegacyMarker = legacyMarkers.some((marker) => source.includes(marker));
  const hasFrameHelper = source.includes("crossgramCanWriteFrame(const AVFrame *frame)");
  if (hasAllLegacyMarkers && hasFrameHelper) return source;
  if (hasAnyLegacyMarker || hasFrameHelper) {
    throw new PatchError(gifVideoFile, "raw animation frame-format patch is only partially applied");
  }
  const countMatches = (pattern: RegExp): number => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return [...source.matchAll(new RegExp(pattern.source, flags))].length;
  };
  const legacyCounts = [seekPattern, frameAtTimePattern, playbackPattern].map(countMatches);
  const declarationContains = (pattern: RegExp, needles: string[]): boolean => {
    let contains = false;
    try {
      editDeclarationBody(source, pattern, gifVideoFile, "modern VideoFrameReader pipeline", (body) => {
        contains = needles.every((needle) => body.includes(needle));
        return body;
      });
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
    }
    return contains;
  };
  const modernFrameReader = declarationContains(
    /extern\s+"C"\s+JNIEXPORT\s+void\s+JNICALL\s+Java_org_telegram_ui_Components_AnimatedFileNative_nSeekToMs\s*\(/,
    ["VideoFrameReader::Status", "info->reader->getNextFrame()"],
  ) && declarationContains(
    /extern\s+"C"\s+JNIEXPORT\s+int\s+JNICALL\s+Java_org_telegram_ui_Components_AnimatedFileNative_nGetFrameAtTime\s*\(/,
    ["VideoFrameReader::Status", "writeFrameToBitmap(env, info, frame, data, bitmap);"],
  ) && declarationContains(
    /extern\s+"C"\s+JNIEXPORT\s+jint\s+JNICALL\s+Java_org_telegram_ui_Components_AnimatedFileNative_nGetVideoFrame\s*\(/,
    ["VideoFrameReader::Status", "writeFrameToBitmap(env, info, frame, data, bitmap);"],
  );
  if (legacyCounts.every((count) => count === 0) && modernFrameReader) {
    return source;
  }
  if (!legacyCounts.every((count) => count === 1)) {
    throw new PatchError(
      gifVideoFile,
      `raw animation frame-format anchors: expected [1,1,1], found [${legacyCounts.join(",")}], modern=${modernFrameReader}`,
    );
  }
  source = replaceRegexOnce(
    source,
    /(?=^extern\s+"C"\s+JNIEXPORT\s+void\s+JNICALL\s+Java_org_telegram_ui_Components_AnimatedFile(?:Native_nGetVideoInfo|Drawable_getVideoInfo))/m,
    `static bool crossgramCanWriteFrame(const AVFrame *frame) {
    if (frame == nullptr
            || frame->format <= AV_PIX_FMT_NONE
            || frame->format >= AV_PIX_FMT_NB) {
        return false;
    }
    return frame->format == AV_PIX_FMT_YUVA420P
            || sws_isSupportedInput((AVPixelFormat) frame->format) > 0;
}

`,
    "crossgramCanWriteFrame(const AVFrame *frame)",
    gifVideoFile,
    "allow FFmpeg swscale to render raw GIF/APNG pixel formats",
  );
  source = replaceRegexOnce(
    source,
    seekPattern,
    `$1/* CROSSGRAM: accept every swscale-supported format while seeking. */
                if (crossgramCanWriteFrame(info->frame)) {`,
    "CROSSGRAM: accept every swscale-supported format while seeking",
    gifVideoFile,
    "seek through APNG RGB frames",
  );
  source = replaceRegexOnce(
    source,
    frameAtTimePattern,
    `$1/* CROSSGRAM: accept every swscale-supported format during frame lookup. */
                if (crossgramCanWriteFrame(info->frame)) {`,
    "CROSSGRAM: accept every swscale-supported format during frame lookup",
    gifVideoFile,
    "render APNG frames during precise frame lookup",
  );
  source = replaceRegexOnce(
    source,
    playbackPattern,
    `$1/* CROSSGRAM: render every swscale-supported animation format. */
            if (bitmap != nullptr && crossgramCanWriteFrame(info->frame)) {`,
    "CROSSGRAM: render every swscale-supported animation format",
    gifVideoFile,
    "render APNG frames during normal animation playback",
  );
  return source;
}

async function patchOptionalFile(
  root: string,
  relative: string,
  patch: (source: string, file: string) => string,
  changedFiles: string[],
): Promise<void> {
  const target = path.join(root, relative);
  try {
    await access(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (await writeUtf8IfChanged(target, patch(await readUtf8(target), relative))) {
    changedFiles.push(relative);
  }
}

export async function applyRawAnimation(root: string, _upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  const snifferTarget = path.join(root, "TMessagesProj/src/main/java", snifferRelative);
  const snifferSource = await readUtf8(path.join(featureRoot, "files/java", snifferRelative));
  if (await writeUtf8IfChanged(snifferTarget, snifferSource)) {
    // 统一用正斜杠记录相对路径，避免不同平台路径分隔符不一致。
    changedFiles.push("TMessagesProj/src/main/java/" + snifferRelative);
  }

  const messageTarget = path.join(root, messageObjectFile);
  if (await writeUtf8IfChanged(messageTarget, patchMessageObjectRawAnimation(await readUtf8(messageTarget)))) {
    changedFiles.push(messageObjectFile);
  }
  const loaderTarget = path.join(root, imageLoaderFile);
  if (await writeUtf8IfChanged(loaderTarget, patchImageLoaderRawAnimation(await readUtf8(loaderTarget)))) {
    changedFiles.push(imageLoaderFile);
  }
  const animatedEmojiTarget = path.join(root, animatedEmojiFile);
  if (await writeUtf8IfChanged(
    animatedEmojiTarget,
    patchAnimatedEmojiRawAnimation(await readUtf8(animatedEmojiTarget)),
  )) {
    changedFiles.push(animatedEmojiFile);
  }
  const gifVideoTarget = path.join(root, gifVideoFile);
  if (await writeUtf8IfChanged(gifVideoTarget, patchGifVideoRawAnimation(await readUtf8(gifVideoTarget)))) {
    changedFiles.push(gifVideoFile);
  }
  for (const script of ffmpegScripts) {
    await patchOptionalFile(root, script, patchFfmpegRawAnimation, changedFiles);
  }
  await patchOptionalFile(root, videoFrameReaderFile, patchVideoFrameReader, changedFiles);
  await patchOptionalFile(root, bitmapsCacheFile, patchBitmapsCacheRawAnimation, changedFiles);
  return changedFiles;
}

/**
 * 预渲染帧缓存（`acache/*.pcache2`）仅按源文件名和大小命名。
 * 旧版本缺少 GIF parser 时会把残缺首帧写进磁盘缓存，升级后仍会直接复用；给缓存后缀加上版本号以强制重新渲染。
 */
export function patchBitmapsCacheRawAnimation(initial: string, file = bitmapsCacheFile): string {
  return replaceRegexOnce(
    initial,
    /\+\s*"\.pcache2"\);/,
    '+ "_cg2" + ".pcache2");',
    '"_cg2" + ".pcache2"',
    file,
    "re-render frame caches the parser-less GIF decoder produced",
  );
}
