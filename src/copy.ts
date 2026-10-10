import { outcomeLabel } from "./outcomes.js";
import type { Outcome } from "./types.js";

export const copy = {
  alreadyResponding: "You are already marked as responding.",
  nowResponding: "You are marked as responding. You were added to the private thread.",
  alreadyCant: "You are already marked as unable to make it.",
  nowCantRemoved: "You are marked as unable to make it and were removed from the private thread.",
  nowCant: "You are marked as unable to make it.",
  closedAlready: (outcome: Outcome | null) =>
    `This recovery is already closed (${outcomeLabel(outcome)}).`,
  notFound: "That recovery was not found.",
  closeForbidden: "Only a responder on this recovery, or a coordinator, can close it out.",
  chooseOutcome: "Choose an outcome to close out this recovery.",
  closedAck: (outcome: Outcome) =>
    `Closed out as ${outcomeLabel(outcome)}. Form links are in the private thread.`,
  unrecognized: "That action is not recognized.",
  unsupported: "This bot does not support that interaction.",
  recoveryClosedRespond: "This recovery is already closed, so responses are no longer recorded.",
  notInGuild: "Use this from the UORRT Discord server.",
  badRecoveryId: "Recovery ids look like r_ followed by 16 hex characters.",
  duplicateInteraction: "That response was already recorded.",
  threadUpdateFailed: "Could not update the private thread. Try again.",
  linksReposted: "Form links are in the private thread.",
  linksFailed: "The recovery was closed, but the form links could not be built. Check the form configuration.",
};
