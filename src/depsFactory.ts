import { readConfig, PHOTO_TIMEOUT_MS } from "./config.js";
import type { Deps } from "./deps.js";
import { DiscordRest } from "./discordApi.js";
import type { Env } from "./env.js";
import { bindFetch } from "./fetchBind.js";
import { GoogleSheetLogger } from "./googleSheets.js";
import { fetchPhoto } from "./photos.js";

export function createDeps(env: Env, fetchImpl: typeof fetch): Deps {
  const config = readConfig(env);
  const boundFetch = bindFetch(fetchImpl);
  return {
    db: env.DB,
    discord: new DiscordRest(env.DISCORD_BOT_TOKEN, boundFetch),
    sheets: new GoogleSheetLogger(env, boundFetch),
    fetchPhoto: (url) =>
      fetchPhoto(url, { fetchImpl: boundFetch, maxBytes: config.maxPhotoBytes, timeoutMs: PHOTO_TIMEOUT_MS }),
    now: () => new Date(),
  };
}
