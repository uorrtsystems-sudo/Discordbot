import { describe, expect, it } from "vitest";
import { createDeps as createAppDeps } from "../src/app.js";
import { base64UrlEncode } from "../src/bytes.js";
import { createDeps } from "../src/depsFactory.js";
import { DiscordRest } from "../src/discordApi.js";
import { GoogleSheetLogger } from "../src/googleSheets.js";
import { fetchPhoto } from "../src/photos.js";
import { registerCommands } from "../scripts/register-commands.js";
import { TINY_PNG } from "./fixtures.js";
import { createTestApp } from "./helpers.js";

function pemFromBytes(bytes: Uint8Array): string {
  const b64 = base64UrlEncode(bytes).replaceAll("-", "+").replaceAll("_", "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const lines = padded.match(/.{1,64}/g)?.join("\n") ?? padded;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

async function serviceAccountJson(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key.privateKey));
  return JSON.stringify({
    client_email: "bot@example.iam.gserviceaccount.com",
    private_key: pemFromBytes(pkcs8),
  });
}

function strictFetch(this: unknown, input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (this !== globalThis) {
    return Promise.reject(new TypeError("Illegal invocation: function called with incorrect this reference"));
  }
  const url = String(input);
  if (url.includes("/messages/") && url.includes("/threads")) {
    return Promise.reject(new Error("thread was started from a message"));
  }
  if (url.includes("oauth2.googleapis.com")) {
    return Promise.resolve(new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 }));
  }
  if (url.includes("sheets.googleapis.com")) {
    return Promise.resolve(new Response("{}", { status: 200 }));
  }
  if (url.includes("cdn.example.com")) {
    const userAgent = new Headers(init?.headers).get("user-agent") ?? "";
    if (!userAgent) return Promise.resolve(new Response("missing user-agent", { status: 403 }));
    return Promise.resolve(new Response(TINY_PNG, { status: 200, headers: { "content-type": "image/png" } }));
  }
  if (url.endsWith("/threads")) {
    return Promise.resolve(new Response(JSON.stringify({ id: "thread-1" }), { status: 200 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }));
}

describe("worker fetch this-binding", () => {
  it("fails when fetch is invoked with the wrong this", async () => {
    await expect(strictFetch("https://discord.com/api/v10/channels/c/messages")).rejects.toThrow(/Illegal invocation/);
  });

  it("invokes every stored fetch with the global object as this", async () => {
    const discord = new DiscordRest("test-discord-bot-token", strictFetch);
    await expect(discord.createMessage("channel-recoveries", { content: "hi" })).resolves.toEqual({ id: "msg-1" });
    await expect(discord.createPrivateThread("channel-recoveries", "Recovery")).resolves.toEqual({ id: "thread-1" });

    const photo = await fetchPhoto("https://cdn.example.com/a.png", {
      fetchImpl: strictFetch,
      maxBytes: 1000,
      timeoutMs: 1000,
    });
    expect(photo.ok).toBe(true);

    const app = await createTestApp({
      env: { GOOGLE_SERVICE_ACCOUNT_JSON: await serviceAccountJson(), SHEET_ID: "sheet-test" },
    });
    const sheets = new GoogleSheetLogger(app.env, strictFetch, () => new Date("2026-10-10T00:00:00.000Z"));
    await expect(sheets.append("claim", ["one"])).resolves.toBeUndefined();

    const deps = createDeps(app.env, strictFetch);
    await expect(deps.discord.createMessage("channel-recoveries", { content: "hi" })).resolves.toEqual({ id: "msg-1" });
    await expect(deps.fetchPhoto("https://cdn.example.com/a.png")).resolves.toMatchObject({ ok: true });
    await expect(deps.sheets.append("claim", ["two"])).resolves.toBeUndefined();

    await expect(
      registerCommands(
        { DISCORD_BOT_TOKEN: "test-discord-bot-token", DISCORD_APPLICATION_ID: "app123" },
        strictFetch,
      ),
    ).resolves.toBeUndefined();
  });

  it("binds global fetch before the worker builds its clients", async () => {
    const app = await createTestApp();
    const previous = globalThis.fetch;
    globalThis.fetch = strictFetch as typeof fetch;
    try {
      const deps = createAppDeps(app.env);
      await expect(deps.discord.createMessage("channel-recoveries", { content: "hi" })).resolves.toEqual({ id: "msg-1" });
      await expect(deps.fetchPhoto("https://cdn.example.com/a.png")).resolves.toMatchObject({ ok: true });
    } finally {
      globalThis.fetch = previous;
    }
  });
});
