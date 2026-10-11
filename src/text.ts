import { DISCORD_CONTENT_LIMIT } from "./config.js";

export function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function stripControls(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code > 31 && code !== 127) out += char;
  }
  return out;
}

export function escapeDiscord(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(/([*_`~|>])/g, "\\$1")
    .replaceAll("@", "@\u200b");
}

export function fitDiscord(content: string): string {
  if (content.length <= DISCORD_CONTENT_LIMIT) return content;
  return `${content.slice(0, DISCORD_CONTENT_LIMIT - 1)}…`;
}

export function formatCoord(value: number): string {
  return value.toFixed(6);
}

export function mapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps?q=${formatCoord(lat)},${formatCoord(lon)}`;
}

export function threadTitle(recoveryId: string, requesterName: string): string {
  const name = requesterName.replace(/[^\p{L}\p{N} .'-]/gu, "").trim();
  return `Recovery ${recoveryId} ${name}`.trim().slice(0, 100);
}
