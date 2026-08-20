import path from "node:path";

import { readUtf8, writeUtf8IfChanged } from "../../src/core/files.js";
import { replaceRegexOnce } from "../../src/core/text-edit.js";
import type { Upstream } from "../../src/upstreams.js";

const reactionsLayoutFile =
  "TMessagesProj/src/main/java/org/telegram/ui/Components/Reactions/ReactionsLayoutInBubble.java";

export function patchReactionOrder(initial: string): string {
  return replaceRegexOnce(
    initial,
    /(^[ \t]*public\s+int\s+compare\s*\(ReactionButton\s+o1,\s*ReactionButton\s+o2\)\s*\{\r?\n)[\s\S]*?(?=^[ \t]*\/\/\s*TLRPC\.TL_availableReaction\s+availableReaction1)/m,
    `$1            // CROSSGRAM: keep the reaction the user selected most recently at the front.
            if (o1.paid != o2.paid) {
                return o1.paid ? -1 : 1;
            } else if (o1.isSelected != o2.isSelected) {
                return o1.isSelected ? -1 : 1;
            } else if (o1.isSelected && o1.choosenOrder != o2.choosenOrder) {
                return Integer.compare(o2.choosenOrder, o1.choosenOrder);
            } else if (dialogId < 0 && o1.realCount != o2.realCount) {
                return Integer.compare(o2.realCount, o1.realCount);
            }
`,
    "CROSSGRAM: keep the reaction the user selected most recently at the front.",
    reactionsLayoutFile,
    "prioritize selected reactions consistently in private and group chats",
  );
}

export function patchReactionActorPreview(initial: string): string {
  return replaceRegexOnce(
    initial,
    /else if \(reactionCount\.count <= 3 && totalCount <= 3\) \{/,
    `else if (!messageObject.messageOwner.reactions.recent_reactions.isEmpty()) {
                            // CROSSGRAM: show the latest known actors as the bubble preview even
                            // when the full reaction list contains more than three people.`,
    "CROSSGRAM: show the latest known actors as the bubble preview",
    reactionsLayoutFile,
    "show recent reaction actors instead of a count-only preview",
  );
}

export async function applyReactionOrder(root: string, upstream: Upstream): Promise<string[]> {
  if (upstream.id !== "nagram") return [];
  const target = path.join(root, reactionsLayoutFile);
  const patched = patchReactionActorPreview(patchReactionOrder(await readUtf8(target)));
  if (!await writeUtf8IfChanged(target, patched)) return [];
  return [reactionsLayoutFile];
}
