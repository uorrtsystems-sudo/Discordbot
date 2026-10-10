import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import { buildAarUrl, buildMileageUrl } from "../src/prefill.js";
import { recoveryDate } from "../src/time.js";
import { baseIntake } from "./fixtures.js";
import { component, createTestApp, postIntake, postInteraction } from "./helpers.js";

const ada = { id: "user-ada", displayName: "Ada Lovelace" };
const grace = { id: "user-grace", displayName: "Grace Hopper" };
const bob = { id: "user-bob", displayName: "Bob Stone" };
const sam = { id: "user-sam", displayName: "Sam Coordinator" };

async function open(app: Awaited<ReturnType<typeof createTestApp>>) {
  const opened = await postIntake(app, baseIntake);
  expect(opened.status).toBe(200);
  return String(opened.body.recoveryId);
}

function closeoutText(app: Awaited<ReturnType<typeof createTestApp>>): string {
  const posts = app.discord.calls.filter(
    (call) => call.op === "createMessage" && call.channelId?.startsWith("thread-") && call.message?.content?.includes("forms"),
  );
  return posts.at(-1)?.message?.content ?? "";
}

describe("close-out", () => {
  it("lets a responder close out and posts prefilled form links", async () => {
    const app = await createTestApp();
    const id = await open(app);
    await postInteraction(app, component(`respond:${id}`, ada, "ada-yes"));
    await postInteraction(app, component(`cant:${id}`, bob, "bob-no"));
    await postInteraction(app, component(`respond:${id}`, grace, "grace-yes"));

    const stranger = await postInteraction(app, component(`close:${id}`, { id: "user-stranger", displayName: "Pat" }, "nope"));
    expect(JSON.stringify(stranger.body)).toContain("Only a responder");
    expect(closeoutText(app)).toBe("");

    const declined = await postInteraction(app, component(`close:${id}`, bob, "bob-close"));
    expect(JSON.stringify(declined.body)).toContain("Only a responder");

    const chooser = await postInteraction(app, component(`close:${id}`, ada, "ada-close"));
    const chooserText = JSON.stringify(chooser.body);
    expect(chooserText).toContain("Recovered");
    expect(chooserText).toContain("Cancelled");
    expect(chooserText).toContain("Declined");
    expect(chooserText).toContain("Referred to tow");

    const closed = await postInteraction(app, component(`outcome:${id}:recovered`, ada, "ada-outcome"));
    expect(closed.status).toBe(200);
    expect(JSON.stringify(closed.body)).toContain("Closed out as Recovered");

    const config = readConfig(app.env);
    const date = recoveryDate("2026-10-11T05:30:00.000Z");
    const text = closeoutText(app);
    expect(text).toContain(buildAarUrl(config, { recoveryId: id, date, responders: "Ada Lovelace, Grace Hopper" }));
    expect(text).toContain(buildMileageUrl(config, { recoveryId: id, date, volunteerName: "Ada Lovelace" }));
    expect(text).toContain(buildMileageUrl(config, { recoveryId: id, date, volunteerName: "Grace Hopper" }));
    expect(text).not.toContain("Bob Stone");
    expect(text).not.toContain("8015550148");
    expect(text).not.toContain("INJURY-SENTINEL");

    const row = await app.deps.db
      .prepare("SELECT status, outcome FROM recoveries WHERE id = ?")
      .bind(id)
      .first<{ status: string; outcome: string }>();
    expect(row).toEqual({ status: "closed", outcome: "recovered" });
    const publicEdit = app.discord.calls.filter((call) => call.op === "editMessage" && call.channelId === "channel-recoveries").at(-1);
    const buttons = publicEdit?.message?.components?.[0]?.components ?? [];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(app.sheets.rows.some((entry) => entry.kind === "outcome" && entry.values.includes("recovered"))).toBe(true);
  });

  it("lets a coordinator close out without responding", async () => {
    const app = await createTestApp();
    const id = await open(app);
    const closed = await postInteraction(
      app,
      component(`outcome:${id}:referred_to_tow`, sam, "coord-outcome", ["coordinator-role"]),
    );
    expect(JSON.stringify(closed.body)).toContain("Referred to tow");
    const row = await app.deps.db.prepare("SELECT outcome FROM recoveries WHERE id = ?").bind(id).first<{ outcome: string }>();
    expect(row?.outcome).toBe("referred_to_tow");
    expect(closeoutText(app)).toContain("No responders were going");
  });

  it("does not treat the placeholder coordinator role as access", async () => {
    const app = await createTestApp({ env: { COORDINATOR_ROLE_ID: "REPLACE_WITH_COORDINATOR_ROLE_ID" } });
    const id = await open(app);
    const closed = await postInteraction(
      app,
      component(`outcome:${id}:cancelled`, sam, "placeholder-role", ["REPLACE_WITH_COORDINATOR_ROLE_ID"]),
    );
    expect(JSON.stringify(closed.body)).toContain("Only a responder");
    const row = await app.deps.db.prepare("SELECT status FROM recoveries WHERE id = ?").bind(id).first<{ status: string }>();
    expect(row?.status).toBe("open");
  });

  it("still posts form links when the sheet append fails", async () => {
    const app = await createTestApp();
    const id = await open(app);
    await postInteraction(app, component(`respond:${id}`, ada, "ada-yes"));
    app.sheets.failAlways();
    const closed = await postInteraction(app, component(`outcome:${id}:declined`, ada, "ada-outcome"));
    expect(closed.status).toBe(200);
    expect(JSON.stringify(closed.body)).toContain("Closed out as Declined");
    expect(closeoutText(app)).toContain("https://docs.google.com/forms/d/e/TESTAARFORM/viewform");
    const outbox = await app.deps.db
      .prepare("SELECT kind FROM sheet_outbox")
      .bind()
      .all<{ kind: string }>();
    expect(outbox.results.map((row) => row.kind)).toContain("outcome");
  });
});
