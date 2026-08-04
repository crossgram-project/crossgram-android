import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyRawAnimation,
  patchFfmpegRawAnimation,
  patchGifVideoRawAnimation,
  patchImageLoaderRawAnimation,
  patchMessageObjectRawAnimation,
} from "../features/raw-animation/patch.js";
import { getUpstream } from "../src/upstreams.js";

const exec = promisify(execFile);

const messageObjectFixture = `package org.telegram.messenger;
public class MessageObject {
    public static boolean isGifDocument(WebFile document) {
        return document != null && (document.mime_type.equals("image/gif") || isNewGifDocument(document));
    }
    public static boolean isGifDocument(TLRPC.Document document) {
        return isGifDocument(document, false);
    }
    public static boolean isGifDocument(TLRPC.Document document, boolean hasGroup) {
        return document != null && document.mime_type != null && (document.mime_type.equals("image/gif") && !hasGroup || isNewGifDocument(document));
    }
    public static boolean isStaticStickerDocument(TLRPC.Document document) {
        return document != null && document.mime_type.equals("image/webp");
    }
    public static boolean isStickerDocument(TLRPC.Document document) {
        if (document != null) {
            for (TLRPC.DocumentAttribute attribute : document.attributes) {
                if (attribute instanceof TLRPC.TL_documentAttributeSticker) {
                    return "image/webp".equals(document.mime_type) || "video/webm".equals(document.mime_type);
                }
            }
        }
        return false;
    }
    public static boolean canAutoplayAnimatedSticker(TLRPC.Document document) {
        return (isAnimatedStickerDocument(document, true) || isVideoStickerDocument(document)) && LiteMode.isEnabled(1);
    }
    public static boolean isDocumentHasThumb(TLRPC.Document document) { return false; }
}`;

const imageLoaderFixture = `package org.telegram.messenger;
import org.telegram.tgnet.TLRPC;
public class ImageLoader {
    private class CacheOutTask implements Runnable {
        private CacheImage cacheImage;
        public void run() {
            if (cacheImage.imageLocation.photoSize instanceof TLRPC.TL_photoStrippedSize) {
                return;
            } else if (cacheImage.imageType == FileLoader.IMAGE_TYPE_ANIMATION) {
                decodeAnimation();
            }
        }
    }
}`;

const ffmpegFixture = `./configure \\
  --disable-zlib \\
  --enable-decoder=gif \\
  --enable-demuxer=gif \\
  --enable-hwaccels \\
`;

const gifVideoFixture = `
extern "C" JNIEXPORT void JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nGetVideoInfo() {
    dataArr[PARAM_NUM_DURATION] = (int32_t) (info->fmt_ctx->duration * 1000 / AV_TIME_BASE);
}
extern "C" JNIEXPORT jlong JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nCreateDecoder() {
    dataArr[4] = (int32_t) (info->fmt_ctx->duration * 1000 / AV_TIME_BASE);
}
extern "C" JNIEXPORT void JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nSeekToMs() {
    if (info->frame->format == AV_PIX_FMT_YUV444P || info->frame->format == AV_PIX_FMT_YUV420P || info->frame->format == AV_PIX_FMT_BGRA || info->frame->format == AV_PIX_FMT_YUVJ420P) {
        finished = true;
    }
}
extern "C" JNIEXPORT int JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nGetFrameAtTime() {
    if (info->frame->format == AV_PIX_FMT_YUV444P || info->frame->format == AV_PIX_FMT_YUV420P || info->frame->format == AV_PIX_FMT_BGRA || info->frame->format == AV_PIX_FMT_YUVJ420P) {
        writeFrameToBitmap(env, info, data, bitmap);
    }
}
extern "C" JNIEXPORT jint JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nGetVideoFrame() {
    if (bitmap != nullptr && (info->frame->format == AV_PIX_FMT_YUV420P || info->frame->format == AV_PIX_FMT_BGRA || info->frame->format == AV_PIX_FMT_YUVJ420P || info->frame->format == AV_PIX_FMT_YUV444P || info->frame->format == AV_PIX_FMT_YUVA420P)) {
        writeFrameToBitmap(env, info, data, bitmap);
    }
}
`;

const drawableGifVideoFixture = gifVideoFixture
  .replaceAll("AnimatedFileNative_nGet", "AnimatedFileDrawable_get")
  .replaceAll("AnimatedFileNative_nSeek", "AnimatedFileDrawable_seek")
  .replaceAll("AnimatedFileNative_nCreate", "AnimatedFileDrawable_create")
  .replace(
    "if (bitmap != nullptr && (info->frame->format == AV_PIX_FMT_YUV420P || info->frame->format == AV_PIX_FMT_BGRA || info->frame->format == AV_PIX_FMT_YUVJ420P || info->frame->format == AV_PIX_FMT_YUV444P || info->frame->format == AV_PIX_FMT_YUVA420P)) {",
    "if (info->frame->format == AV_PIX_FMT_YUV420P || info->frame->format == AV_PIX_FMT_BGRA || info->frame->format == AV_PIX_FMT_YUVJ420P || info->frame->format == AV_PIX_FMT_YUV444P || info->frame->format == AV_PIX_FMT_YUVA420P) {",
  );

const modernGifVideoFixture = `
extern "C" JNIEXPORT void JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nGetVideoInfo() {
    dataArr[PARAM_NUM_DURATION] = (int32_t) (info->fmt_ctx->duration * 1000 / AV_TIME_BASE);
}
extern "C" JNIEXPORT jlong JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nCreateDecoder() {
    dataArr[4] = (int32_t) (info->fmt_ctx->duration * 1000 / AV_TIME_BASE);
}
extern "C" JNIEXPORT void JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nSeekToMs() {
    VideoFrameReader::Status status = info->reader->getNextFrame();
    if (status != VideoFrameReader::Status::Ok) return;
}
extern "C" JNIEXPORT int JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nGetFrameAtTime() {
    VideoFrameReader::Status status = info->reader->getNextFrame();
    AVFrame *frame = info->reader->frame();
    writeFrameToBitmap(env, info, frame, data, bitmap);
    return status == VideoFrameReader::Status::Ok;
}
extern "C" JNIEXPORT jint JNICALL Java_org_telegram_ui_Components_AnimatedFileNative_nGetVideoFrame() {
    VideoFrameReader::Status status = info->reader->getNextFrame();
    AVFrame *frame = info->reader->frame();
    if (bitmap != nullptr) writeFrameToBitmap(env, info, frame, data, bitmap);
    return status == VideoFrameReader::Status::Ok;
}
`;

describe("Android raw GIF/APNG patch", () => {
  it("routes APNG MIME and .apng documents through the existing GIF UI", () => {
    const patched = patchMessageObjectRawAnimation(messageObjectFixture);
    expect(patched).toContain('document.mime_type.equals("image/apng")');
    expect(patched).toContain("isAnimatedPngDocument(document)");
    expect(patched).toContain("!isAnyKindOfStickerOrEmoji(document)");
    expect(patched).toContain('endsWith(".apng")');
    expect(patched).toContain("isRawStickerMime(document.mime_type)");
    expect(patched).toContain('"image/png".equalsIgnoreCase(mimeType)');
    expect(patched).toContain('"image/jpeg".equalsIgnoreCase(mimeType)');
    expect(patched).toContain("isRawAnimatedStickerDocument(document)");
    expect(patchMessageObjectRawAnimation(patched)).toBe(patched);
  });

  it("sniffs downloaded image/png bytes before selecting a static decoder", () => {
    const patched = patchImageLoaderRawAnimation(imageLoaderFixture);
    expect(patched).toContain("CrossgramRawAnimationSniffer.isAnimatedPng(cacheImage.finalFilePath)");
    expect(patched).toContain("CrossgramRawAnimationSniffer.isGif(cacheImage.finalFilePath)");
    expect(patched).toContain("cacheImage.imageType = FileLoader.IMAGE_TYPE_ANIMATION");
    expect(patched).toContain("crossgram_raw_animation=content_sniffed");
    expect(patchImageLoaderRawAnimation(patched)).toBe(patched);
  });

  it("enables APNG and its zlib dependency in FFmpeg idempotently", () => {
    const patched = patchFfmpegRawAnimation(ffmpegFixture, "build_ffmpeg.sh");
    expect(patched).toContain("--enable-zlib");
    expect(patched).toContain("--enable-decoder=apng");
    expect(patched).toContain("--enable-demuxer=apng");
    expect(patchFfmpegRawAnimation(patched, "build_ffmpeg.sh")).toBe(patched);
  });

  it("renders FFmpeg GIF/APNG frames and guards APNG's unknown duration", () => {
    const patched = patchGifVideoRawAnimation(gifVideoFixture);
    expect(patched).toContain("info->fmt_ctx->duration == AV_NOPTS_VALUE");
    expect(patched.match(/crossgramDurationMs\(info\)/g)).toHaveLength(2);
    expect(patched).toContain("crossgramCanWriteFrame(const AVFrame *frame)");
    expect(patched.match(/if \(crossgramCanWriteFrame\(info->frame\)\) \{/g)).toHaveLength(2);
    expect(patched).toContain("if (bitmap != nullptr && crossgramCanWriteFrame(info->frame)) {");
    expect(patched).not.toContain("bitmap != nullptr && (info->frame->format == AV_PIX_FMT_YUV420P");
    expect(patchGifVideoRawAnimation(patched)).toBe(patched);
  });

  it("patches legacy AnimatedFileDrawable JNI names used by Telegram and Nullgram", () => {
    const patched = patchGifVideoRawAnimation(drawableGifVideoFixture);
    expect(patched).toContain("crossgramDurationMs(VideoInfo *info)");
    expect(patched).toContain("crossgramCanWriteFrame(const AVFrame *frame)");
    expect(patched).toContain("Java_org_telegram_ui_Components_AnimatedFileDrawable_getVideoInfo");
    expect(patched).toContain("if (bitmap != nullptr && crossgramCanWriteFrame(info->frame)) {");
    expect(patchGifVideoRawAnimation(patched)).toBe(patched);
  });

  it("leaves Forkgram's unrestricted VideoFrameReader pipeline intact", () => {
    const patched = patchGifVideoRawAnimation(modernGifVideoFixture);
    expect(patched).toContain("crossgramDurationMs(VideoInfo *info)");
    expect(patched.match(/crossgramDurationMs\(info\)/g)).toHaveLength(2);
    expect(patched).not.toContain("crossgramCanWriteFrame(const AVFrame *frame)");
    expect(patched).toContain("VideoFrameReader::Status");
    expect(patchGifVideoRawAnimation(patched)).toBe(patched);
  });

  it("installs the sniffer and patches a source tree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "crossgram-raw-animation-"));
    try {
      const messenger = path.join(root, "TMessagesProj/src/main/java/org/telegram/messenger");
      await mkdir(messenger, { recursive: true });
      await writeFile(path.join(messenger, "MessageObject.java"), messageObjectFixture, "utf8");
      await writeFile(path.join(messenger, "ImageLoader.java"), imageLoaderFixture, "utf8");
      const ffmpeg = path.join(root, "TMessagesProj/jni");
      await mkdir(ffmpeg, { recursive: true });
      await writeFile(path.join(ffmpeg, "build_ffmpeg_clang.sh"), ffmpegFixture, "utf8");
      await writeFile(path.join(ffmpeg, "gifvideo.cpp"), gifVideoFixture, "utf8");

      const changed = await applyRawAnimation(root, getUpstream("nagram"));
      expect(changed).toContain(
        "TMessagesProj\\src\\main\\java\\org\\telegram\\messenger\\crossgram_animation\\CrossgramRawAnimationSniffer.java",
      );
      expect(changed).toContain("TMessagesProj/src/main/java/org/telegram/messenger/MessageObject.java");
      expect(await readFile(path.join(ffmpeg, "build_ffmpeg_clang.sh"), "utf8"))
        .toContain("--enable-demuxer=apng");
      expect(await applyRawAnimation(root, getUpstream("nagram"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Crossgram PNG content sniffer JVM e2e", () => {
  let directory = "";
  const packagePath = path.join("org", "telegram", "messenger", "crossgram_animation");

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "crossgram-apng-sniffer-e2e-"));
    const packageDir = path.join(directory, packagePath);
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, "CrossgramRawAnimationSniffer.java"), await readFile(
      path.resolve("features/raw-animation/files/java", packagePath, "CrossgramRawAnimationSniffer.java"),
      "utf8",
    ), "utf8");
    await writeFile(path.join(packageDir, "Harness.java"), `package org.telegram.messenger.crossgram_animation;
import java.io.File;
public final class Harness {
  public static void main(String[] args) {
    File file = new File(args[0]);
    System.out.print(CrossgramRawAnimationSniffer.isAnimatedPng(file) ? "APNG" :
      CrossgramRawAnimationSniffer.isGif(file) ? "GIF" : "STATIC");
  }
}`, "utf8");
    await exec("javac", [
      path.join(packageDir, "CrossgramRawAnimationSniffer.java"),
      path.join(packageDir, "Harness.java"),
    ]);
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function sniff(chunks: Array<[string, Buffer]>): Promise<string> {
    const png = path.join(directory, `sample-${Math.random()}.png`);
    const signature = Buffer.from("89504e470d0a1a0a", "hex");
    const parts: Uint8Array[] = [signature];
    for (const [type, data] of chunks) {
      const header = Buffer.alloc(8);
      header.writeUInt32BE(data.length, 0);
      header.write(type, 4, 4, "ascii");
      parts.push(header, data, Buffer.alloc(4));
    }
    await writeFile(png, Buffer.concat(parts));
    const result = await exec("java", ["-cp", directory,
      "org.telegram.messenger.crossgram_animation.Harness", png]);
    return result.stdout;
  }

  it("detects acTL before image data even when the file is named .png", async () => {
    expect(await sniff([["IHDR", Buffer.alloc(13)], ["acTL", Buffer.alloc(8)]])).toBe("APNG");
  });

  it("does not mistake an ordinary PNG for animation", async () => {
    expect(await sniff([["IHDR", Buffer.alloc(13)], ["IDAT", Buffer.alloc(1)]])).toBe("STATIC");
  });
});
