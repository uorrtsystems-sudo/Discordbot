import { readConfig } from "./config.js";
import { copy } from "./copy.js";
import type { Deps } from "./deps.js";
import { verifyDiscordRequest } from "./discordVerify.js";
import type { Env } from "./env.js";
import { fitDiscord, stripControls } from "./text.js";
import { json } from "./http.js";
import { buttonsRow } from "./messages.js";
import { isOutcome } from "./outcomes.js";
import { isRecoveryId } from "./ids.js";
import { applyAvailability, applyOutcome, publicStatus, requestClose, type InteractionReply } from "./recoveryFlow.js";
import type { Actor, ButtonSpec, DiscordInteraction } from "./types.js";

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const EPHEMERAL = 64;

export function ephemeralPayload(reply: InteractionReply): unknown {
  const data: Record<string, unknown> = {
    content: fitDiscord(reply.content),
    flags: EPHEMERAL,
  };
  if (reply.components && reply.components.length > 0) {
    data.components = reply.components.map((row: ButtonSpec[]) => buttonsRow(row));
  }
  return { type: 4, data };
}

export function actorFromInteraction(body: DiscordInteraction): Actor | null {
  const user = body.member?.user ?? body.user;
  if (!user?.id || !/^[A-Za-z0-9_-]{1,40}$/.test(user.id)) return null;
  const raw = body.member?.nick || user.global_name || user.username || "Volunteer";
  const displayName = stripControls(raw).trim().slice(0, 80) || "Volunteer";
  return {
    id: user.id,
    username: stripControls(user.username || "volunteer").slice(0, 80) || "volunteer",
    displayName,
    roles: (body.member?.roles ?? []).filter((role) => typeof role === "string"),
  };
}

export function parseCustomId(
  customId: string,
): { action: "respond" | "cant" | "close" | "outcome"; recoveryId: string; outcome?: string } | null {
  const parts = customId.split(":");
  const action = parts[0];
  const recoveryId = parts[1] ?? "";
  const extra = parts[2];
  if (!isRecoveryId(recoveryId)) return null;
  if ((action === "respond" || action === "cant" || action === "close") && parts.length === 2) {
    return { action, recoveryId };
  }
  if (action === "outcome" && parts.length === 3 && extra && isOutcome(extra)) {
    return { action, recoveryId, outcome: extra };
  }
  return null;
}

export async function handleInteraction(request: Request, env: Env, deps: Deps): Promise<Response> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const verified = await verifyDiscordRequest({
    publicKeyHex: env.DISCORD_PUBLIC_KEY,
    signatureHex: request.headers.get("x-signature-ed25519") ?? "",
    timestamp: request.headers.get("x-signature-timestamp") ?? "",
    body: bytes,
    now: deps.now(),
    windowSeconds: readConfig(env).replayWindowSeconds,
  });
  if (!verified.ok) return new Response("Unauthorized", { status: 401 });

  let body: DiscordInteraction;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) as DiscordInteraction;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (body.type === PING) return json({ type: 1 });

  try {
    if (body.type === APPLICATION_COMMAND) return json(ephemeralPayload(await handleCommand(deps, body)));
    if (body.type === MESSAGE_COMPONENT) return json(ephemeralPayload(await handleComponent(env, deps, body)));
  } catch {
    console.error("interaction failed");
    return json(ephemeralPayload({ content: copy.threadUpdateFailed }));
  }
  return json(ephemeralPayload({ content: copy.unsupported }));
}

async function handleCommand(deps: Deps, body: DiscordInteraction): Promise<InteractionReply> {
  if (body.data?.name !== "recovery") return { content: copy.unrecognized };
  const option = body.data.options?.find((entry) => entry.name === "id");
  const recoveryId = option?.value ?? "";
  return publicStatus(deps, recoveryId);
}

async function handleComponent(env: Env, deps: Deps, body: DiscordInteraction): Promise<InteractionReply> {
  const actor = actorFromInteraction(body);
  if (!actor) return { content: copy.notInGuild };
  const interactionId = body.id ?? "";
  if (!interactionId) return { content: copy.unrecognized };
  const parsed = parseCustomId(body.data?.custom_id ?? "");
  if (!parsed) return { content: copy.unrecognized };
  if (parsed.action === "respond") return applyAvailability(deps, parsed.recoveryId, actor, "responding", interactionId);
  if (parsed.action === "cant") return applyAvailability(deps, parsed.recoveryId, actor, "cant_make_it", interactionId);
  if (parsed.action === "close") return requestClose(env, deps, parsed.recoveryId, actor, interactionId);
  return applyOutcome(env, deps, parsed.recoveryId, actor, parsed.outcome ?? "", interactionId);
}
