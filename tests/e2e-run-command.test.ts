import { describe, expect, it } from "vitest";

import {
  E2E_COMMAND_MAX_BUFFER,
  runCommand,
} from "../scripts/e2e/run-command.mjs";

describe("Android server E2E command runner", () => {
  it("captures inspector output larger than Node's 1 MiB default buffer", () => {
    const bytes = 2 * 1024 * 1024;
    const output = runCommand(process.execPath, [
      "-e",
      `process.stdout.write("x".repeat(${bytes}))`,
    ]);

    expect(output).toHaveLength(bytes);
    expect(output.startsWith("xxxx")).toBe(true);
    expect(output.endsWith("xxxx")).toBe(true);
  });

  it("keeps enough headroom for the relay MTProto capture ring", () => {
    expect(E2E_COMMAND_MAX_BUFFER).toBe(64 * 1024 * 1024);
  });
});
