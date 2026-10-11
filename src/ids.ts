import { bytesToHex } from "./bytes.js";

export function newRecoveryId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `r_${bytesToHex(bytes)}`;
}

export function isRecoveryId(value: string): boolean {
  return /^r_[0-9a-f]{16}$/.test(value);
}
