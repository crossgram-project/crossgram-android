#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  countSendRequests,
  findRpcError,
  findRpcMethod,
  findSendRequest,
  latestEventId,
} from "./mtproto-evidence.mjs";
import { runCommand } from "./run-command.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const patcherRoot = path.resolve(here, "../..");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

function run(program, args, options = {}) {
  return runCommand(program, args, options);
}

function adb(args) {
  return run(option("adb", "adb"), args);
}

function inspectSql(relayRoot, sql) {
  const inspector = path.join(relayRoot, ".agents/skills/inspect-relay/scripts/inspect-relay.mjs");
  return JSON.parse(run(process.execPath, ["--no-warnings", inspector, "sql", sql], { cwd: relayRoot }));
}

function inspectMtproto(relayRoot, args = []) {
  const inspector = path.join(relayRoot, ".agents/skills/inspect-relay/scripts/inspect-relay.mjs");
  return JSON.parse(run(
    process.execPath,
    ["--no-warnings", inspector, "mtproto", "--compact", ...args],
    { cwd: relayRoot },
  ));
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

function transportLogs() {
  return adb(["logcat", "-d", "-s", "CrossgramDirectDownload:D", "*:S"]);
}

function mergedForwardLogs() {
  return adb(["logcat", "-d", "-s", "CrossgramMergedForward:D", "CrossgramE2E:I", "*:S"]);
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

async function waitForTransport(transport, fileName, timeoutMs = 45_000) {
  const marker = `crossgram_download_transport=${transport} file=${fileName}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = transportLogs();
    if (output.includes(marker)) return output;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Android transport marker: ${marker}\n${transportLogs()}`);
}

function markerFields(output, marker) {
  const line = output.split(/\r?\n/).findLast((entry) => entry.includes(marker));
  if (!line) throw new Error(`Android marker disappeared: ${marker}`);
  return Object.fromEntries([...line.matchAll(/([a-z0-9_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]));
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

async function waitForPermanentSendRejection(relayRoot, baselineId, message, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = inspectMtproto(relayRoot, [
      "--after-id", String(baselineId),
      "--limit", "500",
    ]);
    const request = findSendRequest(snapshot, message);
    const rejection = request && findRpcError(
      snapshot,
      request.messageId,
      403,
      "CHAT_WRITE_FORBIDDEN",
    );
    if (request && rejection) return { request, rejection };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for permanent messages.sendMessage rejection: ${message}`);
}

async function waitForMtprotoRequest(relayRoot, baselineId, method, accept, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = inspectMtproto(relayRoot, [
      "--after-id", String(baselineId),
      "--limit", "500",
    ]);
    const event = (snapshot.events ?? []).find((candidate) => {
      if (candidate.direction !== "client->server") return false;
      const request = findRpcMethod(candidate.payload, method);
      return request && accept(request);
    });
    if (event) return { event, request: findRpcMethod(event.payload, method) };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Android MTProto request: ${method}`);
}

function parseTargetIds(value) {
  const ids = String(value ?? "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
  if (ids.length < 2 || new Set(ids).size !== ids.length) {
    throw new Error("--target-ids must contain at least two distinct positive Telegram message IDs");
  }
  return ids;
}

function isGenericMergedForwardPreview(value) {
  const compact = value.replace(/\s+/g, "");
  return /^(?:共)?[xX×0-9]+条消息的合并转发$/.test(compact)
    || /^(?:点击)?查看(?:[xX×0-9]+条)?(?:消息的)?(?:合并)?转发(?:消息)?$/.test(compact)
    || /^(?:合并转发|聊天记录)$/.test(compact);
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
    `SELECT m.id, m.primaryPlatformMessageId, m.text, m.deleted, p.tlMessageId, p.nativeSequence
       FROM mtproto_im_message m
       JOIN mtproto_tl_message_part p ON p.messageId=m.id
       JOIN mtproto_im_conversation c ON c.id=m.conversationId
      WHERE c.platformConversationId=${sqlString(conversation)} AND ${predicate}
      ORDER BY m.id DESC, p.ordinal LIMIT 1`,
  );
  if (!target) throw new Error("Relay has no matching message target for the requested Android operation");
  return target;
}

function nativeReplyPredicate(target) {
  return target.nativeSequence === null || target.nativeSequence === undefined
    ? ""
    : `AND json_extract(metadata, '$.qqReplyToMsgSeq')=${sqlString(String(target.nativeSequence))}`;
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

    for (const permission of [
      "android.permission.READ_PHONE_STATE",
      "android.permission.CALL_PHONE",
      "android.permission.READ_CALL_LOG",
      "android.permission.READ_PHONE_NUMBERS",
    ]) {
      adb(["shell", "pm", "grant", packageName, permission]);
    }
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
    const requireBothSides = booleanOption("require-both-sides");
    const minCount = Number(option("min-count", String(count)));
    if (source !== "server" && source !== "cache") throw new Error("--source must be server or cache");
    if (requireBothSides && (maxId <= 0 || loadType !== 3)) {
      throw new Error("--require-both-sides requires --load-type around and a positive --max-id");
    }
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
    if (maxId > 0 && loadType === 0) {
      if (Number(fields.max_id) > maxId) {
        throw new Error(`Android backward pagination returned messages newer than its anchor: max_id=${fields.max_id}, requested=${maxId}`);
      }
      if (Number(fields.min_id) >= maxId) {
        throw new Error(`Android backward pagination did not advance past its anchor: min_id=${fields.min_id}, requested=${maxId}`);
      }
    }
    if (requireBothSides
      && !(Number(fields.min_id) < maxId && Number(fields.max_id) > maxId)) {
      throw new Error(`Android around window did not span its anchor: min_id=${fields.min_id}, max_id=${fields.max_id}, requested=${maxId}`);
    }
  }

  if (command === "send-unblock") {
    const failureConversation = option("failure-conversation");
    const conversation = option("conversation");
    const replyMessage = option("message");
    if (!failureConversation) throw new Error("--failure-conversation is required for send-unblock");
    if (!conversation) throw new Error("--conversation is required for send-unblock");
    if (!replyMessage) throw new Error("--message is required for send-unblock");

    const failurePeerType = option("failure-peer-type", "user");
    const failurePeerId = resolvePeer(
      relayRoot,
      failureConversation,
      failurePeerType,
      option("failure-peer-id"),
    );
    const peerType = option("peer-type", "chat");
    const peerId = resolvePeer(relayRoot, conversation, peerType, option("peer-id"));
    const target = resolveMessageTarget(
      relayRoot,
      conversation,
      option("target-id"),
      option("target-message"),
    );
    if (target.nativeSequence === null || target.nativeSequence === undefined) {
      throw new Error("send-unblock requires a target with a stable native sequence");
    }
    const failureMessage = option("failure-message", `crossgram-send-reject-${Date.now()}`);
    const baselineId = latestEventId(inspectMtproto(relayRoot, ["--limit", "1"]));

    await dispatch(launchComponent, e2eAction, "chat", [
      ["--es", "crossgram_e2e_peer_type", peerType],
      ["--el", "crossgram_e2e_peer_id", peerId],
    ]);
    await waitFor("page_opened:chat");

    await dispatch(launchComponent, e2eAction, "send", [
      ["--es", "crossgram_e2e_peer_type", failurePeerType],
      ["--el", "crossgram_e2e_peer_id", failurePeerId],
      ["--es", "crossgram_e2e_message_base64", Buffer.from(failureMessage).toString("base64")],
      ["--ez", "crossgram_e2e_expect_send_error", true],
    ]);
    await waitFor("function_called:sendMessage");
    const rejected = await waitForPermanentSendRejection(relayRoot, baselineId, failureMessage);
    await waitFor("send_error local_id=");

    const retryWindowMs = Number(option("retry-window-ms", "12000"));
    if (!Number.isFinite(retryWindowMs) || retryWindowMs < 10_000) {
      throw new Error("--retry-window-ms must be at least 10000");
    }
    await new Promise((resolve) => setTimeout(resolve, retryWindowMs));
    const afterRetryWindow = inspectMtproto(relayRoot, [
      "--after-id", String(baselineId),
      "--limit", "500",
    ]);
    const rejectedRequestCount = countSendRequests(afterRetryWindow, failureMessage);
    if (rejectedRequestCount !== 1) {
      throw new Error(`Permanent Android send was retried ${rejectedRequestCount} times in ${retryWindowMs}ms`);
    }

    await dispatch(launchComponent, e2eAction, "reply", [
      ["--es", "crossgram_e2e_peer_type", peerType],
      ["--el", "crossgram_e2e_peer_id", peerId],
      ["--ei", "crossgram_e2e_target_message_id", target.tlMessageId],
      ["--es", "crossgram_e2e_message_base64", Buffer.from(replyMessage).toString("base64")],
    ]);
    await waitForOutcome("function_called:replyMessage", "reply_failed");
    const sent = await waitForRelayMessage(relayRoot, replyMessage);
    await waitForRelaySql(
      relayRoot,
      `SELECT id FROM mtproto_im_message
        WHERE id=${Number(sent.id)}
          AND json_extract(metadata, '$.__mtprotoRelayReplyToId')=${sqlString(target.primaryPlatformMessageId)}
          ${nativeReplyPredicate(target)}
        LIMIT 1`,
      (rows) => rows[0],
      "reply sent after permanent rejection",
    );
    process.stdout.write(`${JSON.stringify({
      ok: true,
      command,
      rejectedRequestMessageId: rejected.request.messageId,
      rejectedRequestCount,
      replyMessageId: sent.id,
    }, null, 2)}\n`);
    return;
  }

  if (command === "merged-forward") {
    const conversation = option("conversation");
    const destinationConversation = option("destination-conversation");
    if (!conversation) throw new Error("--conversation is required for merged-forward");
    if (!destinationConversation) {
      throw new Error("--destination-conversation is required for merged-forward");
    }
    const targetIds = parseTargetIds(option("target-ids"));
    const peerType = option("peer-type", "chat");
    const destinationPeerType = option("destination-peer-type", "chat");
    const peerId = resolvePeer(relayRoot, conversation, peerType, option("peer-id"));
    const destinationPeerId = resolvePeer(
      relayRoot,
      destinationConversation,
      destinationPeerType,
      option("destination-peer-id"),
    );
    const targetRows = inspectSql(
      relayRoot,
      `SELECT p.tlMessageId, m.text
         FROM mtproto_im_message m
         JOIN mtproto_tl_message_part p ON p.messageId=m.id
         JOIN mtproto_im_conversation c ON c.id=m.conversationId
        WHERE c.platformConversationId=${sqlString(conversation)}
          AND p.tlMessageId IN (${targetIds.join(",")})
        ORDER BY p.tlMessageId`,
    );
    if (targetRows.length !== targetIds.length) {
      throw new Error(`Relay resolved ${targetRows.length}/${targetIds.length} merged-forward source messages`);
    }
    const [baseline] = inspectSql(
      relayRoot,
      `SELECT COALESCE(MAX(m.id), 0) AS id,
              printf('%lld', COALESCE(MAX(CAST(m.primaryPlatformMessageId AS INTEGER)), 0)) AS platformId
         FROM mtproto_im_message m
         JOIN mtproto_im_conversation c ON c.id=m.conversationId
        WHERE c.platformConversationId=${sqlString(destinationConversation)}`,
    );
    const baselineEventId = latestEventId(inspectMtproto(relayRoot, ["--limit", "1"]));

    await dispatch(launchComponent, e2eAction, "chat", [
      ["--es", "crossgram_e2e_peer_type", destinationPeerType],
      ["--el", "crossgram_e2e_peer_id", destinationPeerId],
    ]);
    await waitFor("page_opened:chat");
    await dispatch(launchComponent, e2eAction, "merged-forward", [
      ["--es", "crossgram_e2e_peer_type", peerType],
      ["--el", "crossgram_e2e_peer_id", peerId],
      ["--es", "crossgram_e2e_target_message_ids", targetIds.join(",")],
      ["--es", "crossgram_e2e_destination_peer_type", destinationPeerType],
      ["--el", "crossgram_e2e_destination_peer_id", destinationPeerId],
    ]);
    await waitForOutcome("function_called:mergedForwardMessages", "merged_forward_failed");
    const forwardedRequest = await waitForMtprotoRequest(
      relayRoot,
      baselineEventId,
      "messages.forwardMessages",
      (request) => request.id?.length === targetIds.length
        && request.randomId?.length === targetIds.length
        && targetIds.every((id) => request.id.includes(id)),
    );
    const merged = await waitForRelaySql(
      relayRoot,
      `SELECT m.id, m.primaryPlatformMessageId, p.tlMessageId
         FROM mtproto_im_message m
         JOIN mtproto_tl_message_part p ON p.messageId=m.id
         JOIN mtproto_im_conversation c ON c.id=m.conversationId
        WHERE m.id > ${Number(baseline.id)} AND m.outgoing=1 AND m.deleted=0
          AND CAST(m.primaryPlatformMessageId AS INTEGER) > ${BigInt(baseline.platformId)}
          AND c.platformConversationId=${sqlString(destinationConversation)}
        ORDER BY m.id, p.ordinal`,
      (rows) => rows.length === 1 ? rows[0] : undefined,
      "one persisted QQ merged-forward output",
      90_000,
    );
    const collapseMarker = `collapsed removed=${targetIds.length - 1}`;
    const collapseDeadline = Date.now() + 45_000;
    while (Date.now() < collapseDeadline && !mergedForwardLogs().includes(collapseMarker)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!mergedForwardLogs().includes(collapseMarker)) {
      throw new Error(`Android did not collapse merged-forward placeholders\n${mergedForwardLogs()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const afterCollapseLogs = mergedForwardLogs();
    if (afterCollapseLogs.includes("merged_forward_failed")
      || afterCollapseLogs.includes("message_send_error")) {
      throw new Error(`Android retained a failed merged-forward placeholder\n${afterCollapseLogs}`);
    }
    const outputs = inspectSql(
      relayRoot,
      `SELECT m.id
         FROM mtproto_im_message m
         JOIN mtproto_im_conversation c ON c.id=m.conversationId
        WHERE m.id > ${Number(baseline.id)} AND m.outgoing=1 AND m.deleted=0
          AND CAST(m.primaryPlatformMessageId AS INTEGER) > ${BigInt(baseline.platformId)}
          AND c.platformConversationId=${sqlString(destinationConversation)}`,
    );
    if (outputs.length !== 1) {
      throw new Error(`QQ persisted ${outputs.length} outputs for one merged forward`);
    }

    const openBaselineEventId = latestEventId(inspectMtproto(relayRoot, ["--limit", "1"]));
    await dispatch(launchComponent, e2eAction, "open-merged-forward", [
      ["--es", "crossgram_e2e_peer_type", destinationPeerType],
      ["--el", "crossgram_e2e_peer_id", destinationPeerId],
      ["--ei", "crossgram_e2e_target_message_id", merged.tlMessageId],
    ]);
    const previewOutput = await waitForOutcome(
      "merged_forward_preview_ready",
      "open_merged_forward_failed",
      90_000,
    );
    const previewFields = markerFields(previewOutput, "merged_forward_preview_ready");
    const preview = Buffer.from(previewFields.preview_base64, "base64").toString("utf8");
    if (!preview.trim() || isGenericMergedForwardPreview(preview)) {
      throw new Error(`Android rendered a generic merged-forward preview: ${preview}`);
    }
    const sourceTexts = targetRows.map((row) => String(row.text ?? "").trim()).filter(Boolean);
    if (sourceTexts.length && !sourceTexts.some((text) => preview.includes(text.slice(0, 24)))) {
      throw new Error(`Android preview does not contain source content: ${preview}`);
    }
    const openedOutput = await waitForOutcome(
      "merged_forward_opened dialog_id=",
      "open_merged_forward_failed",
      90_000,
    );
    const openedFields = markerFields(openedOutput, "merged_forward_opened");
    const historyRequest = await waitForMtprotoRequest(
      relayRoot,
      openBaselineEventId,
      "messages.getHistory",
      (request) => request.peer?._ === "inputPeerChat"
        && Number(request.peer.chatId) === Math.abs(Number(openedFields.dialog_id)),
      90_000,
    );
    process.stdout.write(`${JSON.stringify({
      ok: true,
      command,
      sourceIds: targetIds,
      forwardRequestMessageId: forwardedRequest.event.messageId,
      mergedMessageId: merged.id,
      mergedTlMessageId: merged.tlMessageId,
      preview,
      openedDialogId: openedFields.dialog_id,
      historyRequestMessageId: historyRequest.event.messageId,
    }, null, 2)}\n`);
    return;
  }

  const peerCommands = new Set([
    "chat", "send", "search", "read", "draft", "reply", "edit", "delete", "forward", "reaction", "download",
  ]);
  if (peerCommands.has(command) || command === "all") {
    const conversation = option("conversation");
    if (!conversation) {
      if (command !== "all") throw new Error(`--conversation is required for ${command}`);
    } else {
      const peerType = option("peer-type", "chat");
      const explicitPeerId = option("peer-id");
      const peerId = resolvePeer(relayRoot, conversation, peerType, explicitPeerId);
      if (command === "draft") {
        // An active ChatActivity immediately persists its empty composer after
        // receiving updateDraftMessage, which clears the draft that this E2E
        // just saved. Move to DialogsActivity first so the real Android draft
        // controller can be observed without an active composer racing it.
        await dispatch(launchComponent, e2eAction, "dialogs");
        await waitFor("page_opened:dialogs");
      } else {
        await dispatch(launchComponent, e2eAction, "chat", [
          ["--es", "crossgram_e2e_peer_type", peerType],
          ["--el", "crossgram_e2e_peer_id", peerId],
        ]);
        await waitFor("page_opened:chat");
      }

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

      if (["read", "reply", "edit", "delete", "forward", "reaction", "download"].includes(command)) {
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

        if (command === "download") {
          const [media] = inspectSql(
            relayRoot,
            `SELECT id, size FROM mtproto_im_media
              WHERE messageId=${Number(target.id)} AND size IS NOT NULL AND size > 0
              ORDER BY ordinal, id LIMIT 1`,
          );
          if (!media) throw new Error("Relay message target has no downloadable media");
          const transport = option("transport", "direct");
          if (transport !== "direct" && transport !== "relay") {
            throw new Error("--transport must be direct or relay");
          }
          await dispatch(launchComponent, e2eAction, "download", [
            ...targetExtras,
            ["--el", "crossgram_e2e_media_id", media.id],
            ["--el", "crossgram_e2e_expected_size", media.size],
            ["--ez", "crossgram_e2e_force_http_failure", transport === "relay"],
          ]);
          await waitForOutcome("download_started", "download_failed");
          const output = await waitForOutcome("download_loaded", "download_failed", 90_000);
          const fields = markerFields(output, "download_loaded");
          if (Number(fields.media_id) !== Number(media.id) || Number(fields.bytes) !== Number(media.size)) {
            throw new Error(`Android download evidence mismatch: media=${fields.media_id}, bytes=${fields.bytes}`);
          }
          await waitForTransport(transport, fields.file);
        } else if (command === "read") {
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
                ${nativeReplyPredicate(target)}
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
