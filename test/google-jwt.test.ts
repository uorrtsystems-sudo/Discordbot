import { describe, expect, it } from "vitest";
import { base64UrlEncode, toArrayBuffer } from "../src/bytes.js";
import { GoogleSheetLogger } from "../src/googleSheets.js";
import { createGoogleJwt, parseServiceAccount } from "../src/googleJwt.js";
import { createTestApp } from "./helpers.js";

function pemFromBytes(bytes: Uint8Array): string {
  const b64 = base64UrlEncode(bytes).replaceAll("-", "+").replaceAll("_", "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const lines = padded.match(/.{1,64}/g)?.join("\n") ?? padded;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

async function rsaAccount() {
  const key = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key.privateKey));
  return { key, account: { clientEmail: "bot@example.iam.gserviceaccount.com", privateKey: pemFromBytes(pkcs8) } };
}

describe("Google service account", () => {
  it("normalizes escaped newlines in the private key", () => {
    const parsed = parseServiceAccount(
      JSON.stringify({
        client_email: "bot@example.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----",
      }),
    );
    expect(parsed.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----");
  });

  it("signs a sheets-scoped JWT", async () => {
    const { key, account } = await rsaAccount();
    const jwt = await createGoogleJwt(account, 1_700_000_000);
    const [header, payload, signature] = jwt.split(".");
    const decodedHeader = JSON.parse(new TextDecoder().decode(base64UrlToBytes(header ?? ""))) as { alg: string };
    const decodedPayload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload ?? ""))) as {
      iss: string;
      scope: string;
      aud: string;
    };
    expect(decodedHeader.alg).toBe("RS256");
    expect(decodedPayload.iss).toBe(account.clientEmail);
    expect(decodedPayload.scope).toBe("https://www.googleapis.com/auth/spreadsheets");
    expect(decodedPayload.aud).toBe("https://oauth2.googleapis.com/token");
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key.publicKey,
      toArrayBuffer(base64UrlToBytes(signature ?? "")),
      toArrayBuffer(new TextEncoder().encode(`${header}.${payload}`)),
    );
    expect(valid).toBe(true);
    expect(jwt).not.toContain("BEGIN PRIVATE KEY");
  });

  it("retries a sheets append on HTTP 500 and does not retry a 400", async () => {
    const { account } = await rsaAccount();
    const app = await createTestApp({
      env: { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: account.clientEmail, private_key: account.privateKey }), SHEET_ID: "sheet-test" },
    });
    let appends = 0;
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 });
      }
      appends += 1;
      if (appends === 1) return new Response("no", { status: 500 });
      return new Response("{}", { status: 200 });
    };
    const sheets = new GoogleSheetLogger(app.env, fetchImpl as typeof fetch, () => new Date("2026-10-10T00:00:00.000Z"));
    await sheets.append("claim", ["one"]);
    expect(appends).toBe(2);

    appends = 0;
    const once = new GoogleSheetLogger(
      app.env,
      async (input) => {
        if (String(input).includes("oauth2")) return new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 });
        appends += 1;
        return new Response("no", { status: 400 });
      },
      () => new Date("2026-10-10T00:00:00.000Z"),
    );
    await expect(once.append("outcome", ["two"])).rejects.toThrow(/400/);
    expect(appends).toBe(1);
  });
});

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
