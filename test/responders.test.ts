import { describe, expect, it } from "vitest";
import { baseIntake } from "./fixtures.js";
import { component, createTestApp, postIntake, postInteraction, visibleMessage } from "./helpers.js";

const ada = { id: "user-ada", displayName: "Ada Lovelace" };
const grace = { id: "user-grace", displayName: "Grace Hopper" };
const bob = { id: "user-bob", displayName: "Bob Stone" };

async function open(app: Awaited<ReturnType<typeof createTestApp>>) {
  const opened = await postIntake(app, baseIntake);
  expect(opened.status).toBe(200);
  return String(opened.body.recoveryId);
}

function publicText(app: Awaited<ReturnType<typeof createTestApp>>): string {
  const edits = app.discord.calls.filter((call) => call.op === "editMessage" && call.channelId === "channel-recoveries");
  return visibleMessage(edits.at(-1)?.message);
}

describe("responders", () => {
  it("adds responders to the private thread, including someone who responds later", async () => {
    const app = await createTestApp();
    const id = await open(app);
    const first = await postInteraction(app, component(`respond:${id}`, ada, "click-ada"));
    expect(first.status).toBe(200);
    expect(JSON.stringify(first.body)).toContain("marked as responding");
    const second = await postInteraction(app, component(`respond:${id}`, grace, "click-grace"));
    expect(JSON.stringify(second.body)).toContain("marked as responding");

    const adds = app.discord.calls.filter((call) => call.op === "addThreadMember").map((call) => call.userId);
    expect(adds).toEqual(["user-ada", "user-grace"]);
    const text = publicText(app);
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("Grace Hopper");
    const rows = await app.deps.db
      .prepare("SELECT discord_user_id, status FROM responders WHERE recovery_id = ? ORDER BY discord_user_id")
      .bind(id)
      .all<{ discord_user_id: string; status: string }>();
    expect(rows.results).toEqual([
      { discord_user_id: "user-ada", status: "responding" },
      { discord_user_id: "user-grace", status: "responding" },
    ]);
    expect(app.sheets.rows.filter((row) => row.kind === "claim")).toHaveLength(2);
  });

  it("treats a repeated click as the same response", async () => {
    const app = await createTestApp();
    const id = await open(app);
    await postInteraction(app, component(`respond:${id}`, ada, "click-1"));
    const repeat = await postInteraction(app, component(`respond:${id}`, ada, "click-2"));
    expect(JSON.stringify(repeat.body)).toContain("already marked as responding");
    expect(app.discord.calls.filter((call) => call.op === "addThreadMember")).toHaveLength(1);
    expect(app.sheets.rows.filter((row) => row.kind === "claim")).toHaveLength(1);
    const same = await postInteraction(app, component(`respond:${id}`, ada, "click-1"));
    expect(JSON.stringify(same.body)).toContain("already recorded");
    expect(app.discord.calls.filter((call) => call.op === "addThreadMember")).toHaveLength(1);
  });

  it("records can't make it and removes a responder who had joined", async () => {
    const app = await createTestApp();
    const id = await open(app);
    await postInteraction(app, component(`respond:${id}`, ada, "ada-yes"));
    const changed = await postInteraction(app, component(`cant:${id}`, ada, "ada-no"));
    expect(JSON.stringify(changed.body)).toContain("removed from the private thread");
    expect(app.discord.calls.filter((call) => call.op === "removeThreadMember").map((call) => call.userId)).toEqual([
      "user-ada",
    ]);
    expect(publicText(app)).not.toContain("Ada Lovelace");

    const declined = await postInteraction(app, component(`cant:${id}`, bob, "bob-no"));
    expect(JSON.stringify(declined.body)).toContain("unable to make it");
    expect(app.discord.calls.filter((call) => call.op === "addThreadMember").map((call) => call.userId)).toEqual([
      "user-ada",
    ]);
    expect(app.discord.calls.filter((call) => call.op === "removeThreadMember")).toHaveLength(1);
    const thread = app.discord.calls.filter((call) => call.op === "editMessage" && call.channelId?.startsWith("thread-")).at(-1);
    expect(thread?.message?.content).toContain("Bob Stone");
    expect(thread?.message?.content).toContain("Unable to make it");
    expect(publicText(app)).not.toContain("Bob Stone");
    const adaRow = await app.deps.db
      .prepare("SELECT status FROM responders WHERE recovery_id = ? AND discord_user_id = ?")
      .bind(id, "user-ada")
      .first<{ status: string }>();
    expect(adaRow?.status).toBe("cant_make_it");
  });
});
