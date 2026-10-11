import { describe, expect, it } from "vitest";
import { validateIntake } from "../src/validate.js";
import { createTestApp, postIntake } from "./helpers.js";
import { baseIntake } from "./fixtures.js";

const limits = { maxPhotoBytes: 1024 };

describe("intake validation", () => {
  it("requires the recovery fields", () => {
    const result = validateIntake({}, [], limits);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields).toEqual(
        expect.arrayContaining(["idempotencyKey", "requesterName", "phone", "lat", "lon", "injuries", "vehicle", "situation", "county"]),
      );
    }
  });

  it("rejects coordinates outside the valid range", async () => {
    const app = await createTestApp();
    const result = await postIntake(app, { ...baseIntake, lat: 91, lon: -200 });
    expect(result.status).toBe(400);
    expect(result.body.fields).toEqual(expect.arrayContaining(["lat", "lon"]));
    expect(app.discord.calls).toEqual([]);
  });

  it("rejects a short idempotency key and a phone without enough digits", () => {
    const result = validateIntake({ ...baseIntake, idempotencyKey: "short", phone: "555" }, [], limits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields).toEqual(expect.arrayContaining(["idempotencyKey", "phone"]));
  });

  it("rejects a situation that will not fit in the private thread", () => {
    const result = validateIntake({ ...baseIntake, situation: "x".repeat(501) }, [], limits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields).toContain("situation");
  });
});
