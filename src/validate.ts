import { hasControlCharacter } from "./text.js";
import type { IntakeInput, Upload } from "./types.js";

export type ValidationResult = { ok: true; value: IntakeInput } | { ok: false; fields: string[] };

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  if (hasControlCharacter(trimmed)) return null;
  return trimmed;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function validPhone(value: string): boolean {
  if (!/^[0-9+().\-\s]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function validateIntake(raw: unknown, uploads: Upload[], limits: { maxPhotoBytes: number }): ValidationResult {
  const fields: string[] = [];
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body) return { ok: false, fields: ["body"] };

  const idempotencyKey = cleanText(body.idempotencyKey, 120);
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,120}$/.test(idempotencyKey)) fields.push("idempotencyKey");

  const requesterName = cleanText(body.requesterName, 80);
  if (!requesterName) fields.push("requesterName");

  const phone = cleanText(body.phone, 30);
  if (!phone || !validPhone(phone)) fields.push("phone");

  const lat = asNumber(body.lat);
  if (lat === null || lat < -90 || lat > 90) fields.push("lat");

  const lon = asNumber(body.lon);
  if (lon === null || lon < -180 || lon > 180) fields.push("lon");

  const injuries = cleanText(body.injuries, 400);
  if (!injuries) fields.push("injuries");

  const vehicle = cleanText(body.vehicle, 120);
  if (!vehicle) fields.push("vehicle");

  const situation = cleanText(body.situation, 500);
  if (!situation) fields.push("situation");

  const county = cleanText(body.county, 80);
  if (!county) fields.push("county");

  const photoUrls: string[] = [];
  if (body.photoUrls === undefined) {
    // Photos are optional.
  } else if (!Array.isArray(body.photoUrls)) {
    fields.push("photoUrls");
  } else if (body.photoUrls.length > 20) {
    fields.push("photoUrls");
  } else {
    for (const entry of body.photoUrls) {
      if (typeof entry !== "string" || entry.length > 2000) {
        fields.push("photoUrls");
        break;
      }
      photoUrls.push(entry.trim());
    }
  }

  let uploadBytes = 0;
  for (const upload of uploads) uploadBytes += upload.bytes.byteLength;
  if (uploads.length > 20 || uploadBytes > limits.maxPhotoBytes * 12) fields.push("photos");

  if (fields.length > 0 || !requesterName || !phone || lat === null || lon === null || !injuries || !vehicle || !situation || !county || !idempotencyKey) {
    return { ok: false, fields: [...new Set(fields)] };
  }

  return {
    ok: true,
    value: {
      idempotencyKey,
      requesterName,
      phone,
      lat,
      lon,
      injuries,
      vehicle,
      situation,
      county,
      photoUrls,
      uploads,
    },
  };
}
