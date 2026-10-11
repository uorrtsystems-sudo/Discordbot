import { describe, expect, it } from "vitest";
import { verifyDiscordRequest } from "../src/discordVerify.js";
import { route } from "../src/app.js";
import { bytesToHex } from "../src/bytes.js";
import { createTestApp, postInteraction, signDiscord } from "./helpers.js";

describe("Discord signature verification", () => {
  it("accepts a fresh valid signature and answers a ping", async () => {
    const app = await createTestApp();
    const result = await postInteraction(app, { type: 1 });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ type: 1 });
    expect(app.discord.calls).toEqual([]);
  });

  it("rejects a bad signature", async () => {
    const app = await createTestApp();
    const result = await postInteraction(app, { type: 1 }, { signature: "ab".repeat(64) });
    expect(result.status).toBe(401);
    expect(app.discord.calls).toEqual([]);
  });

  it("rejects a tampered body", async () => {
    const app = await createTestApp();
    const timestamp = String(Math.floor(app.deps.now().getTime() / 1000));
    const raw = new TextEncoder().encode(JSON.stringify({ type: 1 }));
    const signature = await signDiscord(app.privateKey, timestamp, raw);
    const tampered = new TextEncoder().encode(JSON.stringify({ type: 1, extra: true }));
    const response = await route(
      new Request("http://localhost/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
        body: tampered,
      }),
      app.env,
      app.deps,
    );
    expect(response.status).toBe(401);
  });

  it("rejects a valid signature outside the replay window", async () => {
    const app = await createTestApp();
    const now = app.deps.now();
    const body = new TextEncoder().encode("{}");
    const old = String(Math.floor(now.getTime() / 1000) - 301);
    const signature = await signDiscord(app.privateKey, old, body);
    const result = await verifyDiscordRequest({
      publicKeyHex: app.publicKeyHex,
      signatureHex: signature,
      timestamp: old,
      body,
      now,
      windowSeconds: 300,
    });
    expect(result).toEqual({ ok: false, reason: "replay" });

    const fresh = String(Math.floor(now.getTime() / 1000));
    const good = await verifyDiscordRequest({
      publicKeyHex: app.publicKeyHex,
      signatureHex: await signDiscord(app.privateKey, fresh, body),
      timestamp: fresh,
      body,
      now,
      windowSeconds: 300,
    });
    expect(good).toEqual({ ok: true });
  });

  it("rejects a signature from a different key", async () => {
    const app = await createTestApp();
    const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as {
      publicKey: CryptoKey;
      privateKey: CryptoKey;
    };
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", other.publicKey));
    const now = app.deps.now();
    const body = new TextEncoder().encode("{}");
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const result = await verifyDiscordRequest({
      publicKeyHex: bytesToHex(raw),
      signatureHex: await signDiscord(app.privateKey, timestamp, body),
      timestamp,
      body,
      now,
      windowSeconds: 300,
    });
    expect(result.ok).toBe(false);
  });
});
