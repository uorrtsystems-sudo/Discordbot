import type { Outcome } from "./types.js";

export const OUTCOMES: readonly { value: Outcome; label: string }[] = [
  { value: "recovered", label: "Recovered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "declined", label: "Declined" },
  { value: "referred_to_tow", label: "Referred to tow" },
];

export function isOutcome(value: string): value is Outcome {
  return OUTCOMES.some((outcome) => outcome.value === value);
}

export function outcomeLabel(value: Outcome | null): string {
  return OUTCOMES.find((outcome) => outcome.value === value)?.label ?? "Closed";
}
