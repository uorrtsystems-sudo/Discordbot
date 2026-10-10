import { isPlaceholder, readConfig } from "./config.js";
import type { Env } from "./env.js";
import { createGoogleJwt, parseServiceAccount } from "./googleJwt.js";
import type { SheetLogger } from "./sheetLog.js";
import type { SheetKind } from "./types.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function requestOnce(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(4000) });
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      return fetchImpl(url, { ...init, signal: AbortSignal.timeout(4000) });
    }
    return response;
  } catch {
    return fetchImpl(url, { ...init, signal: AbortSignal.timeout(4000) });
  }
}

export class GoogleSheetLogger implements SheetLogger {
  private token: { value: string; exp: number } | null = null;

  constructor(
    private readonly env: Env,
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async append(kind: SheetKind, values: string[]): Promise<void> {
    const config = readConfig(this.env);
    if (isPlaceholder(config.sheetId)) throw new Error("Google sheet is not configured");
    const tab = kind === "claim" ? config.claimsTab : config.outcomesTab;
    if (!/^[\w ]{1,80}$/.test(tab)) throw new Error("Invalid sheet tab name");
    const token = await this.accessToken();
    const range = encodeURIComponent(`${tab}!A:G`);
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.sheetId)}` +
      `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const response = await requestOnce(this.fetchImpl, url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ values: [values] }),
    });
    if (!response.ok) throw new Error(`Google sheets append failed (${response.status})`);
  }

  private async accessToken(): Promise<string> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (this.token && this.token.exp - 60 > nowSeconds) return this.token.value;
    const account = parseServiceAccount(this.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const assertion = await createGoogleJwt(account, nowSeconds);
    const response = await requestOnce(this.fetchImpl, TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw new Error(`Google token request failed (${response.status})`);
    const parsed = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!parsed.access_token) throw new Error("Google token request failed");
    const expiresIn = parsed.expires_in ?? 3600;
    this.token = { value: parsed.access_token, exp: nowSeconds + expiresIn };
    return parsed.access_token;
  }
}
