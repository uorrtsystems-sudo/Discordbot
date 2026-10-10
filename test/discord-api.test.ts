import { describe, expect, it } from "vitest";
import { DiscordRest } from "../src/discordApi.js";
import { TINY_PNG } from "./fixtures.js";

describe("Discord REST client", () => {
  it("posts JSON without putting the token in the body", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = new DiscordRest("test-discord-bot-token", async (input, init) => {
      seen.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    });
    await client.createMessage("channel-recoveries", { content: "hello" });
    const body = String(seen[0]?.init.body);
    expect(seen[0]?.init.headers).toMatchObject({ authorization: "Bot test-discord-bot-token" });
    expect(body).toContain("hello");
    expect(body).toContain("allowed_mentions");
    expect(body).not.toContain("test-discord-bot-token");
    expect(seen[0]?.url).toBe("https://discord.com/api/v10/channels/channel-recoveries/messages");
  });

  it("attaches files with payload_json", async () => {
    const client = new DiscordRest("test-discord-bot-token", async (_input, init) => {
      const form = init?.body as FormData;
      const payload = JSON.parse(String(form.get("payload_json"))) as { content: string };
      expect(payload.content).toBe("photo");
      expect(form.get("files[0]")).toBeTruthy();
      return new Response(JSON.stringify({ id: "msg-2" }), { status: 200 });
    });
    const created = await client.createMessage("channel-recoveries", {
      content: "photo",
      files: [{ filename: "scene.png", bytes: TINY_PNG, contentType: "image/png" }],
    });
    expect(created.id).toBe("msg-2");
  });

  it("retries private thread creation with a shorter archive window", async () => {
    const bodies: string[] = [];
    const client = new DiscordRest("test-discord-bot-token", async (_input, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) return new Response("no", { status: 400 });
      return new Response(JSON.stringify({ id: "thread-1" }), { status: 200 });
    });
    const thread = await client.createPrivateThread("channel-recoveries", "msg-1", "Recovery r_0123abcd4567ef89");
    expect(thread.id).toBe("thread-1");
    expect(bodies[0]).toContain("10080");
    expect(bodies[1]).toContain("1440");
    expect(bodies[1]).toContain("\"invitable\":false");
  });

  it("treats a missing thread participant as already removed", async () => {
    const client = new DiscordRest("test-discord-bot-token", async () => new Response(null, { status: 404 }));
    await expect(client.removeThreadMember("thread-1", "user-ada")).resolves.toBeUndefined();
  });
});
