import { outcomeLabel } from "./outcomes.js";
import { formsNeedConfiguration } from "./prefill.js";
import { escapeDiscord, fitDiscord, formatCoord, mapsUrl } from "./text.js";
import type { AppConfig } from "./config.js";
import type { ButtonSpec, ComponentRow, Recovery, Responder } from "./types.js";

export const BUTTON_PRIMARY = 1;
export const BUTTON_SECONDARY = 2;
export const BUTTON_SUCCESS = 3;
export const BUTTON_DANGER = 4;

export function buttonsRow(buttons: ButtonSpec[]): ComponentRow {
  return {
    type: 1,
    components: buttons.map((button) => ({
      type: 2,
      style: button.style,
      label: button.label,
      custom_id: button.customId,
      disabled: button.disabled ?? false,
    })),
  };
}

export function respondButton(recoveryId: string, disabled = false): ButtonSpec {
  return { customId: `respond:${recoveryId}`, label: "I'm responding", style: BUTTON_SUCCESS, disabled };
}

export function cantButton(recoveryId: string, disabled = false): ButtonSpec {
  return { customId: `cant:${recoveryId}`, label: "Can't make it", style: BUTTON_SECONDARY, disabled };
}

export function closeButton(recoveryId: string, disabled = false): ButtonSpec {
  return { customId: `close:${recoveryId}`, label: "Close out", style: BUTTON_DANGER, disabled };
}

export function outcomeButtons(recoveryId: string, outcomes: readonly { value: string; label: string }[]): ButtonSpec[] {
  return outcomes.map((outcome) => ({
    customId: `outcome:${recoveryId}:${outcome.value}`,
    label: outcome.label,
    style: BUTTON_PRIMARY,
  }));
}

export function goingResponders(responders: Responder[]): Responder[] {
  return responders.filter((responder) => responder.status === "responding");
}

export function decliningResponders(responders: Responder[]): Responder[] {
  return responders.filter((responder) => responder.status === "cant_make_it");
}

function nameLines(responders: Responder[], empty: string): string[] {
  if (responders.length === 0) return [empty];
  const max = 30;
  const lines = responders.slice(0, max).map((responder) => `- ${escapeDiscord(responder.displayName)}`);
  if (responders.length > max) lines.push(`- and ${responders.length - max} more responders`);
  return lines;
}

export function formatPublicMessage(recovery: Recovery, responders: Responder[]): string {
  const lines = [
    `UORRT recovery ${recovery.id}`,
    `Requester: ${escapeDiscord(recovery.requesterName)}`,
    `Coordinates: ${formatCoord(recovery.lat)}, ${formatCoord(recovery.lon)}`,
    `Google Maps: ${mapsUrl(recovery.lat, recovery.lon)}`,
  ];
  if (recovery.status === "closed") {
    lines.push(`Outcome: ${outcomeLabel(recovery.outcome)}`);
  }
  lines.push("", "Who's going:", ...nameLines(goingResponders(responders), "No responders yet."));
  return fitDiscord(lines.join("\n"));
}

export function formatThreadMessage(recovery: Recovery, responders: Responder[]): string {
  const lines = [
    `Recovery ${recovery.id}`,
    "These details stay in this private thread.",
    "",
    `Requester: ${escapeDiscord(recovery.requesterName)}`,
    `Phone: ${escapeDiscord(recovery.phone)}`,
    `Injuries: ${escapeDiscord(recovery.injuries)}`,
    `Vehicle: ${escapeDiscord(recovery.vehicle)}`,
    `Situation: ${escapeDiscord(recovery.situation)}`,
    `County: ${escapeDiscord(recovery.county)}`,
    "",
    "Who's going:",
    ...nameLines(goingResponders(responders), "No responders yet."),
  ];
  const declining = decliningResponders(responders);
  if (declining.length > 0) {
    lines.push("", "Unable to make it:", ...nameLines(declining, ""));
  }
  if (recovery.attachmentNotes.length > 0) {
    lines.push("", "Photos not attached:");
    for (const note of recovery.attachmentNotes.slice(0, 15)) {
      lines.push(`- ${escapeDiscord(note.source)} (${escapeDiscord(note.reason)})`);
    }
  }
  lines.push(
    "",
    "Responders can paste a Glympse link in this thread for live location. This bot does not track location.",
  );
  return fitDiscord(lines.join("\n"));
}

export function formatCloseoutMessage(
  recovery: Recovery,
  links: { aarUrl: string; mileage: { volunteerName: string; url: string }[] },
  config: AppConfig,
  date: string,
): string {
  const lines = [
    `Recovery ${recovery.id} is closed.`,
    `Outcome: ${outcomeLabel(recovery.outcome)}`,
    `Date: ${date}`,
    `Closed by: ${escapeDiscord(recovery.closedByName ?? "a coordinator")}`,
    "",
    "After-action report (existing UORRT form):",
    links.aarUrl,
    "",
    "Mileage forms for volunteers (existing UORRT form):",
  ];
  if (links.mileage.length === 0) {
    lines.push("No responders were going, so there are no mileage links.");
  } else {
    for (const link of links.mileage) {
      lines.push(`- ${escapeDiscord(link.volunteerName)}: ${link.url}`);
    }
  }
  if (formsNeedConfiguration(config)) {
    lines.push("", "These links use placeholder form ids. Replace them before relying on the forms.");
  }
  return fitDiscord(lines.join("\n"));
}

export function publicComponents(recovery: Recovery): ComponentRow[] {
  const disabled = recovery.status === "closed";
  return [[respondButton(recovery.id, disabled), cantButton(recovery.id, disabled)]].map(buttonsRow);
}

export function threadComponents(recovery: Recovery): ComponentRow[] {
  return [buttonsRow([closeButton(recovery.id, recovery.status === "closed")])];
}
