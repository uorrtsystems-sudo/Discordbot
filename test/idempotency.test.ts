import { describe, expect, it } from "vitest";
import { baseIntake } from "./fixtures.js";
import { createTestApp, postIntake } from "./helpers.js";

describe("intake idempotency", () => {
  it("returns the original recovery when Ranger retries", async () => {
    const app = await createTestApp();
    const first = await postIntake(app, baseIntake);
    const second = await postIntake(app, baseIntake);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.recoveryId).toBe(first.body.recoveryId);
    expect(second.body.idempotentReplay).toBe(true);
    expect(first.body.idempotentReplay).toBe(false);
    const publicPosts = app.discord.calls.filter(
      (call) => call.op === "createMessage" && call.channelId === "channel-recoveries",
    );
    expect(publicPosts).toHaveLength(1);
  });

  it("does not start a second post while the same key is in progress", async () => {
    const app = await createTestApp();
    const now = app.deps.now().toISOString();
    await app.deps.db
      .prepare(
        `INSERT INTO idempotency_keys (key, recovery_id, response_json, status, created_at, updated_at)
         VALUES (?, ?, NULL, 'pending', ?, ?)`,
      )
      .bind("idem-key-001", "r_0123abcd4567ef89", now, now)
      .run();
    const result = await postIntake(app, baseIntake);
    expect(result.status).toBe(409);
    expect(app.discord.calls).toEqual([]);
  });

  it("retries a partial Discord post without a second public message", async () => {
    const app = await createTestApp();
    app.discord.failNextThread();
    const failed = await postIntake(app, baseIntake);
    expect(failed.status).toBe(502);
    const publicPosts = () =>
      app.discord.calls.filter((call) => call.op === "createMessage" && call.channelId === "channel-recoveries");
    expect(publicPosts()).toHaveLength(1);
    const retried = await postIntake(app, baseIntake);
    expect(retried.status).toBe(200);
    expect(retried.body.recoveryId).toBeTruthy();
    expect(publicPosts()).toHaveLength(1);
    expect(app.discord.calls.filter((call) => call.op === "createPrivateThread")).toHaveLength(1);
  });

  it("can retry immediately when the public post never succeeded", async () => {
    const app = await createTestApp();
    app.discord.failNextMessage();
    const failed = await postIntake(app, baseIntake);
    expect(failed.status).toBe(502);
    const retried = await postIntake(app, baseIntake);
    expect(retried.status).toBe(200);
    expect(
      app.discord.calls.filter((call) => call.op === "createMessage" && call.channelId === "channel-recoveries"),
    ).toHaveLength(1);
  });
});
