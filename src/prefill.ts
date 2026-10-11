import { isPlaceholder, type AppConfig } from "./config.js";

const ENTRY_ID = /^[A-Za-z0-9_-]+$/;

export function buildGoogleFormPrefillUrl(formId: string, entries: Record<string, string>): string {
  if (!formId || formId.includes("/") || formId.includes("?") || formId.includes("#")) {
    throw new Error("Invalid form id");
  }
  const url = new URL(`https://docs.google.com/forms/d/e/${encodeURIComponent(formId)}/viewform`);
  url.searchParams.set("usp", "pp_url");
  for (const [entryId, value] of Object.entries(entries)) {
    if (!ENTRY_ID.test(entryId)) throw new Error("Invalid form entry id");
    url.searchParams.append(`entry.${entryId}`, value);
  }
  return url.toString();
}

export function formsNeedConfiguration(config: AppConfig): boolean {
  return isPlaceholder(config.aarFormId) || isPlaceholder(config.mileageFormId);
}

export function buildAarUrl(
  config: AppConfig,
  fields: { recoveryId: string; date: string; responders: string },
): string {
  return buildGoogleFormPrefillUrl(config.aarFormId, {
    [config.aarEntryRecoveryId]: fields.recoveryId,
    [config.aarEntryDate]: fields.date,
    [config.aarEntryResponders]: fields.responders,
  });
}

export function buildMileageUrl(
  config: AppConfig,
  fields: { recoveryId: string; date: string; volunteerName: string },
): string {
  return buildGoogleFormPrefillUrl(config.mileageFormId, {
    [config.mileageEntryRecoveryId]: fields.recoveryId,
    [config.mileageEntryDate]: fields.date,
    [config.mileageEntryVolunteer]: fields.volunteerName,
  });
}
