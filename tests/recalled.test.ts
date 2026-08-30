import { describe, expect, it } from "vitest";

import { patchRecalledChatMessageCell, patchRecalledTlrpc } from "../features/recalled/patch.js";

describe("recalled Android patch", () => {
  it("adds recalled and recalledVisible fields to modern TLRPC messages", () => {
    const source = `
    public static class Message extends TLObject {
        public boolean invert_media;
    }
        public static class TL_message extends Message {
            public void readParams(InputSerializedData stream, boolean exception) {
                flags = stream.readInt32(exception);
                out = hasFlag(flags, FLAG_1);
                flags2 = stream.readInt32(exception);
                id = stream.readInt32(exception);
            }
            public void serializeToStream(OutputSerializedData stream) {
                flags = setFlag(flags, FLAG_1, out);
                stream.writeInt32(flags);
                flags2 = setFlag(flags2, FLAG_1, offline);
                stream.writeInt32(flags2);
            }
        }
    }
    `;
    const patched = patchRecalledTlrpc(source);
    expect(patched).toContain("public boolean recalled;");
    expect(patched).toContain("public boolean recalledVisible;");
    expect(patched).toContain("recalled = hasFlag(flags, FLAG_12);");
    expect(patched).toContain("recalledVisible = hasFlag(flags2, FLAG_30);");
    expect(patched).toContain("flags = setFlag(flags, FLAG_12, recalled);");
    expect(patched).toContain("flags2 = setFlag(flags2, FLAG_30, recalledVisible);");
    expect(patchRecalledTlrpc(patched)).toBe(patched);
  });

  it("dims recalled cells and draws a trash indicator", () => {
    const source = `
        private boolean drawInstantView;
        public void drawInternal(Canvas canvas) {
            drawBackgroundInternal(canvas, false);
            drawContent(canvas, false);
            updateSelectionTextPosition();
        }
        public int getCurrentBackgroundLeft() {
            return 0;
        }
    `;
    const patched = patchRecalledChatMessageCell(source);
    expect(patched).toContain("private Drawable crossgramRecalledDrawable;");
    expect(patched).toContain("canvas.saveLayerAlpha(0, 0, getMeasuredWidth(), getMeasuredHeight(), 150");
    expect(patched).toContain("drawCrossgramRecalledIndicator(canvas);");
    expect(patched).toContain("R.drawable.msg_delete");
    expect(patchRecalledChatMessageCell(patched)).toBe(patched);
  });
});
