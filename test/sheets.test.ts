import { describe, expect, it } from "vitest";
import { recordSheetRow } from "../src/sheetLog.js";
import { escalationHook, runScheduled } from "../src/scheduled.js";
import { component, createTestApp, postIntake, postInteraction } from "./helpers.js";
import { baseIntake } from "./fixtures.js";

describe("sheet failures", () => {
  it("keeps the Discord response when a claim cannot be logged", async () => {
    const app = await createTestApp();
    const opened = await postIntake(app, baseIntake);
    const id = String(opened.body.recoveryId);
    app.sheets.failNext();
    const clicked = await postInteraction(
      app,
      component(`respond:${id}`, { id: "user-ada", displayName: "Ada Lovelace" }, "ada-yes"),
    );
    expect(clicked.status).toBe(200);
    expect(JSON.stringify(clicked.body)).toContain("marked as responding");
    expect(app.discord.calls.some((call) => call.op === "addThreadMember")).toBe(true);
    const outbox = await app.deps.db.prepare("SELECT kind, payload_json FROM sheet_outbox").bind().all<{ kind: string; payload_json: string }>();
    expect(outbox.results).toHaveLength(1);
    expect(outbox.results[0]?.kind).toBe("claim");

    await runScheduled(app.env, app.deps, async () => undefined);
    const remaining = await app.deps.db.prepare("SELECT id FROM sheet_outbox").bind().all();
    expect(remaining.results).toEqual([]);
    expect(app.sheets.rows.some((row) => row.kind === "claim")).toBe(true);
  });

  it("records the failure instead of throwing", async () => {
    const app = await createTestApp();
    await recordSheetRow(app.deps.db, { async append() { throw new Error("sheet down"); } }, "outcome", ["a"], app.deps.now().toISOString());
    const rows = await app.deps.db.prepare("SELECT last_error FROM sheet_outbox").bind().all<{ last_error: string }>();
    expect(rows.results[0]?.last_error).toContain("sheet down");
  });

  it("leaves escalation as a no-op in v1", async () => {
    const app = await createTestApp();
    let called = false;
    await runScheduled(app.env, app.deps, async () => {
      called = true;
    });
    expect(called).toBe(true);
    await escalationHook(app.env, app.deps);
    expect(app.discord.calls).toEqual([]);
    expect(app.sheets.rows).toEqual([]);
  });
});
