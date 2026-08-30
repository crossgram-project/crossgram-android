import { access } from "node:fs/promises";
import path from "node:path";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { editDeclarationBody, replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const tlrpcFile = "TMessagesProj/src/main/java/org/telegram/tgnet/TLRPC.java";
const chatMessageCellFile = "TMessagesProj/src/main/java/org/telegram/ui/Cells/ChatMessageCell.java";

/** Add the Crossgram recalled bit to Telegram's modern Message constructor. */
export function patchRecalledTlrpc(initial: string): string {
  let source = editDeclarationBody(
    initial,
    /public\s+static\s+class\s+Message\s+extends\s+TLObject/,
    tlrpcFile,
    "patch TLRPC.Message fields",
    (body) => {
      if (body.includes("public boolean recalled;")) return body;
      return replaceRegexOnce(
        body,
        /(^\s*public\s+boolean\s+invert_media;\r?\n)/m,
        "$1        /** Crossgram: true when the server marked this message as recalled. */\n        public boolean recalled;\n        /** Crossgram: server requested rendering of recalled content (flags2.30). */\n        public boolean recalledVisible;\n",
        "public boolean recalled;",
        tlrpcFile,
        "expose recalled state on TLRPC.Message",
      );
    },
  );
  source = editDeclarationBody(
    source,
    /public\s+static\s+class\s+TL_message\s+extends\s+Message/,
    tlrpcFile,
    "patch modern TL_message flags",
    (body) => {
      let updated = body;
      if (!updated.includes("recalled = hasFlag(flags, FLAG_12);")) {
        updated = replaceRegexOnce(
          updated,
          /(^\s*flags\s*=\s*stream\.readInt32\(exception\);\r?\n\s*out\s*=\s*hasFlag\(flags, FLAG_1\);)/m,
          "$1\n            recalled = hasFlag(flags, FLAG_12);",
          "recalled = hasFlag(flags, FLAG_12);",
          tlrpcFile,
          "decode recalled from message flags bit 12",
        );
      }
      if (!updated.includes("flags = setFlag(flags, FLAG_12, recalled);")) {
        updated = replaceRegexOnce(
          updated,
          /(^\s*flags\s*=\s*setFlag\(flags, FLAG_1, out\);\r?\n)/m,
          "$1            flags = setFlag(flags, FLAG_12, recalled);\n",
          "flags = setFlag(flags, FLAG_12, recalled);",
          tlrpcFile,
          "encode recalled into message flags bit 12",
        );
      }
      if (!updated.includes("recalledVisible = hasFlag(flags2, FLAG_30);")) {
        updated = replaceRegexOnce(
          updated,
          /(^\s*flags2\s*=\s*stream\.readInt32\(exception\);)/m,
          "$1\n            recalledVisible = hasFlag(flags2, FLAG_30);",
          "recalledVisible = hasFlag(flags2, FLAG_30);",
          tlrpcFile,
          "decode recalled visibility hint from flags2 bit 30",
        );
      }
      if (!updated.includes("flags2 = setFlag(flags2, FLAG_30, recalledVisible);")) {
        updated = replaceRegexOnce(
          updated,
          /(^\s*flags2\s*=\s*setFlag\(flags2, FLAG_1, offline\);)/m,
          "$1\n            flags2 = setFlag(flags2, FLAG_30, recalledVisible);",
          "flags2 = setFlag(flags2, FLAG_30, recalledVisible);",
          tlrpcFile,
          "encode recalled visibility hint into flags2 bit 30",
        );
      }
      return updated;
    },
  );
  return source;
}

/** Render recalled messages with reduced opacity and a small delete icon. */
export function patchRecalledChatMessageCell(initial: string): string {
  let source = replaceRegexOnce(
    initial,
    /(^\s*private\s+boolean\s+drawInstantView;\r?\n)/m,
    "$1    private Drawable crossgramRecalledDrawable;\n",
    "crossgramRecalledDrawable;",
    chatMessageCellFile,
    "cache recalled-message indicator drawable",
  );

  source = editDeclarationBody(
    source,
    /public\s+void\s+drawInternal\s*\(\s*Canvas\s+canvas\s*\)/,
    chatMessageCellFile,
    "patch recalled message drawing",
    (body) => {
      let updated = body;
      if (!updated.includes("final int crossgramRecalledLayer")) {
        updated = replaceRegexOnce(
          updated,
          /(^\s*drawBackgroundInternal\(canvas, false\);)/m,
          "        final boolean crossgramRecalled = currentMessageObject.messageOwner != null && currentMessageObject.messageOwner.recalled;\n        final int crossgramRecalledLayer = crossgramRecalled ? canvas.saveLayerAlpha(0, 0, getMeasuredWidth(), getMeasuredHeight(), 150, Canvas.ALL_SAVE_FLAG) : -1;\n\n$1",
          "final int crossgramRecalledLayer",
          chatMessageCellFile,
          "dim recalled message contents while preserving layout",
        );
      }
      if (!updated.includes("drawCrossgramRecalledIndicator(canvas);")) {
        updated = replaceRegexOnce(
          updated,
          /(^\s*updateSelectionTextPosition\(\);\r?\n)/m,
          "        if (crossgramRecalledLayer != -1) {\n            canvas.restoreToCount(crossgramRecalledLayer);\n            drawCrossgramRecalledIndicator(canvas);\n        }\n\n$1",
          "drawCrossgramRecalledIndicator(canvas);",
          chatMessageCellFile,
          "draw recalled trash indicator after message overlays",
        );
      }
      return updated;
    },
  );

  source = replaceRegexOnce(
    source,
    /(^\s*public int getCurrentBackgroundLeft\(\) \{)/m,
    `    private void drawCrossgramRecalledIndicator(Canvas canvas) {
        if (currentMessageObject == null || currentMessageObject.messageOwner == null || !currentMessageObject.messageOwner.recalled) {
            return;
        }
        if (crossgramRecalledDrawable == null) {
            crossgramRecalledDrawable = getContext().getResources().getDrawable(R.drawable.msg_delete).mutate();
            crossgramRecalledDrawable.setColorFilter(new PorterDuffColorFilter(getThemedColor(Theme.key_chat_messagePanelIcons), PorterDuff.Mode.SRC_IN));
        }
        final int size = dp(14);
        final int right = getCurrentBackgroundRight() - dp(4);
        final int bottom = currentBackgroundDrawable != null ? currentBackgroundDrawable.getBounds().bottom - dp(4) : getMeasuredHeight() - dp(4);
        crossgramRecalledDrawable.setAlpha(220);
        crossgramRecalledDrawable.setBounds(right - size, bottom - size, right, bottom);
        crossgramRecalledDrawable.draw(canvas);
    }

$1`,
    "private void drawCrossgramRecalledIndicator(Canvas canvas)",
    chatMessageCellFile,
    "provide recalled indicator drawing helper",
  );

  return source;
}

export async function applyRecalled(root: string, _upstream: Upstream): Promise<string[]> {
  const changedFiles: string[] = [];
  const tlrpcTarget = path.join(root, tlrpcFile);
  const cellTarget = path.join(root, chatMessageCellFile);
  // All Telegram-derived Android clients currently keep these Java files. If a
  // fork moves either class, leave it untouched rather than applying a partial
  // patch and breaking its build.
  const filesPresent = await Promise.all([
    access(tlrpcTarget).then(() => true, () => false),
    access(cellTarget).then(() => true, () => false),
  ]);
  if (!filesPresent.every(Boolean)) return [];
  const tlrpcSource = await readUtf8(tlrpcTarget);
  const cellSource = await readUtf8(cellTarget);
  if (!/public\s+static\s+class\s+Message\s+extends\s+TLObject/.test(tlrpcSource)
    || !/public\s+static\s+class\s+TL_message\s+extends\s+Message/.test(tlrpcSource)
    || !/public\s+void\s+drawInternal\s*\(\s*Canvas\s+canvas\s*\)/.test(cellSource)) {
    return [];
  }
  const patchedTlrpc = patchRecalledTlrpc(tlrpcSource);
  const patchedCell = patchRecalledChatMessageCell(cellSource);
  if (await writeUtf8IfChanged(tlrpcTarget, patchedTlrpc)) {
    changedFiles.push(tlrpcFile);
  }
  if (await writeUtf8IfChanged(cellTarget, patchedCell)) {
    changedFiles.push(chatMessageCellFile);
  }
  return changedFiles;
}
