import { describe, expect, it } from "vitest";
import { verifyRangerRequest } from "../src/intakeAuth.js";
import { createTestApp, postIntake } from "./helpers.js";
import { baseIntake } from "./fixtures.js";

describe("Ranger intake HMAC", () => {
  it("accepts a fresh valid signature", async () => {
    const app = await createTestApp();
    const result = await postIntake(app, baseIntake);
    expect(result.status).toBe(200);
    expect(result.body.recoveryId).toMatch(/^r_[0-9a-f]{16}$/);
  });

  it("rejects a bad signature without calling Discord", async () => {
    const app = await createTestApp();
    const result = await postIntake(app, baseIntake, { signature: "ab".repeat(32) });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("Unauthorized");
    expect(app.discord.calls).toEqual([]);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const app = await createTestApp();
    const result = await postIntake(app, baseIntake, { secret: "another-ranger-secret-value" });
    expect(result.status).toBe(401);
    expect(app.discord.calls).toEqual([]);
  });

  it("rejects timestamps outside the replay window only when the signature is valid", async () => {
    const app = await createTestApp();
    const nowSeconds = Math.floor(app.deps.now().getTime() / 1000);
    const stale = await postIntake(app, baseIntake, { timestamp: nowSeconds - 301 });
    expect(stale.status).toBe(401);
    expect(stale.body.error).toBe("Timestamp is outside the replay window");
    expect(app.discord.calls).toEqual([]);

    const future = await postIntake(app, baseIntake, { timestamp: nowSeconds + 301 });
    expect(future.status).toBe(401);
    expect(future.body.error).toBe("Timestamp is outside the replay window");

    const edge = await postIntake(app, { ...baseIntake, idempotencyKey: "idem-key-edge" }, { timestamp: nowSeconds - 300 });
    expect(edge.status).toBe(200);

    const forged = await postIntake(app, baseIntake, { timestamp: nowSeconds - 301, signature: "cd".repeat(32) });
    expect(forged.status).toBe(401);
    expect(forged.body.error).toBe("Unauthorized");
  });

  it("signs the timestamp, a dot, and the raw body", async () => {
    const app = await createTestApp();
    const now = app.deps.now();
    const body = new TextEncoder().encode("{\"ok\":true}");
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const { signRangerBody } = await import("../src/intakeAuth.js");
    const signature = await signRangerBody(app.env.RANGER_SHARED_SECRET, timestamp, body);
    const valid = await verifyRangerRequest({
      secret: app.env.RANGER_SHARED_SECRET,
      timestamp,
      body,
      signatureHex: signature,
      now,
      windowSeconds: 300,
    });
    expect(valid.ok).toBe(true);
    const missingDot = await verifyRangerRequest({
      secret: app.env.RANGER_SHARED_SECRET,
      timestamp,
      body: new TextEncoder().encode(`.${new TextDecoder().decode(body)}`),
      signatureHex: signature,
      now,
      windowSeconds: 300,
    });
    expect(missingDot.ok).toBe(false);
  });
});
