import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import { buildAarUrl, buildGoogleFormPrefillUrl, buildMileageUrl, formsNeedConfiguration } from "../src/prefill.js";
import { recoveryDate } from "../src/time.js";
import { createTestApp } from "./helpers.js";

describe("prefilled form links", () => {
  it("builds a Google Form prefill URL", () => {
    const url = new URL(
      buildGoogleFormPrefillUrl("TESTAARFORM", {
        "1001": "r_0123abcd4567ef89",
        "1002": "2026-10-10",
        "1003": "Ada Lovelace, Grace Hopper",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://docs.google.com/forms/d/e/TESTAARFORM/viewform");
    expect(url.searchParams.get("usp")).toBe("pp_url");
    expect(url.searchParams.get("entry.1001")).toBe("r_0123abcd4567ef89");
    expect(url.searchParams.get("entry.1002")).toBe("2026-10-10");
    expect(url.searchParams.get("entry.1003")).toBe("Ada Lovelace, Grace Hopper");
  });

  it("rejects a form id that could change the URL path", () => {
    expect(() => buildGoogleFormPrefillUrl("../other", { "1": "x" })).toThrow(/form id/i);
    expect(() => buildGoogleFormPrefillUrl("ok", { "bad id": "x" })).toThrow(/entry id/i);
  });

  it("fills the existing AAR and mileage forms from configuration", async () => {
    const app = await createTestApp();
    const config = readConfig(app.env);
    const aar = new URL(buildAarUrl(config, { recoveryId: "r_0123abcd4567ef89", date: "2026-10-10", responders: "Ada Lovelace" }));
    expect(aar.pathname).toContain("/forms/d/e/TESTAARFORM/viewform");
    expect(aar.searchParams.get("entry.1001")).toBe("r_0123abcd4567ef89");
    expect(aar.searchParams.get("entry.1002")).toBe("2026-10-10");
    expect(aar.searchParams.get("entry.1003")).toBe("Ada Lovelace");

    const mileage = new URL(
      buildMileageUrl(config, { recoveryId: "r_0123abcd4567ef89", date: "2026-10-10", volunteerName: "Ada Lovelace" }),
    );
    expect(mileage.pathname).toContain("/forms/d/e/TESTMILEAGEFORM/viewform");
    expect(mileage.searchParams.get("entry.2001")).toBe("r_0123abcd4567ef89");
    expect(mileage.searchParams.get("entry.2002")).toBe("2026-10-10");
    expect(mileage.searchParams.get("entry.2003")).toBe("Ada Lovelace");
    expect(formsNeedConfiguration(config)).toBe(false);
  });

  it("uses the America/Denver calendar date", () => {
    expect(recoveryDate("2026-10-11T05:30:00.000Z")).toBe("2026-10-10");
    expect(recoveryDate("2026-10-11T06:30:00.000Z")).toBe("2026-10-11");
  });

  it("warns when form ids are still placeholders", async () => {
    const app = await createTestApp({
      env: { AAR_FORM_ID: "REPLACE_WITH_AAR_FORM_ID", MILEAGE_FORM_ID: "REPLACE_WITH_MILEAGE_FORM_ID" },
    });
    expect(formsNeedConfiguration(readConfig(app.env))).toBe(true);
  });
});
