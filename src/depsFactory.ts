import { readConfig, PHOTO_TIMEOUT_MS } from "./config.js";
import type { Deps } from "./deps.js";
import { DiscordRest } from "./discordApi.js";
import type { Env } from "./env.js";
import { GoogleSheetLogger } from "./googleSheets.js";
import { fetchPhoto } from "./photos.js";

export function createDeps(env: Env, fetchImpl: typeof fetch): Deps {
  const config = readConfig(env);
  return {
    db: env.DB,
    discord: new DiscordRest(env.DISCORD_BOT_TOKEN, fetchImpl),
    sheets: new GoogleSheetLogger(env, fetchImpl),
    fetchPhoto: (url) =>
      fetchPhoto(url, { fetchImpl, maxBytes: config.maxPhotoBytes, timeoutMs: PHOTO_TIMEOUT_MS }),
    now: () => new Date(),
  };
}
