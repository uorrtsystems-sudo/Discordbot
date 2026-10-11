import { pathToFileURL } from "node:url";
import { commandRegistrationUrl, slashCommands } from "../src/commands.js";
import { bindFetch } from "../src/fetchBind.js";
import { loadDevVars } from "./load-dev-vars.js";

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out.slice(0, 500);
}

export async function registerCommands(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<void> {
  const token = env.DISCORD_BOT_TOKEN ?? "";
  const applicationId = env.DISCORD_APPLICATION_ID ?? "";
  const guildId = env.DISCORD_GUILD_ID || undefined;
  if (!token || !applicationId) {
    throw new Error("Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID");
  }
  const response = await bindFetch(fetchImpl)(commandRegistrationUrl(applicationId, guildId), {
    method: "PUT",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(slashCommands),
  });
  if (!response.ok) {
    const text = redact(await response.text(), [token]);
    throw new Error(`Command registration failed (${response.status}): ${text}`);
  }
  console.log(
    `Registered ${slashCommands.length} command(s) at ${guildId ? "guild" : "global"} scope.`,
  );
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  loadDevVars();
  registerCommands(process.env, fetch).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Registration failed");
    process.exit(1);
  });
}
