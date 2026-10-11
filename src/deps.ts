import type { DiscordApi } from "./discordApi.js";
import type { D1Like } from "./db.js";
import type { PhotoResult } from "./photos.js";
import type { SheetLogger } from "./sheetLog.js";

export type Deps = {
  db: D1Like;
  discord: DiscordApi;
  sheets: SheetLogger;
  fetchPhoto: (url: string) => Promise<PhotoResult>;
  now: () => Date;
};
