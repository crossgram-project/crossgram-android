import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";

export const E2E_COMMAND_MAX_BUFFER: number;

export function runCommand(
  program: string,
  args: readonly string[],
  options?: Omit<ExecFileSyncOptionsWithStringEncoding, "encoding"> & { encoding?: "utf8" },
): string;
