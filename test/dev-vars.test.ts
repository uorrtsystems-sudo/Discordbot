import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerCommands } from "../scripts/register-commands.js";
import { loadDevVars } from "../scripts/load-dev-vars.js";

describe("local command registration", () => {
  it("loads .dev.vars without overriding existing environment values", () => {
    const dir = mkdtempSync(join(tmpdir(), "uorrt-vars-"));
    const path = join(dir, ".dev.vars");
    writeFileSync(path, "DISCORD_BOT_TOKEN=from-file\nGOOGLE_SERVICE_ACCOUNT_JSON={\"private_key\":\"abc=\"}\n# comment\n");
    const previousToken = process.env.DISCORD_BOT_TOKEN;
    const previousJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    process.env.DISCORD_BOT_TOKEN = "kept-token";
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    loadDevVars(path);
    expect(process.env.DISCORD_BOT_TOKEN).toBe("kept-token");
    expect(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).toBe("{\"private_key\":\"abc=\"}");
    if (previousToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = previousToken;
    if (previousJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = previousJson;
  });

  it("redacts the bot token from registration errors", async () => {
    const token = "super-secret-token-value";
    await expect(
      registerCommands({ DISCORD_BOT_TOKEN: token, DISCORD_APPLICATION_ID: "app123" }, async () => new Response(`denied ${token}`, { status: 401 })),
    ).rejects.toThrow(/\[redacted\]/);
  });
});
