import type { Env } from "./env.js";

export const IDEMPOTENCY_LOCK_MS = 120_000;
export const SHEET_MAX_ATTEMPTS = 8;
export const PHOTO_TIMEOUT_MS = 5_000;
export const DISCORD_TIMEOUT_MS = 8_000;
export const DISCORD_CONTENT_LIMIT = 2000;
export const DEFAULT_REPLAY_WINDOW_SECONDS = 300;

export type AppConfig = {
  replayWindowSeconds: number;
  maxPhotos: number;
  maxPhotoBytes: number;
  maxTotalPhotoBytes: number;
  recoveriesChannelId: string;
  coordinatorRoleId: string;
  sheetId: string;
  claimsTab: string;
  outcomesTab: string;
  aarFormId: string;
  aarEntryRecoveryId: string;
  aarEntryDate: string;
  aarEntryResponders: string;
  mileageFormId: string;
  mileageEntryRecoveryId: string;
  mileageEntryDate: string;
  mileageEntryVolunteer: string;
};

export function isPlaceholder(value: string | undefined | null): boolean {
  if (!value) return true;
  return value.startsWith("REPLACE_") || value.startsWith("replace-");
}

export function isConfiguredSecret(value: string | undefined): boolean {
  if (!value || value.length < 16) return false;
  return !isPlaceholder(value);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function readConfig(env: Env): AppConfig {
  return {
    replayWindowSeconds: positiveInt(env.REPLAY_WINDOW_SECONDS, DEFAULT_REPLAY_WINDOW_SECONDS),
    maxPhotos: positiveInt(env.MAX_PHOTOS, 10),
    maxPhotoBytes: positiveInt(env.MAX_PHOTO_BYTES, 10 * 1024 * 1024),
    maxTotalPhotoBytes: positiveInt(env.MAX_TOTAL_PHOTO_BYTES, 25 * 1024 * 1024),
    recoveriesChannelId: env.RECOVERIES_CHANNEL_ID,
    coordinatorRoleId: env.COORDINATOR_ROLE_ID,
    sheetId: env.SHEET_ID,
    claimsTab: env.SHEET_CLAIMS_TAB || "Claims",
    outcomesTab: env.SHEET_OUTCOMES_TAB || "Outcomes",
    aarFormId: env.AAR_FORM_ID,
    aarEntryRecoveryId: env.AAR_ENTRY_RECOVERY_ID,
    aarEntryDate: env.AAR_ENTRY_DATE,
    aarEntryResponders: env.AAR_ENTRY_RESPONDERS,
    mileageFormId: env.MILEAGE_FORM_ID,
    mileageEntryRecoveryId: env.MILEAGE_ENTRY_RECOVERY_ID,
    mileageEntryDate: env.MILEAGE_ENTRY_DATE,
    mileageEntryVolunteer: env.MILEAGE_ENTRY_VOLUNTEER,
  };
}
