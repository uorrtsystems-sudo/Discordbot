import { toArrayBuffer } from "./bytes.js";
import { DISCORD_TIMEOUT_MS, isPlaceholder } from "./config.js";
import { bindFetch } from "./fetchBind.js";
import type { OutgoingMessage } from "./types.js";

const DISCORD_API = "https://discord.com/api/v10";

function discordPath(response: Response): string {
  if (!response.url) return "discord";
  try {
    return new URL(response.url).pathname;
  } catch {
    return "discord";
  }
}

export interface DiscordApi {
  createMessage(channelId: string, message: OutgoingMessage): Promise<{ id: string }>;
  editMessage(
    channelId: string,
    messageId: string,
    message: Pick<OutgoingMessage, "content" | "components">,
  ): Promise<void>;
  createPrivateThread(channelId: string, name: string): Promise<{ id: string }>;
  addThreadMember(threadId: string, userId: string): Promise<void>;
  removeThreadMember(threadId: string, userId: string): Promise<void>;
}

type Json = Record<string, unknown>;

export class DiscordRest implements DiscordApi {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly token: string,
    fetchImpl: typeof fetch,
    private readonly baseUrl = DISCORD_API,
  ) {
    this.fetchImpl = bindFetch(fetchImpl);
  }

  async createMessage(channelId: string, message: OutgoingMessage): Promise<{ id: string }> {
    const payload = this.payload(message);
    const files = message.files ?? [];
    if (files.length === 0) {
      const response = await this.raw("POST", `/channels/${encodeURIComponent(channelId)}/messages`, payload);
      return { id: await this.expectId(response) };
    }
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    files.forEach((file, index) => {
      form.append(`files[${index}]`, new Blob([toArrayBuffer(file.bytes)], { type: file.contentType }), file.filename);
    });
    const response = await this.raw("POST", `/channels/${encodeURIComponent(channelId)}/messages`, form);
    return { id: await this.expectId(response) };
  }

  async editMessage(
    channelId: string,
    messageId: string,
    message: Pick<OutgoingMessage, "content" | "components">,
  ): Promise<void> {
    const response = await this.raw(
      "PATCH",
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      this.payload(message),
    );
    await this.expectOk(response);
  }

  /**
   * Start the thread on the channel, not on the public message.
   * POST /channels/{channel}/messages/{message}/threads always creates a public
   * thread (type 11) and ignores type 12. A public thread would show phone,
   * injuries, and vehicle details to everyone in #recoveries.
   */
  async createPrivateThread(channelId: string, name: string): Promise<{ id: string }> {
    const path = `/channels/${encodeURIComponent(channelId)}/threads`;
    const response = await this.raw("POST", path, {
      name,
      type: 12,
      invitable: false,
      auto_archive_duration: 10080,
    });
    if (response.status === 400) {
      await response.body?.cancel();
      const retry = await this.raw("POST", path, {
        name,
        type: 12,
        invitable: false,
        auto_archive_duration: 1440,
      });
      return { id: await this.expectId(retry) };
    }
    return { id: await this.expectId(response) };
  }

  async addThreadMember(threadId: string, userId: string): Promise<void> {
    const response = await this.raw(
      "PUT",
      `/channels/${encodeURIComponent(threadId)}/thread-members/${encodeURIComponent(userId)}`,
    );
    await this.expectOk(response);
  }

  async removeThreadMember(threadId: string, userId: string): Promise<void> {
    const response = await this.raw(
      "DELETE",
      `/channels/${encodeURIComponent(threadId)}/thread-members/${encodeURIComponent(userId)}`,
    );
    if (response.status === 404) return;
    await this.expectOk(response);
  }

  private payload(message: Pick<OutgoingMessage, "content" | "components">): Json {
    return {
      content: message.content,
      components: message.components ?? [],
      allowed_mentions: { parse: [] },
    };
  }

  private async raw(method: string, path: string, body?: Json | FormData): Promise<Response> {
    if (!this.token || isPlaceholder(this.token)) {
      throw new Error("Discord bot token is not configured");
    }
    const headers: Record<string, string> = {
      authorization: `Bot ${this.token}`,
      "user-agent": "UORRT-Dispatch",
    };
    let payload: string | FormData | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
  }

  private async expectOk(response: Response): Promise<void> {
    if (response.ok || response.status === 204) {
      await response.body?.cancel();
      return;
    }
    throw new Error(`Discord API ${response.status} on ${discordPath(response)}`);
  }

  private async expectId(response: Response): Promise<string> {
    if (!response.ok) throw new Error(`Discord API ${response.status} on ${discordPath(response)}`);
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as { id?: string }) : {};
    if (!parsed.id) throw new Error("Discord API response did not include an id");
    return parsed.id;
  }
}
