import { describe, expect, it, vi } from "vitest";
import { safeErrorMessage } from "../src/log.js";
import { baseIntake } from "./fixtures.js";
import { createTestApp, postIntake } from "./helpers.js";

describe("public post errors", () => {
  it("keeps tokens and requester details out of the logged message", () => {
    const logged = safeErrorMessage(
      new Error("Discord API 403 on /channels/123456789012 Bot super-secret-token\nphone 8015550148"),
    );
    expect(logged).toContain("403");
    expect(logged).not.toContain("\n");
    expect(logged).not.toContain("super-secret-token");
    expect(logged).not.toContain("8015550148");
    expect(logged).not.toContain("123456789012");
    expect(safeErrorMessage("not an error")).toBe("unknown error");
    expect(safeErrorMessage(new Error("x".repeat(500)))).toHaveLength(300);
  });

  it("logs the sanitized cause when the public post throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = await createTestApp();
      app.discord.failNextMessage("Bot super-secret-token phone 8015550148");
      const failed = await postIntake(app, baseIntake);
      expect(failed.status).toBe(502);
      expect(spy).toHaveBeenCalledWith("public post failed", "[redacted] phone [redacted]");
      const logged = spy.mock.calls.flat().map((part) => (part instanceof Error ? part.message : String(part))).join(" ");
      expect(logged).not.toContain("super-secret-token");
      expect(logged).not.toContain(baseIntake.phone);
      expect(logged).not.toContain(baseIntake.requesterName);
      expect(logged).not.toContain(baseIntake.injuries);
      expect(logged).not.toContain(baseIntake.vehicle);
      expect(logged).not.toContain(baseIntake.situation);
    } finally {
      spy.mockRestore();
    }
  });
});
