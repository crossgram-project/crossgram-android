import { describe, expect, it } from "vitest";

import { patchReactionActorPreview, patchReactionOrder } from "../features/reaction-order/patch.js";

function upstreamComparator(newline = "\n"): string {
  return `private static class ButtonsComparator implements Comparator<ReactionButton> {${newline}
        long dialogId;${newline}
${newline}
        @Override${newline}
        public int compare(ReactionButton o1, ReactionButton o2) {${newline}
            if (dialogId >= 0) {${newline}
                if (o1.paid != o2.paid) {${newline}
                    return o1.paid ? -1 : 1;${newline}
                } else if (o1.isSelected != o2.isSelected) {${newline}
                    return o1.isSelected ? -1 : 1;${newline}
                } else if (o1.isSelected) {${newline}
                    if (o1.choosenOrder != o2.choosenOrder) {${newline}
                        return o1.choosenOrder - o2.choosenOrder;${newline}
                    }${newline}
                }${newline}
                return o1.reactionCount.lastDrawnPosition - o2.reactionCount.lastDrawnPosition;${newline}
            } else {${newline}
                if (o1.paid != o2.paid) {${newline}
                    return o1.paid ? -1 : 1;${newline}
                } else if (o1.realCount != o2.realCount) {${newline}
                    return o2.realCount - o1.realCount;${newline}
                }${newline}
            }${newline}
//            TLRPC.TL_availableReaction availableReaction1 = null;${newline}
            return o1.reactionCount.lastDrawnPosition - o2.reactionCount.lastDrawnPosition;${newline}
        }${newline}
    }`;
}

describe("reaction order patch", () => {
  it("puts selected reactions before unselected reactions in every dialog", () => {
    const patched = patchReactionOrder(upstreamComparator());

    expect(patched).toContain("else if (o1.isSelected != o2.isSelected)");
    expect(patched.indexOf("o1.isSelected != o2.isSelected"))
      .toBeLessThan(patched.indexOf("dialogId < 0 && o1.realCount"));
    expect(patched).not.toContain("if (dialogId >= 0)");
  });

  it("shows up to three current actors even when the total reaction count is larger", () => {
    const upstream = `if (!isSmall && !isTag && messageObject.messageOwner.reactions.recent_reactions != null) {
                        ArrayList<TLObject> users = null;
                        if (messageObject.getDialogId() > 0) {
                            users = new ArrayList<>();
                        } else if (reactionCount.count <= 3 && totalCount <= 3) {
                            users = new ArrayList<>();
                        }
                    }`;
    const patched = patchReactionActorPreview(upstream);

    expect(patched).toContain("!messageObject.messageOwner.reactions.recent_reactions.isEmpty()")
    expect(patched).toContain("CROSSGRAM: show the latest known actors as the bubble preview")
    expect(patched).not.toContain("reactionCount.count <= 3 && totalCount <= 3")
    expect(patchReactionActorPreview(patched)).toBe(patched)
  });

  it("sorts selected reactions by descending chosen order", () => {
    const patched = patchReactionOrder(upstreamComparator());

    expect(patched).toContain("Integer.compare(o2.choosenOrder, o1.choosenOrder)");
    expect(patched).not.toContain("o1.choosenOrder - o2.choosenOrder");
  });

  it("keeps count ordering for unselected group reactions", () => {
    const patched = patchReactionOrder(upstreamComparator());

    expect(patched).toContain("dialogId < 0 && o1.realCount != o2.realCount");
    expect(patched).toContain("Integer.compare(o2.realCount, o1.realCount)");
    expect(patched).toContain("o1.reactionCount.lastDrawnPosition - o2.reactionCount.lastDrawnPosition");
  });

  it("is idempotent and accepts CRLF upstream source", () => {
    const patched = patchReactionOrder(upstreamComparator("\r\n"));

    expect(patched).toContain("CROSSGRAM: keep the reaction the user selected most recently at the front.");
    expect(patchReactionOrder(patched)).toBe(patched);
  });
});
