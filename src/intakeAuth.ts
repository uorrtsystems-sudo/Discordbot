import { concatBytes, hexToBytes, toArrayBuffer } from "./bytes.js";
import type { VerifyResult } from "./discordVerify.js";

/**
 * Ranger signs the raw request body:
 *   HMAC_SHA256(secret, utf8(timestamp) + "." + rawBodyBytes)
 * The hex digest is sent in `X-Ranger-Signature` and the unix seconds in
 * `X-Ranger-Timestamp`. This is not Discord's Ed25519 scheme: Discord
 * concatenates the timestamp and body with no separator.
 */
export async function signRangerBody(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = concatBytes([new TextEncoder().encode(`${timestamp}.`), body]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(message)));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyRangerRequest(input: {
  secret: string;
  timestamp: string;
  body: Uint8Array;
  signatureHex: string;
  now: Date;
  windowSeconds: number;
}): Promise<VerifyResult> {
  if (!/^\d{1,12}$/.test(input.timestamp) || !/^[0-9a-f]{64}$/i.test(input.signatureHex)) {
    return { ok: false, reason: "malformed" };
  }
  const provided = hexToBytes(input.signatureHex);
  if (!provided) return { ok: false, reason: "malformed" };
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const message = concatBytes([new TextEncoder().encode(`${input.timestamp}.`), input.body]);
  const valid = await crypto.subtle.verify("HMAC", key, toArrayBuffer(provided), toArrayBuffer(message));
  if (!valid) return { ok: false, reason: "signature" };
  const seconds = Number(input.timestamp);
  const drift = Math.abs(Math.floor(input.now.getTime() / 1000) - seconds);
  if (drift > input.windowSeconds) return { ok: false, reason: "replay" };
  return { ok: true };
}
