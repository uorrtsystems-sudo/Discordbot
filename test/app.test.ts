import { describe, expect, it } from "vitest";
import { route } from "../src/app.js";
import { createTestApp, postInteraction } from "./helpers.js";

describe("worker routes", () => {
  it("answers a health check", async () => {
    const app = await createTestApp();
    const response = await route(new Request("http://localhost/health"), app.env, app.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "uorrt-dispatch" });
  });

  it("shows public status without private fields", async () => {
    const app = await createTestApp();
    const { postIntake } = await import("./helpers.js");
    const { baseIntake } = await import("./fixtures.js");
    const opened = await postIntake(app, baseIntake);
    const id = String(opened.body.recoveryId);
    const status = await postInteraction(app, {
      type: 2,
      id: "cmd-1",
      data: { name: "recovery", options: [{ name: "id", type: 3, value: id }] },
      member: { roles: [], user: { id: "user-ada", username: "ada", global_name: "Ada Lovelace" } },
    });
    const text = JSON.stringify(status.body);
    expect(text).toContain("Jordan Lee");
    expect(text).not.toContain("8015550148");
    expect(text).not.toContain("INJURY-SENTINEL");
    expect(text).not.toContain("VEHICLE-SENTINEL");
    expect(text).not.toContain("SITUATION-SENTINEL");
    expect(text).not.toContain("COUNTY-SENTINEL");
  });
});
