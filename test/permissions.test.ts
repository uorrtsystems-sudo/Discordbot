import { describe, expect, it } from "vitest";
import { commandRegistrationUrl, slashCommands } from "../src/commands.js";
import { BOT_PERMISSIONS, botPermissionBits, inviteUrl } from "../src/permissions.js";

describe("bot invite", () => {
  it("includes only the requested channel and thread permissions", () => {
    expect(botPermissionBits()).toBe(
      BOT_PERMISSIONS.VIEW_CHANNEL |
        BOT_PERMISSIONS.SEND_MESSAGES |
        BOT_PERMISSIONS.EMBED_LINKS |
        BOT_PERMISSIONS.ATTACH_FILES |
        BOT_PERMISSIONS.READ_MESSAGE_HISTORY |
        BOT_PERMISSIONS.MANAGE_THREADS |
        BOT_PERMISSIONS.CREATE_PRIVATE_THREADS |
        BOT_PERMISSIONS.SEND_MESSAGES_IN_THREADS,
    );
    expect(botPermissionBits().toString()).toBe("360777370624");
    const url = new URL(inviteUrl("app123"));
    expect(url.origin + url.pathname).toBe("https://discord.com/api/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("app123");
    expect(url.searchParams.get("permissions")).toBe("360777370624");
    expect(url.searchParams.get("scope")).toBe("bot applications.commands");
  });

  it("registers the public status command for a guild or globally", () => {
    expect(slashCommands.map((command) => command.name)).toEqual(["recovery"]);
    expect(commandRegistrationUrl("app123", "guild123")).toBe(
      "https://discord.com/api/v10/applications/app123/guilds/guild123/commands",
    );
    expect(commandRegistrationUrl("app123")).toBe("https://discord.com/api/v10/applications/app123/commands");
  });
});
