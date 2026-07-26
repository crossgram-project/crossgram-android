import { describe, expect, it } from "vitest";

import { variantsForClient } from "../src/discover.js";

describe("build matrix", () => {
  it("limits clients without public x86 native dependencies to ARM", () => {
    expect(variantsForClient("nnngram")).toEqual(["armAll", "arm64"]);
    expect(variantsForClient("nullgram")).toEqual(["armAll", "arm64"]);
  });

  it("keeps all variants for clients with working x86 dependencies", () => {
    expect(variantsForClient("telegram")).toEqual(["armAll", "arm64", "x86_64", "universal"]);
    expect(variantsForClient("nagram")).toEqual(["armAll", "arm64", "x86_64", "universal"]);
  });
});
