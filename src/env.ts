import type { D1Like } from "./db.js";

export type Env = {
  DB: D1Like;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
  RECOVERIES_CHANNEL_ID: string;
  COORDINATOR_ROLE_ID: string;
  RANGER_SHARED_SECRET: string;
  REPLAY_WINDOW_SECONDS: string;
  MAX_PHOTOS: string;
  MAX_PHOTO_BYTES: string;
  MAX_TOTAL_PHOTO_BYTES: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  SHEET_ID: string;
  SHEET_CLAIMS_TAB: string;
  SHEET_OUTCOMES_TAB: string;
  AAR_FORM_ID: string;
  AAR_ENTRY_RECOVERY_ID: string;
  AAR_ENTRY_DATE: string;
  AAR_ENTRY_RESPONDERS: string;
  MILEAGE_FORM_ID: string;
  MILEAGE_ENTRY_RECOVERY_ID: string;
  MILEAGE_ENTRY_DATE: string;
  MILEAGE_ENTRY_VOLUNTEER: string;
};
