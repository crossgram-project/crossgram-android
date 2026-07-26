import { describe, expect, it } from "vitest";

import { variantsForClient } from "../src/discover.js";

describe("build matrix", () => {
  it("limits clients without public x86 native dependencies to ARM", () => {
    expect(variantsForClient("nnngram")).toEqual(["arm64"]);
    expect(variantsForClient("nullgram")).toEqual(["arm64"]);
  });

  it("keeps only targeted 64-bit variants for clients with x86 dependencies", () => {
    expect(variantsForClient("telegram")).toEqual(["arm64", "x86_64"]);
    expect(variantsForClient("nagram")).toEqual(["arm64", "x86_64"]);
  });
});
