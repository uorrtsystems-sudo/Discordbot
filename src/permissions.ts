export const BOT_PERMISSIONS = {
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
} as const;

export function botPermissionBits(): bigint {
  return Object.values(BOT_PERMISSIONS).reduce((sum, bit) => sum | bit, 0n);
}

export function inviteUrl(applicationId: string): string {
  const params = new URLSearchParams({
    client_id: applicationId,
    permissions: botPermissionBits().toString(),
    scope: "bot applications.commands",
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}
