import { isConfiguredSecret, readConfig } from "./config.js";
import type { Deps } from "./deps.js";
import type { Env } from "./env.js";
import { json } from "./http.js";
import { verifyRangerRequest } from "./intakeAuth.js";
import { openRecovery } from "./recoveryFlow.js";
import type { Upload } from "./types.js";
import { validateIntake } from "./validate.js";

export async function handleIntake(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (!isConfiguredSecret(env.RANGER_SHARED_SECRET)) return json({ error: "Unauthorized" }, 401);
  const bytes = new Uint8Array(await request.arrayBuffer());
  const verified = await verifyRangerRequest({
    secret: env.RANGER_SHARED_SECRET,
    timestamp: request.headers.get("x-ranger-timestamp") ?? "",
    signatureHex: request.headers.get("x-ranger-signature") ?? "",
    body: bytes,
    now: deps.now(),
    windowSeconds: readConfig(env).replayWindowSeconds,
  });
  if (!verified.ok) {
    if (verified.reason === "replay") return json({ error: "Timestamp is outside the replay window" }, 401);
    return json({ error: "Unauthorized" }, 401);
  }

  const contentType = request.headers.get("content-type") ?? "";
  let parsed: unknown;
  const uploads: Upload[] = [];
  if (contentType.includes("multipart/form-data")) {
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: bytes,
    }).formData();
    const payload = form.get("payload");
    if (typeof payload !== "string") return json({ error: "Invalid intake", fields: ["payload"] }, 400);
    try {
      parsed = JSON.parse(payload);
    } catch {
      return json({ error: "Invalid intake", fields: ["payload"] }, 400);
    }
    for (const entry of form.getAll("photos")) {
      if (typeof entry === "string") continue;
      uploads.push({
        filename: entry.name || "photo",
        contentType: entry.type || "application/octet-stream",
        bytes: new Uint8Array(await entry.arrayBuffer()),
      });
    }
  } else if (contentType.includes("application/json") || contentType === "") {
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: "Invalid intake", fields: ["body"] }, 400);
    }
  } else {
    return json({ error: "Invalid intake", fields: ["content-type"] }, 400);
  }

  const validated = validateIntake(parsed, uploads, { maxPhotoBytes: readConfig(env).maxPhotoBytes });
  if (!validated.ok) return json({ error: "Invalid intake", fields: validated.fields }, 400);
  return openRecovery(env, deps, validated.value);
}
