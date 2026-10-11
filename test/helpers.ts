import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex, concatBytes, toArrayBuffer } from "../src/bytes.js";
import type { D1Like, D1Statement, SqlValue } from "../src/db.js";
import type { Deps } from "../src/deps.js";
import type { DiscordApi } from "../src/discordApi.js";
import type { Env } from "../src/env.js";
import { signRangerBody } from "../src/intakeAuth.js";
import { route } from "../src/app.js";
import type { PhotoResult } from "../src/photos.js";
import type { OutgoingMessage, SheetKind } from "../src/types.js";
import { TINY_PNG, baseIntake } from "./fixtures.js";

export function openTestDb(): D1Like {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const sql = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
  for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement);
  }
  return adapt(sqlite);
}

function adapt(sqlite: DatabaseSync): D1Like {
  return {
    prepare(query: string): D1Statement {
      const stmt = sqlite.prepare(query);
      const create = (values: SqlValue[]): D1Statement => ({
        bind(...next: SqlValue[]) {
          return create(next);
        },
        async run() {
          const result = values.length > 0 ? stmt.run(...(values as never[])) : stmt.run();
          return { meta: { changes: Number(result.changes ?? 0) } };
        },
        async first<T>() {
          const row = (values.length > 0 ? stmt.get(...(values as never[])) : stmt.get()) as T | undefined;
          return row ?? null;
        },
        async all<T>() {
          const rows = (values.length > 0 ? stmt.all(...(values as never[])) : stmt.all()) as T[];
          return { results: rows ?? [] };
        },
      });
      return create([]);
    },
  };
}

export type DiscordCall = {
  op: string;
  channelId?: string;
  messageId?: string;
  message?: OutgoingMessage;
  userId?: string;
  threadId?: string;
  name?: string;
  id?: string;
};

export function createDiscordMock() {
  const calls: DiscordCall[] = [];
  let n = 0;
  let threadFailures = 0;
  let messageFailures = 0;
  let messageError: Error | null = null;
  const api: DiscordApi = {
    async createMessage(channelId, message) {
      if (messageFailures > 0) {
        messageFailures -= 1;
        const error = messageError ?? new Error("discord down");
        messageError = null;
        throw error;
      }
      const id = `msg-${++n}`;
      calls.push({ op: "createMessage", channelId, message, id });
      return { id };
    },
    async editMessage(channelId, messageId, message) {
      calls.push({ op: "editMessage", channelId, messageId, message });
    },
    async createPrivateThread(channelId, name) {
      if (threadFailures > 0) {
        threadFailures -= 1;
        throw new Error("discord down");
      }
      const id = `thread-${++n}`;
      calls.push({ op: "createPrivateThread", channelId, name, id });
      return { id };
    },
    async addThreadMember(threadId, userId) {
      calls.push({ op: "addThreadMember", threadId: threadId, userId });
    },
    async removeThreadMember(threadId, userId) {
      calls.push({ op: "removeThreadMember", threadId, userId });
    },
  };
  return {
    api,
    calls,
    failNextThread() {
      threadFailures += 1;
    },
    failNextMessage(message = "discord down") {
      messageFailures += 1;
      messageError = new Error(message);
    },
  };
}

export function createSheetMock() {
  const rows: { kind: SheetKind; values: string[] }[] = [];
  let failures = 0;
  return {
    rows,
    api: {
      async append(kind: SheetKind, values: string[]) {
        if (failures > 0) {
          failures -= 1;
          throw new Error("sheet down");
        }
        rows.push({ kind, values });
      },
    },
    failNext() {
      failures += 1;
    },
    failAlways() {
      failures = 1_000;
    },
  };
}

export type TestApp = {
  env: Env;
  deps: Deps;
  discord: ReturnType<typeof createDiscordMock>;
  sheets: ReturnType<typeof createSheetMock>;
  privateKey: CryptoKey;
  publicKeyHex: string;
};

export async function createTestApp(options?: {
  env?: Partial<Env>;
  now?: () => Date;
  fetchPhoto?: (url: string) => Promise<PhotoResult>;
}): Promise<TestApp> {
  const db = openTestDb();
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
  };
  const publicKeyHex = bytesToHex(new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey)));
  const discord = createDiscordMock();
  const sheets = createSheetMock();
  const env: Env = {
    DB: db,
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_APPLICATION_ID: "app123",
    DISCORD_BOT_TOKEN: "test-discord-bot-token",
    RECOVERIES_CHANNEL_ID: "channel-recoveries",
    COORDINATOR_ROLE_ID: "coordinator-role",
    RANGER_SHARED_SECRET: "test-ranger-secret-value",
    REPLAY_WINDOW_SECONDS: "300",
    MAX_PHOTOS: "10",
    MAX_PHOTO_BYTES: "10485760",
    MAX_TOTAL_PHOTO_BYTES: "26214400",
    GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
    SHEET_ID: "sheet-test",
    SHEET_CLAIMS_TAB: "Claims",
    SHEET_OUTCOMES_TAB: "Outcomes",
    AAR_FORM_ID: "TESTAARFORM",
    AAR_ENTRY_RECOVERY_ID: "1001",
    AAR_ENTRY_DATE: "1002",
    AAR_ENTRY_RESPONDERS: "1003",
    MILEAGE_FORM_ID: "TESTMILEAGEFORM",
    MILEAGE_ENTRY_RECOVERY_ID: "2001",
    MILEAGE_ENTRY_DATE: "2002",
    MILEAGE_ENTRY_VOLUNTEER: "2003",
    ...options?.env,
  };
  const deps: Deps = {
    db,
    discord: discord.api,
    sheets: sheets.api,
    fetchPhoto:
      options?.fetchPhoto ??
      (async () => ({ ok: true, filename: "scene.png", bytes: TINY_PNG, contentType: "image/png" })),
    now: options?.now ?? (() => new Date("2026-10-11T05:30:00.000Z")),
  };
  return { env, deps, discord, sheets, privateKey: keyPair.privateKey, publicKeyHex };
}

export function visibleMessage(message: OutgoingMessage | undefined): string {
  return JSON.stringify({
    content: message?.content ?? "",
    components: message?.components ?? [],
    filenames: (message?.files ?? []).map((file) => file.filename),
  });
}

export async function signDiscord(privateKey: CryptoKey, timestamp: string, body: Uint8Array): Promise<string> {
  const message = concatBytes([new TextEncoder().encode(timestamp), body]);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, toArrayBuffer(message)));
  return bytesToHex(signature);
}

export async function postIntake(
  app: TestApp,
  body: unknown = baseIntake,
  options?: { timestamp?: number; secret?: string; raw?: Uint8Array; signature?: string; contentType?: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = options?.raw ?? new TextEncoder().encode(JSON.stringify(body));
  const timestamp = String(options?.timestamp ?? Math.floor(app.deps.now().getTime() / 1000));
  const signature =
    options?.signature ?? (await signRangerBody(options?.secret ?? app.env.RANGER_SHARED_SECRET, timestamp, raw));
  const response = await route(
    new Request("http://localhost/intake", {
      method: "POST",
      headers: {
        "content-type": options?.contentType ?? "application/json",
        "x-ranger-timestamp": timestamp,
        "x-ranger-signature": signature,
      },
      body: raw,
    }),
    app.env,
    app.deps,
  );
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

export async function postInteraction(app: TestApp, payload: unknown, options?: { timestamp?: number; signature?: string }) {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const timestamp = String(options?.timestamp ?? Math.floor(app.deps.now().getTime() / 1000));
  const signature = options?.signature ?? (await signDiscord(app.privateKey, timestamp, raw));
  const response = await route(
    new Request("http://localhost/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body: raw,
    }),
    app.env,
    app.deps,
  );
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { text };
  }
  return { status: response.status, body, text };
}

export function component(customId: string, user: { id: string; displayName: string }, interactionId: string, roles: string[] = []) {
  return {
    type: 3,
    id: interactionId,
    data: { custom_id: customId, component_type: 2 },
    member: {
      nick: user.displayName,
      roles,
      user: { id: user.id, username: user.id, global_name: user.displayName },
    },
  };
}

export function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}
