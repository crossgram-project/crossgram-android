#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

function integerOption(name) {
  const raw = option(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`--${name} must be a safe integer`);
  return value;
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function hasColumns(db, table, required) {
  const available = new Set(columns(db, table));
  return required.every((column) => available.has(column));
}

function inspectMessages(db, dialogId, limit) {
  if (!hasColumns(db, "messages_v2", ["uid", "mid", "date", "data"])) return undefined;
  const where = dialogId === undefined ? "" : " WHERE uid = ?";
  const params = dialogId === undefined ? [] : [dialogId];
  const [summary] = db.prepare(`
    SELECT COUNT(*) AS count, MIN(mid) AS minId, MAX(mid) AS maxId,
           MIN(date) AS minDate, MAX(date) AS maxDate,
           SUM(length(data)) AS totalDataBytes
      FROM messages_v2${where}
  `).all(...params);
  const rows = db.prepare(`
    SELECT uid, mid, date, length(data) AS dataBytes
      FROM messages_v2${where}
     ORDER BY date DESC, mid DESC
     LIMIT ?
  `).all(...params, limit);
  return { summary, rows };
}

function inspectDialogBoundaries(db, dialogId) {
  if (dialogId === undefined) return undefined;
  const dialog = hasColumns(db, "dialogs", ["did", "last_mid", "date"])
    ? db.prepare("SELECT did, date, last_mid, inbox_max, outbox_max, flags FROM dialogs WHERE did = ?").get(dialogId)
    : undefined;
  const holes = hasColumns(db, "messages_holes", ["uid", "start", "end"])
    ? db.prepare("SELECT start, end FROM messages_holes WHERE uid = ? ORDER BY start").all(dialogId)
    : [];
  const peerId = Math.abs(dialogId);
  const chat = dialogId < 0 && hasColumns(db, "chats", ["uid", "data"])
    ? db.prepare("SELECT uid, length(data) AS dataBytes FROM chats WHERE uid = ?").get(peerId)
    : undefined;
  return { dialog: dialog ?? null, holes, chat: chat ?? null };
}

function main() {
  const databasePath = path.resolve(option("db", "cache4.db"));
  const dialogId = integerOption("dialog-id");
  const limit = integerOption("limit") ?? 20;
  if (limit < 1 || limit > 500) throw new Error("--limit must be between 1 and 500");

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON");
    const tables = db.prepare(`
      SELECT name, sql
        FROM sqlite_master
       WHERE type = 'table'
         AND (name LIKE '%message%' OR name LIKE '%dialog%' OR name LIKE '%chat%')
       ORDER BY name
    `).all();
    const result = {
      database: databasePath,
      dialogId: dialogId ?? null,
      journalMode: db.prepare("PRAGMA journal_mode").get().journal_mode,
      tables: tables.map(({ name, sql }) => ({ name, columns: columns(db, name), sql })),
      boundaries: inspectDialogBoundaries(db, dialogId) ?? null,
      messagesV2: inspectMessages(db, dialogId, limit) ?? null,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
