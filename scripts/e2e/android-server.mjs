#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const patcherRoot = path.resolve(here, "../..");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

function run(program, args, options = {}) {
  return execFileSync(program, args, { encoding: "utf8", ...options }).trim();
}

function adb(args) {
  return run(option("adb", "adb"), args);
}

function inspectSql(relayRoot, sql) {
  const inspector = path.join(relayRoot, ".agents/skills/inspect-relay/scripts/inspect-relay.mjs");
  return JSON.parse(run(process.execPath, [inspector, "sql", sql], { cwd: relayRoot }));
}

function loginCode(secret, now = Date.now()) {
  const counter = Math.floor(now / 1000 / 30);
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(secret, "hex")).update(input).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

function stableId(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 0x7ffffffe + 1;
}

function start(component, extras, action) {
  const args = ["shell", "am", "start", "-W", "-n", component];
  if (action) args.push("-a", action);
  for (const [type, name, value] of extras) args.push(type, name, String(value));
  adb(args);
}

function logs() {
  return adb(["logcat", "-d", "-s", "CrossgramE2E:I", "*:S"]);
}

async function waitFor(marker, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = logs();
    if (output.includes(marker)) return output;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Android marker: ${marker}\n${logs()}`);
}

async function dispatch(component, action, command, extras = []) {
  start(component, [["--es", "crossgram_e2e_command", command], ...extras], action);
}

async function main() {
  const command = option("command", "all");
  const packageName = option("package", "xyz.nextalone.nagram.crossgram.qq");
  const dispatcherComponent = `${packageName}/org.telegram.ui.CrossgramE2eActivity`;
  const launchComponent = `${packageName}/org.telegram.ui.LaunchActivity`;
  const e2eAction = "org.telegram.messenger.CROSSGRAM_E2E";
  const relayRoot = path.resolve(option("relay-root", path.join(patcherRoot, "../crossgram")));
  const host = option("host", "10.0.2.2");
  const port = Number(option("port", "4430"));

  adb(["wait-for-device"]);
  adb(["logcat", "-c"]);

  if (command === "login" || command === "all") {
    const [account] = inspectSql(
      relayRoot,
      "SELECT virtualPhone, totpSecret FROM mtproto_auth_session ORDER BY id LIMIT 1",
    );
    if (!account) throw new Error("Relay has no provisioned platform account");
    const rsa = JSON.parse(readFileSync(path.join(relayRoot, "data/rsa-key.json"), "utf8"));
    const config = {
      name: "Crossgram Android E2E",
      enable_special_config: false,
      host,
      port,
      rsa_key: rsa.publicKeyPem,
    };
    const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    if (remaining < 8) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
    const code = loginCode(account.totpSecret);

    adb(["shell", "am", "force-stop", packageName]);
    start(dispatcherComponent, [
      ["--es", "crossgram_e2e_command", "login"],
      ["--es", "crossgram_e2e_server_config_base64", Buffer.from(JSON.stringify(config)).toString("base64")],
      ["--es", "crossgram_e2e_phone", account.virtualPhone],
      ["--es", "crossgram_e2e_code", code],
    ]);
    await waitFor("login_code_submitted");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await dispatch(launchComponent, e2eAction, "state");
    await waitFor("state activated=true");
  }

  if (command === "state") {
    await dispatch(launchComponent, e2eAction, "state");
    await waitFor("state activated=");
  }

  if (command === "dialogs" || command === "all") {
    await dispatch(launchComponent, e2eAction, "dialogs");
    await waitFor("page_opened:dialogs");
  }

  if (command === "chat" || command === "send" || command === "all") {
    const conversation = option("conversation");
    if (!conversation) {
      if (command !== "all") throw new Error("--conversation is required for chat/send");
    } else {
      const peerId = stableId(`peer:${conversation}`);
      await dispatch(launchComponent, e2eAction, "chat", [
        ["--es", "crossgram_e2e_peer_type", "chat"],
        ["--el", "crossgram_e2e_peer_id", peerId],
      ]);
      await waitFor("page_opened:chat");

      const message = option("message");
      if ((command === "send" || message) && message) {
        await dispatch(launchComponent, e2eAction, "send", [
          ["--es", "crossgram_e2e_peer_type", "chat"],
          ["--el", "crossgram_e2e_peer_id", peerId],
          ["--es", "crossgram_e2e_message", message],
        ]);
        await waitFor("function_called:sendMessage");
      }
    }
  }

  process.stdout.write(`${JSON.stringify({ ok: true, command }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
