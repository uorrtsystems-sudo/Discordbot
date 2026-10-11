import { describe, expect, it } from "vitest";
import { copy } from "../src/copy.js";
import { formatPublicMessage, formatThreadMessage } from "../src/messages.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { baseIntake } from "./fixtures.js";
import { createTestApp, postIntake, repoRoot, visibleMessage } from "./helpers.js";
import type { Recovery } from "../src/types.js";

const PRIVATE = ["8015550148", "INJURY-SENTINEL", "VEHICLE-SENTINEL", "SITUATION-SENTINEL", "COUNTY-SENTINEL"];
const PRIVATE_LABELS = ["Phone", "Injuries", "Vehicle", "Situation", "County"];

function recovery(overrides: Partial<Recovery> = {}): Recovery {
  return {
    id: "r_0123abcd4567ef89",
    requesterName: "Jordan Lee",
    phone: "8015550148",
    lat: 40.45,
    lon: -111.5,
    injuries: "INJURY-SENTINEL",
    vehicle: "VEHICLE-SENTINEL",
    situation: "SITUATION-SENTINEL",
    county: "COUNTY-SENTINEL",
    photoUrls: ["https://cdn.example.com/scene.png"],
    attachmentNotes: [],
    attachedPhotoCount: 1,
    publicChannelId: "channel-recoveries",
    publicMessageId: "msg-1",
    threadId: "thread-2",
    rosterMessageId: "msg-3",
    closeoutMessageId: null,
    status: "open",
    outcome: null,
    closedByDiscordId: null,
    closedByName: null,
    closedAt: null,
    createdAt: "2026-10-11T05:30:00.000Z",
    ...overrides,
  };
}

describe("privacy split", () => {
  it("puts only the name, coordinates, map link, and who's going on the public message", () => {
    const text = formatPublicMessage(recovery(), []);
    expect(text).toBe(
      [
        "UORRT recovery r_0123abcd4567ef89",
        "Requester: Jordan Lee",
        "Coordinates: 40.450000, -111.500000",
        "Google Maps: https://www.google.com/maps?q=40.450000,-111.500000",
        "",
        "Who's going:",
        "No responders yet.",
      ].join("\n"),
    );
    for (const secret of [...PRIVATE, ...PRIVATE_LABELS]) expect(text).not.toContain(secret);
    const thread = formatThreadMessage(recovery(), []);
    for (const secret of PRIVATE) expect(thread).toContain(secret);
    for (const label of PRIVATE_LABELS) expect(thread).toContain(label);
  });

  it("does not put private fields on the public Discord post", async () => {
    const app = await createTestApp();
    const opened = await postIntake(app, baseIntake);
    expect(opened.status).toBe(200);
    const publicCalls = app.discord.calls.filter(
      (call) => call.channelId === "channel-recoveries" && (call.op === "createMessage" || call.op === "editMessage"),
    );
    expect(publicCalls.length).toBeGreaterThan(0);
    for (const call of publicCalls) {
      const visible = visibleMessage(call.message);
      for (const secret of [...PRIVATE, ...PRIVATE_LABELS, "https://cdn.example.com/scene.png"]) {
        expect(visible).not.toContain(secret);
      }
      expect(visible).toContain("Jordan Lee");
      expect(visible).toContain("https://www.google.com/maps?q=40.450000,-111.500000");
      expect(visible).toContain("I'm responding");
      expect(visible).toContain("Can't make it");
      expect(visible).not.toContain("Close out");
    }
    const threadCall = app.discord.calls.find((call) => call.op === "createMessage" && call.channelId?.startsWith("thread-"));
    expect(threadCall).toBeTruthy();
    const threadText = threadCall?.message?.content ?? "";
    for (const secret of PRIVATE) expect(threadText).toContain(secret);
    expect(JSON.stringify(threadCall?.message?.components)).toContain("Close out");
    expect(threadText).toContain("Glympse");
    expect(app.discord.calls.find((call) => call.op === "createPrivateThread")?.name).not.toContain("8015550148");
  });

  it("keeps user-facing copy free of the word member", () => {
    const rendered = [
      ...Object.values(copy).map((value) => (typeof value === "function" ? value("recovered" as never) : value)),
      formatPublicMessage(recovery(), []),
      formatThreadMessage(recovery(), []),
    ].join("\n");
    expect(rendered).not.toMatch(/\bmembers?\b/i);
    for (const file of ["README.md", "src/copy.ts", "src/messages.ts", "src/outcomes.ts", "src/commands.ts"]) {
      const text = readFileSync(join(repoRoot(), file), "utf8");
      expect(text, file).not.toMatch(/\bmembers?\b/i);
    }
  });
});
