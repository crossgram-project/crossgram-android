import { execFileSync } from "node:child_process";

export const E2E_COMMAND_MAX_BUFFER = 64 * 1024 * 1024;

export function runCommand(program, args, options = {}) {
  return execFileSync(program, args, {
    encoding: "utf8",
    maxBuffer: E2E_COMMAND_MAX_BUFFER,
    ...options,
  }).trim();
}
