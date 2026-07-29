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
  return JSON.parse(run(process.execPath, ["--no-warnings", inspector, "sql", sql], { cwd: relayRoot }));
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
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

async function waitForOutcome(successMarker, failureMarker, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = logs();
    if (output.includes(failureMarker)) {
      const line = output.split(/\r?\n/).findLast((entry) => entry.includes(failureMarker));
      throw new Error(`Android reported failure: ${line ?? failureMarker}`);
    }
    if (output.includes(successMarker)) return output;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Android marker: ${successMarker}\n${logs()}`);
}

function markerFields(output, marker) {
  const line = output.split(/\r?\n/).findLast((entry) => entry.includes(marker));
  if (!line) throw new Error(`Android marker disappeared: ${marker}`);
  return Object.fromEntries([...line.matchAll(/([a-z_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]));
}

function booleanOption(name, fallback = false) {
  const value = option(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${name} must be true or false`);
}

function historyLoadType(value, source, maxId) {
  const selected = value === "auto" ? (source === "server" && maxId === 0 ? "initial" : "backward") : value;
  const types = { backward: 0, forward: 1, initial: 2, around: 3, date: 4 };
  if (!(selected in types)) throw new Error("--load-type must be auto, initial, backward, forward, around or date");
  return types[selected];
}

async function waitForRelayMessage(relayRoot, message, timeoutMs = 45_000) {
  return waitForRelaySql(
    relayRoot,
    `SELECT m.id, m.primaryPlatformMessageId, p.tlMessageId
       FROM mtproto_im_message m
       JOIN mtproto_tl_message_part p ON p.messageId=m.id
      WHERE m.text=${sqlString(message)} AND m.outgoing=1 AND m.deleted=0
      ORDER BY m.id DESC, p.ordinal LIMIT 1`,
    (rows) => rows[0],
    "outgoing Android message",
    timeoutMs,
  );
}

async function waitForRelaySql(relayRoot, sql, accept, description, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = accept(inspectSql(relayRoot, sql));
      if (result) return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/database is (locked|busy)/i.test(message)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for relay evidence: ${description}`);
}

async function dispatch(component, action, command, extras = []) {
  start(component, [["--es", "crossgram_e2e_command", command], ...extras], action);
}

function resolvePeer(relayRoot, conversation, peerType, explicitPeerId) {
  if (explicitPeerId) return Number(explicitPeerId);
  if (peerType !== "user") return stableId(`peer:${conversation}`);
  const [user] = inspectSql(
    relayRoot,
    `SELECT id FROM mtproto_im_user WHERE platformUserId=${sqlString(conversation)} ORDER BY id LIMIT 1`,
  );
  if (!user) throw new Error(`Relay has no user mapping for direct conversation: ${conversation}`);
  return user.id;
}

function resolveMessageTarget(relayRoot, conversation, explicitTlId, targetMessage) {
  if (!explicitTlId && !targetMessage) {
    throw new Error("--target-id or --target-message is required for this message operation");
  }
  const predicate = explicitTlId
    ? `p.tlMessageId=${Number(explicitTlId)}`
    : `m.text=${sqlString(targetMessage ?? "")}`;
  const [target] = inspectSql(
    relayRoot,
    `SELECT m.id, m.primaryPlatformMessageId, m.text, m.deleted, p.tlMessageId
       FROM mtproto_im_message m
       JOIN mtproto_tl_message_part p ON p.messageId=m.id
       JOIN mtproto_im_conversation c ON c.id=m.conversationId
      WHERE c.platformConversationId=${sqlString(conversation)} AND ${predicate}
      ORDER BY m.id DESC, p.ordinal LIMIT 1`,
  );
  if (!target) throw new Error("Relay has no matching message target for the requested Android operation");
  return target;
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

  if (command === "history") {
    const conversation = option("conversation");
    if (!conversation) throw new Error("--conversation is required for history");
    const peerType = option("peer-type", "chat");
    const peerId = resolvePeer(relayRoot, conversation, peerType, option("peer-id"));
    const count = Number(option("count", "50"));
    const maxId = Number(option("max-id", "0"));
    const source = option("source", "server");
    const cold = booleanOption("cold");
    const rawPeer = booleanOption("raw-peer");
    const loadType = historyLoadType(option("load-type", "auto"), source, maxId);
    const minCount = Number(option("min-count", String(count)));
    if (source !== "server" && source !== "cache") throw new Error("--source must be server or cache");
    if (cold) adb(["shell", "am", "force-stop", packageName]);
    const historyComponent = cold ? dispatcherComponent : launchComponent;
    const historyAction = cold ? undefined : e2eAction;
    await dispatch(historyComponent, historyAction, "history", [
      ["--es", "crossgram_e2e_peer_type", peerType],
      ["--el", "crossgram_e2e_peer_id", peerId],
      ["--ei", "crossgram_e2e_history_count", count],
      ["--ei", "crossgram_e2e_history_max_id", maxId],
      ["--ez", "crossgram_e2e_history_cache", source === "cache"],
      ["--ez", "crossgram_e2e_history_raw_peer", rawPeer],
      ["--ei", "crossgram_e2e_history_load_type", loadType],
    ]);
    await waitForOutcome(`function_called:loadMessages source=${source}`, "history_failed");
    const output = await waitForOutcome(`history_loaded source=${source}`, "history_failed");
    const fields = markerFields(output, `history_loaded source=${source}`);
    const loadedCount = Number(fields.count);
    const uniqueCount = Number(fields.unique_count);
    if (loadedCount < minCount) throw new Error(`Android history returned ${loadedCount}, expected at least ${minCount}`);
    if (fields.ordered_desc !== "true") throw new Error("Android history IDs are not in descending Telegram order");
    if (uniqueCount !== loadedCount) throw new Error(`Android history has duplicate/non-positive IDs: count=${loadedCount}, unique=${uniqueCount}`);
    if (maxId > 0 && Number(fields.max_id) > maxId) {
      throw new Error(`Android pagination returned messages newer than its anchor: max_id=${fields.max_id}, requested=${maxId}`);
    }
    if (maxId > 0 && Number(fields.min_id) >= maxId) {
      throw new Error(`Android pagination did not advance past its anchor: min_id=${fields.min_id}, requested=${maxId}`);
    }
  }

  const peerCommands = new Set([
    "chat", "send", "search", "read", "draft", "reply", "edit", "delete", "forward", "reaction",
  ]);
  if (peerCommands.has(command) || command === "all") {
    const conversation = option("conversation");
    if (!conversation) {
      if (command !== "all") throw new Error(`--conversation is required for ${command}`);
    } else {
      const peerType = option("peer-type", "chat");
      const explicitPeerId = option("peer-id");
      const peerId = resolvePeer(relayRoot, conversation, peerType, explicitPeerId);
      await dispatch(launchComponent, e2eAction, "chat", [
        ["--es", "crossgram_e2e_peer_type", peerType],
        ["--el", "crossgram_e2e_peer_id", peerId],
      ]);
      await waitFor("page_opened:chat");

      if (command === "send" || (command === "all" && option("message"))) {
        const message = option("message");
        if (!message) throw new Error("--message is required for send");
        await dispatch(launchComponent, e2eAction, "send", [
          ["--es", "crossgram_e2e_peer_type", peerType],
          ["--el", "crossgram_e2e_peer_id", peerId],
          ["--es", "crossgram_e2e_message_base64", Buffer.from(message).toString("base64")],
        ]);
        await waitFor("function_called:sendMessage");
        await waitForRelayMessage(relayRoot, message);
      }

      if (command === "search") {
        const query = option("query");
        if (!query) throw new Error("--query is required for search");
        await dispatch(launchComponent, e2eAction, "search", [
          ["--es", "crossgram_e2e_peer_type", peerType],
          ["--el", "crossgram_e2e_peer_id", peerId],
          ["--es", "crossgram_e2e_query_base64", Buffer.from(query).toString("base64")],
        ]);
        await waitForOutcome("function_called:searchMessagesInChat", "search_failed");
        const output = await waitForOutcome("search_loaded", "search_failed");
        const fields = markerFields(output, "search_loaded");
        const minCount = Number(option("min-count", "1"));
        if (Number(fields.count) < minCount || Number(fields.result_id) <= 0) {
          throw new Error(`Android search returned no usable result: count=${fields.count}, result_id=${fields.result_id}`);
        }
      }

      if (["read", "reply", "edit", "delete", "forward", "reaction"].includes(command)) {
        const target = resolveMessageTarget(
          relayRoot,
          conversation,
          option("target-id"),
          option("target-message"),
        );
        const targetExtras = [
          ["--es", "crossgram_e2e_peer_type", peerType],
          ["--el", "crossgram_e2e_peer_id", peerId],
          ["--ei", "crossgram_e2e_target_message_id", target.tlMessageId],
        ];

        if (command === "read") {
          await dispatch(launchComponent, e2eAction, "read", targetExtras);
          await waitFor("function_called:markDialogAsRead");
        } else if (command === "reply") {
          const message = option("message");
          if (!message) throw new Error("--message is required for reply");
          await dispatch(launchComponent, e2eAction, "reply", [
            ...targetExtras,
            ["--es", "crossgram_e2e_message_base64", Buffer.from(message).toString("base64")],
          ]);
          await waitForOutcome("function_called:replyMessage", "reply_failed");
          const sent = await waitForRelayMessage(relayRoot, message);
          await waitForRelaySql(
            relayRoot,
            `SELECT id FROM mtproto_im_message
              WHERE id=${Number(sent.id)}
                AND json_extract(metadata, '$.__mtprotoRelayReplyToId')=${sqlString(target.primaryPlatformMessageId)}
              LIMIT 1`,
            (rows) => rows[0],
            "persisted reply relationship",
          );
        } else if (command === "reaction") {
          const reaction = option("reaction", "👍");
          await dispatch(launchComponent, e2eAction, "reaction", [
            ...targetExtras,
            ["--es", "crossgram_e2e_reaction", reaction],
          ]);
          await waitForOutcome("function_called:sendReaction", "reaction_failed");
          await waitForOutcome("reaction_applied", "reaction_failed");
          await waitForRelaySql(
            relayRoot,
            `SELECT id FROM mtproto_im_message_reaction
              WHERE messageId=${Number(target.id)} AND selected=1 AND count > 0 LIMIT 1`,
            (rows) => rows[0],
            "selected message reaction",
          );
        } else if (command === "forward") {
          const destinationConversation = option("destination-conversation", conversation);
          const destinationPeerType = option("destination-peer-type", peerType);
          const destinationPeerId = resolvePeer(
            relayRoot,
            destinationConversation,
            destinationPeerType,
            option("destination-peer-id"),
          );
          const [baseline] = inspectSql(relayRoot, "SELECT COALESCE(MAX(id), 0) AS id FROM mtproto_im_message");
          await dispatch(launchComponent, e2eAction, "forward", [
            ...targetExtras,
            ["--es", "crossgram_e2e_destination_peer_type", destinationPeerType],
            ["--el", "crossgram_e2e_destination_peer_id", destinationPeerId],
          ]);
          await waitForOutcome("function_called:forwardMessages", "forward_failed");
          await waitForRelaySql(
            relayRoot,
            `SELECT m.id FROM mtproto_im_message m
               JOIN mtproto_im_conversation c ON c.id=m.conversationId
              WHERE m.id > ${Number(baseline.id)} AND m.outgoing=1 AND m.deleted=0
                AND c.platformConversationId=${sqlString(destinationConversation)}
              ORDER BY m.id LIMIT 1`,
            (rows) => rows[0],
            "forwarded outgoing message",
          );
        } else if (command === "edit") {
          const message = option("message");
          if (!message) throw new Error("--message is required for edit");
          await dispatch(launchComponent, e2eAction, "edit", [
            ...targetExtras,
            ["--es", "crossgram_e2e_message_base64", Buffer.from(message).toString("base64")],
          ]);
          await waitForOutcome("function_called:editMessage", "edit_failed");
          await waitForRelayMessage(relayRoot, message);
          await waitForRelaySql(
            relayRoot,
            `SELECT id FROM mtproto_im_message WHERE id=${Number(target.id)} AND deleted=1 LIMIT 1`,
            (rows) => rows[0],
            "delete-and-resend edit tombstone",
          );
        } else if (command === "delete") {
          await dispatch(launchComponent, e2eAction, "delete", targetExtras);
          await waitForOutcome("function_called:deleteMessages", "delete_failed");
          await waitForRelaySql(
            relayRoot,
            `SELECT id FROM mtproto_im_message WHERE id=${Number(target.id)} AND deleted=1 LIMIT 1`,
            (rows) => rows[0],
            "deleted message tombstone",
          );
        }
      }

      if (command === "draft") {
        const message = option("message", "");
        const messageExtras = message
          ? [["--es", "crossgram_e2e_message_base64", Buffer.from(message).toString("base64")]]
          : [];
        await dispatch(launchComponent, e2eAction, "draft", [
          ["--es", "crossgram_e2e_peer_type", peerType],
          ["--el", "crossgram_e2e_peer_id", peerId],
          ...messageExtras,
        ]);
        await waitFor("function_called:saveDraft");
        await waitForRelaySql(
          relayRoot,
          `SELECT id FROM mtproto_draft WHERE platformConversationId=${sqlString(conversation)} AND topMsgId=0`,
          (rows) => message ? rows[0] : rows.length === 0,
          message ? "saved draft" : "cleared draft",
        );
      }
    }
  }

  process.stdout.write(`${JSON.stringify({ ok: true, command }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
