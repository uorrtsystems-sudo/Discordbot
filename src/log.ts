const SECRET_RUN = /(?:bot|bearer)\s+\S+/gi;
const LONG_DIGITS = /\d{7,}/g;

/** Error text safe to log: no bot tokens, bearer tokens, or long digit runs (phones). */
export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const cleaned = raw
    .replace(SECRET_RUN, "[redacted]")
    .replace(LONG_DIGITS, "[redacted]")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return (cleaned || "unknown error").slice(0, 300);
}
