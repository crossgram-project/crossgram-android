import { describe, expect, it } from "vitest";

import { variantsForClient } from "../src/discover.js";
import { getUpstream, gradleTaskForVariant } from "../src/upstreams.js";

describe("build matrix", () => {
  it("limits clients without public x86 native dependencies to ARM", () => {
    expect(variantsForClient("nnngram")).toEqual(["arm64"]);
    expect(variantsForClient("nullgram")).toEqual(["arm64"]);
    expect(variantsForClient("forkgram")).toEqual(["arm64"]);
  });

  it("keeps only targeted 64-bit variants for clients with x86 dependencies", () => {
    expect(variantsForClient("telegram")).toEqual(["arm64", "x86_64"]);
    expect(variantsForClient("nagram")).toEqual(["arm64", "x86_64"]);
    expect(variantsForClient("mercurygram")).toEqual(["arm64", "x86_64"]);
  });

  it("selects Mercurygram's per-ABI release flavors", () => {
    const mercurygram = getUpstream("mercurygram");
    expect(gradleTaskForVariant(mercurygram, "arm64"))
      .toBe(":TMessagesProj_App:assembleAfatFdArm64Release");
    expect(gradleTaskForVariant(mercurygram, "x86_64"))
      .toBe(":TMessagesProj_App:assembleAfatFdX86_64Release");
  });

  it("installs both legacy native and TDLib NDKs for Forkgram", () => {
    expect(getUpstream("forkgram")).toMatchObject({
      ndkVersion: "27.2.12479018",
      nativeDepsNdkVersion: "21.4.7075529",
      tdlibNdkVersion: "23.2.8568313",
    });
  });
});
