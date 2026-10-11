import { SHEET_MAX_ATTEMPTS } from "./config.js";
import type { Outcome, PhotoNote, Recovery, Responder, ResponderStatus } from "./types.js";

export type SqlValue = string | number | null;

export interface D1Statement {
  bind(...values: SqlValue[]): D1Statement;
  run(): Promise<{ meta: { changes: number } }>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}

export interface D1Like {
  prepare(query: string): D1Statement;
}

type RecoveryRow = {
  id: string;
  requester_name: string;
  phone: string;
  lat: number;
  lon: number;
  injuries: string;
  vehicle: string;
  situation: string;
  county: string;
  photo_urls_json: string;
  attachment_notes_json: string;
  attached_photo_count: number;
  public_channel_id: string | null;
  public_message_id: string | null;
  thread_id: string | null;
  roster_message_id: string | null;
  closeout_message_id: string | null;
  status: "open" | "closed";
  outcome: Outcome | null;
  closed_by_discord_id: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  created_at: string;
};

type ResponderRow = {
  recovery_id: string;
  discord_user_id: string;
  discord_username: string;
  display_name: string;
  status: ResponderStatus;
  created_at: string;
  updated_at: string;
};

export type IdempotencyRow = {
  key: string;
  recoveryId: string | null;
  responseJson: string | null;
  status: "pending" | "complete";
  createdAt: string;
  updatedAt: string;
};

type IdempotencySqlRow = {
  key: string;
  recovery_id: string | null;
  response_json: string | null;
  status: "pending" | "complete";
  created_at: string;
  updated_at: string;
};

export type OutboxRow = {
  id: number;
  kind: "claim" | "outcome";
  payloadJson: string;
  attempts: number;
  lastError: string | null;
};

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function mapRecovery(row: RecoveryRow): Recovery {
  return {
    id: row.id,
    requesterName: row.requester_name,
    phone: row.phone,
    lat: row.lat,
    lon: row.lon,
    injuries: row.injuries,
    vehicle: row.vehicle,
    situation: row.situation,
    county: row.county,
    photoUrls: parseJsonArray<string>(row.photo_urls_json),
    attachmentNotes: parseJsonArray<PhotoNote>(row.attachment_notes_json),
    attachedPhotoCount: row.attached_photo_count,
    publicChannelId: row.public_channel_id,
    publicMessageId: row.public_message_id,
    threadId: row.thread_id,
    rosterMessageId: row.roster_message_id,
    closeoutMessageId: row.closeout_message_id,
    status: row.status,
    outcome: row.outcome,
    closedByDiscordId: row.closed_by_discord_id,
    closedByName: row.closed_by_name,
    closedAt: row.closed_at,
    createdAt: row.created_at,
  };
}

function mapResponder(row: ResponderRow): Responder {
  return {
    recoveryId: row.recovery_id,
    discordUserId: row.discord_user_id,
    discordUsername: row.discord_username,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RECOVERY_COLUMNS = `id, requester_name, phone, lat, lon, injuries, vehicle, situation, county,
  photo_urls_json, attachment_notes_json, attached_photo_count, public_channel_id, public_message_id,
  thread_id, roster_message_id, closeout_message_id, status, outcome, closed_by_discord_id,
  closed_by_name, closed_at, created_at`;

export async function getRecovery(db: D1Like, id: string): Promise<Recovery | null> {
  const row = await db
    .prepare(`SELECT ${RECOVERY_COLUMNS} FROM recoveries WHERE id = ?`)
    .bind(id)
    .first<RecoveryRow>();
  return row ? mapRecovery(row) : null;
}

export async function insertRecovery(
  db: D1Like,
  recovery: {
    id: string;
    requesterName: string;
    phone: string;
    lat: number;
    lon: number;
    injuries: string;
    vehicle: string;
    situation: string;
    county: string;
    photoUrls: string[];
    createdAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO recoveries (
        id, requester_name, phone, lat, lon, injuries, vehicle, situation, county, photo_urls_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      recovery.id,
      recovery.requesterName,
      recovery.phone,
      recovery.lat,
      recovery.lon,
      recovery.injuries,
      recovery.vehicle,
      recovery.situation,
      recovery.county,
      JSON.stringify(recovery.photoUrls),
      recovery.createdAt,
    )
    .run();
}

export async function saveAttachmentPlan(
  db: D1Like,
  id: string,
  attachedCount: number,
  notes: PhotoNote[],
): Promise<void> {
  await db
    .prepare(
      `UPDATE recoveries SET attached_photo_count = ?, attachment_notes_json = ? WHERE id = ?`,
    )
    .bind(attachedCount, JSON.stringify(notes), id)
    .run();
}

export async function savePublicMessage(
  db: D1Like,
  id: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE recoveries SET public_channel_id = ?, public_message_id = ? WHERE id = ?`)
    .bind(channelId, messageId, id)
    .run();
}

export async function saveThreadId(db: D1Like, id: string, threadId: string): Promise<void> {
  await db.prepare(`UPDATE recoveries SET thread_id = ? WHERE id = ?`).bind(threadId, id).run();
}

export async function saveRosterMessage(db: D1Like, id: string, messageId: string): Promise<void> {
  await db.prepare(`UPDATE recoveries SET roster_message_id = ? WHERE id = ?`).bind(messageId, id).run();
}

export async function saveCloseoutMessage(db: D1Like, id: string, messageId: string): Promise<void> {
  await db.prepare(`UPDATE recoveries SET closeout_message_id = ? WHERE id = ?`).bind(messageId, id).run();
}

export async function markClosed(
  db: D1Like,
  id: string,
  outcome: Outcome,
  actorId: string,
  actorName: string,
  closedAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE recoveries
       SET status = 'closed', outcome = ?, closed_by_discord_id = ?, closed_by_name = ?, closed_at = ?
       WHERE id = ? AND status = 'open'`,
    )
    .bind(outcome, actorId, actorName, closedAt, id)
    .run();
  return result.meta.changes === 1;
}

export async function deleteOpenRecovery(db: D1Like, id: string): Promise<void> {
  await db.prepare(`DELETE FROM responders WHERE recovery_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM recoveries WHERE id = ? AND public_message_id IS NULL`).bind(id).run();
}

export async function listResponders(db: D1Like, recoveryId: string): Promise<Responder[]> {
  const rows = await db
    .prepare(
      `SELECT recovery_id, discord_user_id, discord_username, display_name, status, created_at, updated_at
       FROM responders WHERE recovery_id = ? ORDER BY created_at ASC, discord_user_id ASC`,
    )
    .bind(recoveryId)
    .all<ResponderRow>();
  return rows.results.map(mapResponder);
}

export async function getResponder(
  db: D1Like,
  recoveryId: string,
  discordUserId: string,
): Promise<Responder | null> {
  const row = await db
    .prepare(
      `SELECT recovery_id, discord_user_id, discord_username, display_name, status, created_at, updated_at
       FROM responders WHERE recovery_id = ? AND discord_user_id = ?`,
    )
    .bind(recoveryId, discordUserId)
    .first<ResponderRow>();
  return row ? mapResponder(row) : null;
}

export async function upsertResponder(
  db: D1Like,
  responder: {
    recoveryId: string;
    discordUserId: string;
    discordUsername: string;
    displayName: string;
    status: ResponderStatus;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO responders (
        recovery_id, discord_user_id, discord_username, display_name, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(recovery_id, discord_user_id) DO UPDATE SET
        discord_username = excluded.discord_username,
        display_name = excluded.display_name,
        status = excluded.status,
        updated_at = excluded.updated_at`,
    )
    .bind(
      responder.recoveryId,
      responder.discordUserId,
      responder.discordUsername,
      responder.displayName,
      responder.status,
      responder.now,
      responder.now,
    )
    .run();
}

export async function getIdempotency(db: D1Like, key: string): Promise<IdempotencyRow | null> {
  const row = await db
    .prepare(
      `SELECT key, recovery_id, response_json, status, created_at, updated_at FROM idempotency_keys WHERE key = ?`,
    )
    .bind(key)
    .first<IdempotencySqlRow>();
  if (!row) return null;
  return {
    key: row.key,
    recoveryId: row.recovery_id,
    responseJson: row.response_json,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertIdempotencyPending(
  db: D1Like,
  key: string,
  recoveryId: string,
  now: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO idempotency_keys (key, recovery_id, response_json, status, created_at, updated_at)
       VALUES (?, ?, NULL, 'pending', ?, ?)`,
    )
    .bind(key, recoveryId, now, now)
    .run();
  return result.meta.changes === 1;
}

export async function setIdempotencyRecovery(
  db: D1Like,
  key: string,
  recoveryId: string,
  now: string,
): Promise<void> {
  await db
    .prepare(`UPDATE idempotency_keys SET recovery_id = ?, updated_at = ? WHERE key = ?`)
    .bind(recoveryId, now, key)
    .run();
}

export async function completeIdempotency(
  db: D1Like,
  key: string,
  recoveryId: string,
  responseJson: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE idempotency_keys
       SET status = 'complete', recovery_id = ?, response_json = ?, updated_at = ?
       WHERE key = ?`,
    )
    .bind(recoveryId, responseJson, now, key)
    .run();
}

export async function deleteIdempotency(db: D1Like, key: string): Promise<void> {
  await db.prepare(`DELETE FROM idempotency_keys WHERE key = ?`).bind(key).run();
}

export async function hasInteractionReceipt(db: D1Like, interactionId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT interaction_id FROM interaction_receipts WHERE interaction_id = ?`)
    .bind(interactionId)
    .first<{ interaction_id: string }>();
  return row !== null;
}

export async function saveInteractionReceipt(
  db: D1Like,
  interactionId: string,
  recoveryId: string,
  action: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO interaction_receipts (interaction_id, recovery_id, action, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(interactionId, recoveryId, action, now)
    .run();
}

export async function enqueueSheetOutbox(
  db: D1Like,
  kind: "claim" | "outcome",
  values: string[],
  lastError: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sheet_outbox (kind, payload_json, attempts, last_error, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?)`,
    )
    .bind(kind, JSON.stringify({ kind, values }), lastError, now, now)
    .run();
}

export async function listSheetOutbox(db: D1Like, limit: number): Promise<OutboxRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, kind, payload_json, attempts, last_error
       FROM sheet_outbox WHERE attempts < ? ORDER BY id ASC LIMIT ?`,
    )
    .bind(SHEET_MAX_ATTEMPTS, limit)
    .all<{ id: number; kind: "claim" | "outcome"; payload_json: string; attempts: number; last_error: string | null }>();
  return rows.results.map((row) => ({
    id: row.id,
    kind: row.kind,
    payloadJson: row.payload_json,
    attempts: row.attempts,
    lastError: row.last_error,
  }));
}

export async function deleteSheetOutbox(db: D1Like, id: number): Promise<void> {
  await db.prepare(`DELETE FROM sheet_outbox WHERE id = ?`).bind(id).run();
}

export async function bumpSheetOutbox(db: D1Like, id: number, lastError: string, now: string): Promise<void> {
  await db
    .prepare(`UPDATE sheet_outbox SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`)
    .bind(lastError, now, id)
    .run();
}
