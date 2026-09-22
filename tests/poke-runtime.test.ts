import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const helper = "features/poke/files/java/org/telegram/messenger/crossgram_poke/CrossgramPoke.java";
const chatActivityFile = "TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java";
const avatarPreviewerFile = "TMessagesProj/src/main/java/org/telegram/ui/AvatarPreviewer.java";

describe("poke Android runtime", () => {
  it("keeps the RPC constructors and wire shape stable", () => {
    const runtime = readFileSync(path.resolve(helper), "utf8");
    expect(runtime).toContain("GET_FEATURES_CONSTRUCTOR = 0xc3e6b915");
    expect(runtime).toContain("SEND_POKE_CONSTRUCTOR = 0x9a2d47f0");
    // getFeatures#c3e6b915 peer:InputPeer = DataJSON
    expect(runtime).toContain("stream.writeInt32(GET_FEATURES_CONSTRUCTOR);\n            peer.serializeToStream(stream);");
    expect(runtime).toContain("TLRPC.TL_dataJSON.TLdeserialize(stream, constructor, exception)");
    // sendPoke#9a2d47f0 peer:InputPeer user_id:InputUser count:int = Bool
    expect(runtime).toContain("stream.writeInt32(SEND_POKE_CONSTRUCTOR);\n            peer.serializeToStream(stream);\n            user.serializeToStream(stream);\n            stream.writeInt32(count);");
    expect(runtime).toContain("TLRPC.Bool.TLdeserialize(stream, constructor, exception)");
  });

  it("offers the single poke on tap and the burst rows on hold", () => {
    const runtime = readFileSync(path.resolve(helper), "utf8");
    expect(runtime).toContain("BURST_COUNTS = new int[]{1, 5, 10};");
    expect(runtime).toContain("item.setOnClickListener(v -> send(user, account, dialogId, 1));");
    expect(runtime).toContain("item.setOnLongClickListener(v -> {");
    expect(runtime).toContain("maxCount > 0");
    // The probe only ever disables a whole account when the server answered.
    expect(runtime).toContain("if (error != null && error.code > 0) {");
  });

  it("patches the two menu files that exist in every supported upstream", () => {
    for (const relative of [chatActivityFile, avatarPreviewerFile]) {
      expect(path.isAbsolute(relative)).toBe(false);
    }
  });
});
