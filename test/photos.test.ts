import { describe, expect, it } from "vitest";
import { PHOTO_USER_AGENT, fetchPhoto, photoUrlBlockReason, planPhotos } from "../src/photos.js";
import { TINY_PNG, baseIntake } from "./fixtures.js";
import { createTestApp, postIntake, visibleMessage } from "./helpers.js";

describe("photos", () => {
  it("blocks private and non-https photo URLs before any fetch", async () => {
    expect(photoUrlBlockReason("http://cdn.example.com/a.png")).toMatch(/https/);
    expect(photoUrlBlockReason("https://127.0.0.1/a.png")).toMatch(/blocked/);
    expect(photoUrlBlockReason("https://169.254.169.254/latest")).toMatch(/blocked/);
    expect(photoUrlBlockReason("https://localhost/a.png")).toMatch(/blocked/);
    expect(photoUrlBlockReason("https://cdn.example.com/a.png")).toBeNull();
    const fetchImpl = async () => {
      throw new Error("should not fetch");
    };
    const blocked = await fetchPhoto("https://169.254.169.254/a.png", { fetchImpl, maxBytes: 1000, timeoutMs: 1000 });
    expect(blocked.ok).toBe(false);
  });

  it("sends a descriptive user-agent so hosts such as Wikimedia accept the download", async () => {
    let userAgent = "";
    const result = await fetchPhoto("https://upload.wikimedia.org/wikipedia/commons/a.png", {
      fetchImpl: async (_input, init) => {
        userAgent = new Headers(init?.headers).get("user-agent") ?? "";
        return new Response(TINY_PNG, { status: 200, headers: { "content-type": "image/png" } });
      },
      maxBytes: 1000,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
    expect(userAgent).toBe(PHOTO_USER_AGENT);
    expect(userAgent.toLowerCase()).toContain("uorrt-dispatch");
  });

  it("does not follow redirects and skips oversized downloads", async () => {
    const redirect = await fetchPhoto("https://cdn.example.com/a.png", {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }),
      maxBytes: 1000,
      timeoutMs: 1000,
    });
    expect(redirect).toEqual({ ok: false, reason: "redirects are not followed" });

    const oversized = await fetchPhoto("https://cdn.example.com/a.png", {
      fetchImpl: async () => new Response(TINY_PNG, { status: 200, headers: { "content-type": "image/png", "content-length": "99999" } }),
      maxBytes: 100,
      timeoutMs: 1000,
    });
    expect(oversized).toEqual({ ok: false, reason: "larger than the attachment limit" });
  });

  it("attaches a real image and skips the rest past Discord's file count", async () => {
    const fetched: string[] = [];
    const urls = ["https://cdn.example.com/one.png", "https://cdn.example.com/two.png", "https://cdn.example.com/extra-photo.png"];
    const plan = await planPhotos({
      urls,
      uploads: [],
      maxPhotos: 2,
      maxPhotoBytes: 1024,
      maxTotalPhotoBytes: 2048,
      fetchPhoto: async (url) => {
        fetched.push(url);
        return { ok: true, filename: "scene.png", bytes: TINY_PNG, contentType: "image/png" };
      },
    });
    expect(fetched).toEqual(urls.slice(0, 2));
    expect(plan.attached).toHaveLength(2);
    expect(plan.skipped.map((note) => note.reason)).toContain("over the file count limit");
  });

  it("keeps skipped photo URLs out of the public post", async () => {
    const app = await createTestApp({
      env: { MAX_PHOTOS: "1" },
      fetchPhoto: async () => ({ ok: true, filename: "scene.png", bytes: TINY_PNG, contentType: "image/png" }),
    });
    const opened = await postIntake(app, {
      ...baseIntake,
      photoUrls: ["https://cdn.example.com/scene.png", "https://cdn.example.com/extra-photo.png"],
    });
    expect(opened.status).toBe(200);
    expect(opened.body.attachedPhotos).toBe(1);
    expect(opened.body.skippedPhotos).toBe(1);
    const publicCall = app.discord.calls.find((call) => call.op === "createMessage" && call.channelId === "channel-recoveries");
    expect(visibleMessage(publicCall?.message)).not.toContain("extra-photo");
    expect(publicCall?.message?.files).toHaveLength(1);
    const thread = app.discord.calls.find((call) => call.op === "createMessage" && call.channelId?.startsWith("thread-"));
    expect(thread?.message?.content).toContain("extra-photo.png");
    expect(thread?.message?.content).toContain("over the file count limit");
  });

  it("accepts an uploaded image on the intake request", async () => {
    const app = await createTestApp();
    const payload = { ...baseIntake, idempotencyKey: "idem-upload-01", photoUrls: [] as string[] };
    const form = new FormData();
    form.set("payload", JSON.stringify(payload));
    form.append("photos", new Blob([TINY_PNG], { type: "image/png" }), "scene.png");
    const probe = new Request("http://localhost/intake", { method: "POST", body: form });
    const raw = new Uint8Array(await probe.arrayBuffer());
    const opened = await postIntake(app, payload, {
      raw,
      contentType: probe.headers.get("content-type") ?? "",
    });
    expect(opened.status).toBe(200);
    expect(opened.body.attachedPhotos).toBe(1);
    const publicCall = app.discord.calls.find((call) => call.op === "createMessage" && call.channelId === "channel-recoveries");
    expect(publicCall?.message?.files).toHaveLength(1);
  });
});
