import { base64UrlEncode, base64UrlEncodeJson, pemToDer, toArrayBuffer } from "./bytes.js";
import { isPlaceholder } from "./config.js";

export type ServiceAccount = {
  clientEmail: string;
  privateKey: string;
};

export function parseServiceAccount(json: string): ServiceAccount {
  if (!json || isPlaceholder(json) || !json.trim().startsWith("{")) {
    throw new Error("Google service account is not configured");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Google service account JSON is invalid");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Google service account JSON is invalid");
  const record = parsed as { client_email?: unknown; private_key?: unknown };
  if (typeof record.client_email !== "string" || typeof record.private_key !== "string") {
    throw new Error("Google service account JSON is invalid");
  }
  const privateKey = record.private_key.includes("\\n")
    ? record.private_key.replaceAll("\\n", "\n")
    : record.private_key;
  return { clientEmail: record.client_email, privateKey };
}

export async function createGoogleJwt(account: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = base64UrlEncodeJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlEncodeJson({
    iss: account.clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, toArrayBuffer(new TextEncoder().encode(signingInput))),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}
