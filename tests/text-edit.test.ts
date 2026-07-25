import { describe, expect, it } from "vitest";

import { PatchError, editDeclarationBody, replaceExactlyOnce } from "../src/core/text-edit.js";

describe("semantic text edits", () => {
  it("finds a declaration body while ignoring braces in strings and comments", () => {
    const source = 'void target() {\n  const char *value = "}"; // {\n  /* } */\n}\nvoid other() {}\n';
    const updated = editDeclarationBody(source, /void\s+target\s*\(/, "sample.cpp", "target", (body) => `${body}  call();\n`);
    expect(updated).toContain('/* } */\n  call();\n}\nvoid other()');
  });

  it("fails loudly when an upstream semantic anchor drifts", () => {
    expect(() => replaceExactlyOnce("alpha alpha", "alpha", "beta", "sample.java", "anchor"))
      .toThrowError(new PatchError("sample.java", "anchor: expected one semantic anchor, found 2"));
  });
});
