import { concatBytes, hexToBytes, toArrayBuffer } from "./bytes.js";

export type VerifyResult = { ok: true } | { ok: false; reason: "malformed" | "replay" | "signature" };

function timestampFresh(
  timestamp: string,
  now: Date,
  windowSeconds: number,
): { ok: false; reason: "malformed" | "replay" } | null {
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "malformed" };
  const seconds = Number(timestamp);
  const drift = Math.abs(Math.floor(now.getTime() / 1000) - seconds);
  if (drift > windowSeconds) return { ok: false, reason: "replay" };
  return null;
}

export async function verifyDiscordRequest(input: {
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  body: Uint8Array;
  now: Date;
  windowSeconds: number;
}): Promise<VerifyResult> {
  const stale = timestampFresh(input.timestamp, input.now, input.windowSeconds);
  if (stale?.reason === "malformed") return stale;
  const publicKey = hexToBytes(input.publicKeyHex);
  const signature = hexToBytes(input.signatureHex);
  if (!publicKey || publicKey.byteLength !== 32 || !signature || signature.byteLength !== 64) {
    return { ok: false, reason: "malformed" };
  }
  try {
    const key = await crypto.subtle.importKey("raw", toArrayBuffer(publicKey), { name: "Ed25519" }, false, ["verify"]);
    const message = concatBytes([new TextEncoder().encode(input.timestamp), input.body]);
    const valid = await crypto.subtle.verify("Ed25519", key, toArrayBuffer(signature), toArrayBuffer(message));
    if (!valid) return { ok: false, reason: "signature" };
  } catch {
    return { ok: false, reason: "signature" };
  }
  if (stale) return stale;
  return { ok: true };
}
