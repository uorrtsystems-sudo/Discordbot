import { enqueueSheetOutbox, type D1Like } from "./db.js";
import type { SheetKind } from "./types.js";

export interface SheetLogger {
  append(kind: SheetKind, values: string[]): Promise<void>;
}

export async function recordSheetRow(
  db: D1Like,
  sheets: SheetLogger,
  kind: SheetKind,
  values: string[],
  now: string,
): Promise<void> {
  try {
    await sheets.append(kind, values);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "sheet error";
    console.error("sheet append failed", kind);
    try {
      await enqueueSheetOutbox(db, kind, values, message, now);
    } catch {
      console.error("sheet outbox write failed", kind);
    }
  }
}
