import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { addJavaImport, editDeclarationBody, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const featureRoot = path.dirname(fileURLToPath(import.meta.url));
const messageObjectFile = "TMessagesProj/src/main/java/org/telegram/messenger/MessageObject.java";
const imageLoaderFile = "TMessagesProj/src/main/java/org/telegram/messenger/ImageLoader.java";
const snifferRelative = "org/telegram/messenger/crossgram_animation/CrossgramRawAnimationSniffer.java";
const ffmpegScripts = [
  "TMessagesProj/jni/build_ffmpeg_clang.sh",
  "TMessagesProj/jni/ffmpeg/build_ffmpeg/build_ffmpeg.sh",
] as const;

export function patchMessageObjectRawAnimation(initial: string): string {
  let source = editDeclarationBody(
    initial,
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
      'return document != null && document.mime_type != null && ((document.mime_type.equals("image/gif") || isAnimatedPngDocument(document)) && !hasGroup && !isAnyKindOfStickerOrEmoji(document) || isNewGifDocument(document));',
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
  return replaceRegexOnce(
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

    public static boolean isRawAnimatedStickerDocument(TLRPC.Document document) {
        if (document == null || !isAnyKindOfStickerOrEmoji(document)) return false;
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

export function patchFfmpegRawAnimation(initial: string, file: string): string {
  let source = initial.replace("--disable-zlib \\", "--enable-zlib \\");
  source = replaceRegexOnce(
    source,
    /(^[ \t]*--enable-decoder=gif\s*\\[ \t]*$)/m,
    `$1
\t--enable-decoder=apng \\`,
    "--enable-decoder=apng",
    file,
    "enable the APNG codec",
  );
  source = replaceRegexOnce(
    source,
    /(^[ \t]*--enable-demuxer=gif\s*\\[ \t]*$)/m,
    `$1
\t--enable-demuxer=apng \\`,
    "--enable-demuxer=apng",
    file,
    "enable the APNG container",
  );
  if (!source.includes("--enable-zlib")) {
    throw new Error(`${file}: FFmpeg zlib configuration anchor was not found`);
  }
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
    changedFiles.push(path.relative(root, snifferTarget));
  }

  const messageTarget = path.join(root, messageObjectFile);
  if (await writeUtf8IfChanged(messageTarget, patchMessageObjectRawAnimation(await readUtf8(messageTarget)))) {
    changedFiles.push(messageObjectFile);
  }
  const loaderTarget = path.join(root, imageLoaderFile);
  if (await writeUtf8IfChanged(loaderTarget, patchImageLoaderRawAnimation(await readUtf8(loaderTarget)))) {
    changedFiles.push(imageLoaderFile);
  }
  for (const script of ffmpegScripts) {
    await patchOptionalFile(root, script, patchFfmpegRawAnimation, changedFiles);
  }
  return changedFiles;
}
