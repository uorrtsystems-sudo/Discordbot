import { IDEMPOTENCY_LOCK_MS, isPlaceholder, readConfig } from "./config.js";
import { copy } from "./copy.js";
import type { Deps } from "./deps.js";
import {
  completeIdempotency,
  deleteIdempotency,
  deleteOpenRecovery,
  getIdempotency,
  getRecovery,
  getResponder,
  hasInteractionReceipt,
  insertIdempotencyPending,
  insertRecovery,
  listResponders,
  markClosed,
  saveAttachmentPlan,
  saveCloseoutMessage,
  saveInteractionReceipt,
  savePublicMessage,
  saveRosterMessage,
  saveThreadId,
  setIdempotencyRecovery,
  upsertResponder,
} from "./db.js";
import type { Env } from "./env.js";
import { isRecoveryId, newRecoveryId } from "./ids.js";
import { isOutcome, OUTCOMES } from "./outcomes.js";
import {
  formatCloseoutMessage,
  formatPublicMessage,
  formatThreadMessage,
  goingResponders,
  outcomeButtons,
  publicComponents,
  threadComponents,
} from "./messages.js";
import { planPhotos } from "./photos.js";
import { buildAarUrl, buildMileageUrl } from "./prefill.js";
import { recordSheetRow } from "./sheetLog.js";
import { threadTitle } from "./text.js";
import { recoveryDate } from "./time.js";
import { json } from "./http.js";
import type { Actor, ButtonSpec, IntakeInput, IntakeSuccess, Recovery, Responder, ResponderStatus } from "./types.js";

export type InteractionReply = {
  content: string;
  components?: ButtonSpec[][];
};

type Slot =
  | { kind: "replay"; body: IntakeSuccess }
  | { kind: "busy" }
  | { kind: "proceed"; recoveryId: string };

function intakeBody(recovery: Recovery): IntakeSuccess | null {
  if (!recovery.publicMessageId || !recovery.threadId) return null;
  return {
    recoveryId: recovery.id,
    publicMessageId: recovery.publicMessageId,
    threadId: recovery.threadId,
    attachedPhotos: recovery.attachedPhotoCount,
    skippedPhotos: recovery.attachmentNotes.length,
    skipped: recovery.attachmentNotes,
  };
}

async function beginIdempotency(deps: Deps, key: string, now: Date): Promise<Slot> {
  const nowIso = now.toISOString();
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await getIdempotency(deps.db, key);
    if (!existing) {
      const recoveryId = newRecoveryId();
      const inserted = await insertIdempotencyPending(deps.db, key, recoveryId, nowIso);
      if (!inserted) continue;
      return { kind: "proceed", recoveryId };
    }
    const recovery = existing.recoveryId ? await getRecovery(deps.db, existing.recoveryId) : null;
    if (existing.status === "complete") {
      const rebuilt = recovery ? intakeBody(recovery) : null;
      if (existing.responseJson) {
        try {
          return { kind: "replay", body: JSON.parse(existing.responseJson) as IntakeSuccess };
        } catch {
          if (rebuilt) return { kind: "replay", body: rebuilt };
        }
      } else if (rebuilt) {
        return { kind: "replay", body: rebuilt };
      }
    }
    if (recovery?.publicMessageId && existing.recoveryId) {
      return { kind: "proceed", recoveryId: existing.recoveryId };
    }
    const age = now.getTime() - Date.parse(existing.updatedAt);
    if (Number.isFinite(age) && age < IDEMPOTENCY_LOCK_MS) return { kind: "busy" };
    const recoveryId = existing.recoveryId ?? newRecoveryId();
    if (!existing.recoveryId) await setIdempotencyRecovery(deps.db, key, recoveryId, nowIso);
    return { kind: "proceed", recoveryId };
  }
  return { kind: "busy" };
}

async function rollbackUnpublished(deps: Deps, key: string, recoveryId: string): Promise<void> {
  const current = await getRecovery(deps.db, recoveryId);
  if (!current?.publicMessageId) {
    await deleteOpenRecovery(deps.db, recoveryId);
    await deleteIdempotency(deps.db, key);
  }
}

async function syncViews(deps: Deps, recovery: Recovery, responders: Responder[]): Promise<void> {
  if (recovery.publicChannelId && recovery.publicMessageId) {
    await deps.discord.editMessage(recovery.publicChannelId, recovery.publicMessageId, {
      content: formatPublicMessage(recovery, responders),
      components: publicComponents(recovery),
    });
  }
  if (recovery.threadId && recovery.rosterMessageId) {
    await deps.discord.editMessage(recovery.threadId, recovery.rosterMessageId, {
      content: formatThreadMessage(recovery, responders),
      components: threadComponents(recovery),
    });
  }
}

export async function openRecovery(env: Env, deps: Deps, input: IntakeInput): Promise<Response> {
  const config = readConfig(env);
  if (isPlaceholder(config.recoveriesChannelId)) {
    return json({ error: "Recoveries channel is not configured" }, 500);
  }
  const now = deps.now();
  const slot = await beginIdempotency(deps, input.idempotencyKey, now);
  if (slot.kind === "busy") {
    return json({ error: "This idempotency key is already in progress. Retry shortly." }, 409);
  }
  if (slot.kind === "replay") return json({ ...slot.body, idempotentReplay: true });

  const recoveryId = slot.recoveryId;
  try {
    let recovery = await getRecovery(deps.db, recoveryId);
    if (!recovery) {
      await insertRecovery(deps.db, {
        id: recoveryId,
        requesterName: input.requesterName,
        phone: input.phone,
        lat: input.lat,
        lon: input.lon,
        injuries: input.injuries,
        vehicle: input.vehicle,
        situation: input.situation,
        county: input.county,
        photoUrls: input.photoUrls,
        createdAt: now.toISOString(),
      });
      recovery = await getRecovery(deps.db, recoveryId);
    }
    if (!recovery) return json({ error: "Internal error" }, 500);

    if (!recovery.publicMessageId) {
      try {
        const plan = await planPhotos({
          urls: input.photoUrls,
          uploads: input.uploads,
          fetchPhoto: deps.fetchPhoto,
          maxPhotos: config.maxPhotos,
          maxPhotoBytes: config.maxPhotoBytes,
          maxTotalPhotoBytes: config.maxTotalPhotoBytes,
        });
        await saveAttachmentPlan(deps.db, recoveryId, plan.attached.length, plan.skipped);
        recovery = await getRecovery(deps.db, recoveryId);
        if (!recovery) return json({ error: "Internal error" }, 500);
        const posted = await deps.discord.createMessage(config.recoveriesChannelId, {
          content: formatPublicMessage(recovery, []),
          components: publicComponents(recovery),
          files: plan.attached,
        });
        await savePublicMessage(deps.db, recoveryId, config.recoveriesChannelId, posted.id);
      } catch {
        console.error("public post failed");
        await rollbackUnpublished(deps, input.idempotencyKey, recoveryId);
        return json(
          { error: "Could not post the recovery to Discord. Retry with the same idempotency key." },
          502,
        );
      }
    }

    recovery = await getRecovery(deps.db, recoveryId);
    if (!recovery?.publicMessageId) return json({ error: "Internal error" }, 500);

    if (!recovery.threadId) {
      try {
        const thread = await deps.discord.createPrivateThread(
          recovery.publicChannelId ?? config.recoveriesChannelId,
          recovery.publicMessageId,
          threadTitle(recovery.id, recovery.requesterName),
        );
        await saveThreadId(deps.db, recoveryId, thread.id);
      } catch {
        console.error("thread create failed");
        return json(
          { error: "Could not post the recovery to Discord. Retry with the same idempotency key." },
          502,
        );
      }
    }

    recovery = await getRecovery(deps.db, recoveryId);
    if (!recovery?.threadId) return json({ error: "Internal error" }, 500);

    if (!recovery.rosterMessageId) {
      try {
        const responders = await listResponders(deps.db, recoveryId);
        const roster = await deps.discord.createMessage(recovery.threadId, {
          content: formatThreadMessage(recovery, responders),
          components: threadComponents(recovery),
        });
        await saveRosterMessage(deps.db, recoveryId, roster.id);
      } catch {
        console.error("thread details failed");
        return json(
          { error: "Could not post the recovery to Discord. Retry with the same idempotency key." },
          502,
        );
      }
    }

    recovery = await getRecovery(deps.db, recoveryId);
    const body = recovery ? intakeBody(recovery) : null;
    if (!recovery || !body) return json({ error: "Internal error" }, 500);
    await completeIdempotency(deps.db, input.idempotencyKey, recoveryId, JSON.stringify(body), deps.now().toISOString());
    return json({ ...body, idempotentReplay: false });
  } catch {
    console.error("open recovery failed");
    await rollbackUnpublished(deps, input.idempotencyKey, recoveryId);
    return json({ error: "Internal error" }, 500);
  }
}

export function canCloseOut(actor: Actor, responders: Responder[], coordinatorRoleId: string): boolean {
  if (!isPlaceholder(coordinatorRoleId) && actor.roles.includes(coordinatorRoleId)) return true;
  return responders.some((responder) => responder.discordUserId === actor.id && responder.status === "responding");
}

async function requireRecovery(deps: Deps, recoveryId: string): Promise<Recovery | InteractionReply> {
  if (!isRecoveryId(recoveryId)) return { content: copy.badRecoveryId };
  const recovery = await getRecovery(deps.db, recoveryId);
  if (!recovery) return { content: copy.notFound };
  return recovery;
}

function isReply(value: Recovery | InteractionReply): value is InteractionReply {
  return "content" in value;
}

export async function applyAvailability(
  deps: Deps,
  recoveryId: string,
  actor: Actor,
  status: ResponderStatus,
  interactionId: string,
): Promise<InteractionReply> {
  if (await hasInteractionReceipt(deps.db, interactionId)) return { content: copy.duplicateInteraction };
  const found = await requireRecovery(deps, recoveryId);
  if (isReply(found)) return found;
  if (found.status === "closed") return { content: copy.recoveryClosedRespond };

  const prior = await getResponder(deps.db, recoveryId, actor.id);
  if (prior?.status !== status) {
    try {
      if (status === "responding") {
        if (!found.threadId) return { content: copy.threadUpdateFailed };
        await deps.discord.addThreadMember(found.threadId, actor.id);
      } else if (prior?.status === "responding" && found.threadId) {
        await deps.discord.removeThreadMember(found.threadId, actor.id);
      }
    } catch {
      console.error("thread roster update failed");
      return { content: copy.threadUpdateFailed };
    }
    const nowIso = deps.now().toISOString();
    await upsertResponder(deps.db, {
      recoveryId,
      discordUserId: actor.id,
      discordUsername: actor.username,
      displayName: actor.displayName,
      status,
      now: nowIso,
    });
    await recordSheetRow(deps.db, deps.sheets, "claim", [nowIso, recoveryId, actor.id, actor.displayName, status], nowIso);
  }

  const recovery = await getRecovery(deps.db, recoveryId);
  if (!recovery) return { content: copy.notFound };
  const responders = await listResponders(deps.db, recoveryId);
  try {
    await syncViews(deps, recovery, responders);
  } catch {
    console.error("message refresh failed");
    return { content: copy.threadUpdateFailed };
  }
  await saveInteractionReceipt(deps.db, interactionId, recoveryId, status, deps.now().toISOString());

  if (prior?.status === status) {
    return { content: status === "responding" ? copy.alreadyResponding : copy.alreadyCant };
  }
  if (status === "responding") return { content: copy.nowResponding };
  if (prior?.status === "responding") return { content: copy.nowCantRemoved };
  return { content: copy.nowCant };
}

async function ensureCloseoutMessage(
  env: Env,
  deps: Deps,
  recovery: Recovery,
  responders: Responder[],
): Promise<InteractionReply | null> {
  if (recovery.closeoutMessageId || !recovery.threadId) return null;
  const config = readConfig(env);
  const date = recoveryDate(recovery.createdAt);
  const going = goingResponders(responders);
  let content: string;
  try {
    content = formatCloseoutMessage(
      recovery,
      {
        aarUrl: buildAarUrl(config, {
          recoveryId: recovery.id,
          date,
          responders: going.map((responder) => responder.displayName).join(", ") || "none",
        }),
        mileage: going.map((responder) => ({
          volunteerName: responder.displayName,
          url: buildMileageUrl(config, {
            recoveryId: recovery.id,
            date,
            volunteerName: responder.displayName,
          }),
        })),
      },
      config,
      date,
    );
  } catch {
    return { content: copy.linksFailed };
  }
  try {
    const posted = await deps.discord.createMessage(recovery.threadId, { content });
    await saveCloseoutMessage(deps.db, recovery.id, posted.id);
  } catch {
    console.error("closeout post failed");
    return { content: copy.threadUpdateFailed };
  }
  return null;
}

export async function requestClose(
  env: Env,
  deps: Deps,
  recoveryId: string,
  actor: Actor,
  _interactionId: string,
): Promise<InteractionReply> {
  const found = await requireRecovery(deps, recoveryId);
  if (isReply(found)) return found;
  const responders = await listResponders(deps.db, recoveryId);
  if (!canCloseOut(actor, responders, readConfig(env).coordinatorRoleId)) {
    return { content: copy.closeForbidden };
  }
  if (found.status === "closed") {
    const failure = await ensureCloseoutMessage(env, deps, found, responders);
    if (failure) return failure;
    return { content: `${copy.closedAlready(found.outcome)} ${copy.linksReposted}` };
  }
  return { content: copy.chooseOutcome, components: [outcomeButtons(recoveryId, OUTCOMES)] };
}

export async function applyOutcome(
  env: Env,
  deps: Deps,
  recoveryId: string,
  actor: Actor,
  outcome: string,
  interactionId: string,
): Promise<InteractionReply> {
  if (!isOutcome(outcome)) return { content: copy.unrecognized };
  if (await hasInteractionReceipt(deps.db, interactionId)) return { content: copy.duplicateInteraction };
  const found = await requireRecovery(deps, recoveryId);
  if (isReply(found)) return found;
  const responders = await listResponders(deps.db, recoveryId);
  if (!canCloseOut(actor, responders, readConfig(env).coordinatorRoleId)) {
    return { content: copy.closeForbidden };
  }

  const nowIso = deps.now().toISOString();
  const transitioned = found.status === "open" ? await markClosed(deps.db, recoveryId, outcome, actor.id, actor.displayName, nowIso) : false;
  if (transitioned) {
    const going = goingResponders(responders);
    await recordSheetRow(
      deps.db,
      deps.sheets,
      "outcome",
      [
        nowIso,
        recoveryId,
        outcome,
        actor.id,
        actor.displayName,
        going.map((responder) => responder.displayName).join(", ") || "none",
        recoveryDate(found.createdAt),
      ],
      nowIso,
    );
  }

  const recovery = await getRecovery(deps.db, recoveryId);
  if (!recovery) return { content: copy.notFound };
  const latest = await listResponders(deps.db, recoveryId);
  try {
    await syncViews(deps, recovery, latest);
  } catch {
    console.error("closeout refresh failed");
  }
  const failure = await ensureCloseoutMessage(env, deps, recovery, latest);
  await saveInteractionReceipt(deps.db, interactionId, recoveryId, `outcome:${outcome}`, nowIso);
  if (failure) return failure;
  if (!transitioned) return { content: `${copy.closedAlready(recovery.outcome)} ${copy.linksReposted}` };
  return { content: copy.closedAck(outcome) };
}

export async function publicStatus(deps: Deps, recoveryId: string): Promise<InteractionReply> {
  const found = await requireRecovery(deps, recoveryId);
  if (isReply(found)) return found;
  const responders = await listResponders(deps.db, recoveryId);
  return { content: formatPublicMessage(found, responders) };
}
