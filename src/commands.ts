export const slashCommands = [
  {
    name: "recovery",
    description: "Show the public status of a recovery",
    options: [
      {
        name: "id",
        description: "Recovery id, for example r_0123abcd4567ef89",
        type: 3,
        required: true,
      },
    ],
  },
] as const;

export function commandRegistrationUrl(applicationId: string, guildId?: string): string {
  const base = "https://discord.com/api/v10";
  if (guildId) {
    return `${base}/applications/${encodeURIComponent(applicationId)}/guilds/${encodeURIComponent(guildId)}/commands`;
  }
  return `${base}/applications/${encodeURIComponent(applicationId)}/commands`;
}
