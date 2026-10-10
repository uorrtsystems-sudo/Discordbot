import type { Deps } from "./deps.js";
import type { Env } from "./env.js";
import { bumpSheetOutbox, deleteSheetOutbox, listSheetOutbox } from "./db.js";
import type { SheetKind } from "./types.js";

/**
 * v1 hook for a future 15-minute escalation. Intentionally does nothing.
 * Later, scan open recoveries that still have no responders and notify coordinators.
 */
export async function escalationHook(_env: Env, _deps: Deps): Promise<void> {
  return;
}

export async function retrySheetOutbox(_env: Env, deps: Deps): Promise<void> {
  const rows = await listSheetOutbox(deps.db, 25);
  const now = deps.now().toISOString();
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payloadJson) as { kind?: SheetKind; values?: string[] };
      if ((payload.kind !== "claim" && payload.kind !== "outcome") || !Array.isArray(payload.values)) {
        throw new Error("Invalid sheet outbox payload");
      }
      await deps.sheets.append(payload.kind, payload.values);
      await deleteSheetOutbox(deps.db, row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "sheet error";
      await bumpSheetOutbox(deps.db, row.id, message, now);
    }
  }
}

export async function runScheduled(
  env: Env,
  deps: Deps,
  escalation: (env: Env, deps: Deps) => Promise<void> = escalationHook,
): Promise<void> {
  await retrySheetOutbox(env, deps);
  await escalation(env, deps);
}
