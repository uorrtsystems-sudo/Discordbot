import { bindFetch } from "./fetchBind.js";
import type { PhotoNote, Upload } from "./types.js";

/**
 * upload.wikimedia.org returns 403 "Please set a user-agent" when this header
 * is missing. That response is not an image, so the download is reported as
 * "could not download".
 */
export const PHOTO_USER_AGENT = "UORRT-Dispatch/1.0 (volunteer recovery bot)";

export type AttachedPhoto = {
  filename: string;
  bytes: Uint8Array;
  contentType: string;
};

export type PhotoResult =
  | { ok: true; filename: string; bytes: Uint8Array; contentType: string }
  | { ok: false; reason: string };

type ImageKind = "jpeg" | "png" | "gif" | "webp";

const CANONICAL: Record<ImageKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export function imageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

function contentTypeMatches(contentType: string, kind: ImageKind): boolean {
  if (kind === "jpeg") return contentType === "image/jpeg" || contentType === "image/jpg";
  return contentType === CANONICAL[kind];
}

function isBlockedIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) return isBlockedIpv4(lower.slice("::ffff:".length));
  return false;
}

export function photoUrlBlockReason(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid url";
  }
  if (url.protocol !== "https:") return "only https photos are supported";
  if (url.username || url.password) return "photo url must not include credentials";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal"
  ) {
    return "blocked host";
  }
  if (/^\d+$/.test(host) || isBlockedIpv4(host)) return "blocked host";
  if (host.includes(":") && isBlockedIpv6(host)) return "blocked host";
  return null;
}

export function safeFilename(name: string, index: number, contentType: string): string {
  const ext = contentType === "image/png" ? "png" : contentType === "image/gif" ? "gif" : contentType === "image/webp" ? "webp" : "jpg";
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
  const base = cleaned || `photo-${index + 1}`;
  const withExt = base.includes(".") ? base : `${base}.${ext}`;
  return withExt.slice(0, 80);
}

function filenameFromUrl(raw: string, kind: ImageKind): string {
  try {
    const url = new URL(raw);
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return safeFilename(last, 0, CANONICAL[kind]);
  } catch {
    return safeFilename("", 0, CANONICAL[kind]);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const buffered = new Uint8Array(await response.arrayBuffer());
    return buffered.byteLength > maxBytes ? null : buffered;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function fetchPhoto(
  url: string,
  options: { fetchImpl: typeof fetch; maxBytes: number; timeoutMs: number },
): Promise<PhotoResult> {
  const blocked = photoUrlBlockReason(url);
  if (blocked) return { ok: false, reason: blocked };
  try {
    const response = await bindFetch(options.fetchImpl)(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: {
        accept: "image/jpeg,image/png,image/gif,image/webp",
        "user-agent": PHOTO_USER_AGENT,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, reason: "redirects are not followed" };
    }
    if (!response.ok) return { ok: false, reason: "could not download" };
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const bytes = await readLimited(response, options.maxBytes);
    if (!bytes) return { ok: false, reason: "larger than the attachment limit" };
    const kind = imageKind(bytes);
    if (!kind || !contentTypeMatches(contentType, kind)) return { ok: false, reason: "unsupported image type" };
    return { ok: true, bytes, contentType: CANONICAL[kind], filename: filenameFromUrl(url, kind) };
  } catch {
    return { ok: false, reason: "could not download" };
  }
}

function inspectUpload(upload: Upload, maxBytes: number, index: number): PhotoResult {
  if (upload.bytes.byteLength > maxBytes) return { ok: false, reason: "larger than the attachment limit" };
  const contentType = upload.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const kind = imageKind(upload.bytes);
  if (!kind || !contentTypeMatches(contentType, kind)) return { ok: false, reason: "unsupported image type" };
  return {
    ok: true,
    bytes: upload.bytes,
    contentType: CANONICAL[kind],
    filename: safeFilename(upload.filename, index, CANONICAL[kind]),
  };
}

function dedupeFilenames(photos: AttachedPhoto[]): AttachedPhoto[] {
  const used = new Set<string>();
  return photos.map((photo, index) => {
    let name = photo.filename;
    if (used.has(name)) name = safeFilename(`${index + 1}-${photo.filename}`, index, photo.contentType);
    used.add(name);
    return { ...photo, filename: name };
  });
}

export async function planPhotos(input: {
  urls: string[];
  uploads: Upload[];
  fetchPhoto: (url: string) => Promise<PhotoResult>;
  maxPhotos: number;
  maxPhotoBytes: number;
  maxTotalPhotoBytes: number;
}): Promise<{ attached: AttachedPhoto[]; skipped: PhotoNote[] }> {
  const attached: AttachedPhoto[] = [];
  const skipped: PhotoNote[] = [];
  let total = 0;

  const consider = (source: string, result: PhotoResult) => {
    if (!result.ok) {
      skipped.push({ source, reason: result.reason });
      return;
    }
    if (result.bytes.byteLength > input.maxPhotoBytes) {
      skipped.push({ source, reason: "larger than the attachment limit" });
      return;
    }
    if (total + result.bytes.byteLength > input.maxTotalPhotoBytes) {
      skipped.push({ source, reason: "larger than the attachment limit" });
      return;
    }
    total += result.bytes.byteLength;
    attached.push({
      filename: result.filename,
      bytes: result.bytes,
      contentType: result.contentType,
    });
  };

  const candidates: { source: string; load: () => Promise<PhotoResult> }[] = [
    ...input.urls.map((url) => ({ source: url, load: () => input.fetchPhoto(url) })),
    ...input.uploads.map((upload, index) => ({
      source: `upload:${upload.filename || `photo-${index + 1}`}`,
      load: async () => inspectUpload(upload, input.maxPhotoBytes, index),
    })),
  ];

  for (const candidate of candidates) {
    if (attached.length >= input.maxPhotos) {
      skipped.push({ source: candidate.source, reason: "over the file count limit" });
      continue;
    }
    consider(candidate.source, await candidate.load());
  }

  return { attached: dedupeFilenames(attached), skipped };
}
