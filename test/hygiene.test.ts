import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers.js";

const SKIP = new Set(["node_modules", ".git", "dist", "coverage", ".wrangler"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return [path];
  });
}

describe("public repo hygiene", () => {
  it("does not commit snowflakes, private keys, or webhook URLs", () => {
    const root = repoRoot();
    const scanned = files(root).filter((path) => !path.endsWith("package-lock.json"));
    for (const path of scanned) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/\b\d{17,19}\b/);
      expect(text, path).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(text, path).not.toMatch(/discord\.com\/api\/webhooks\//);
      expect(text, path).not.toMatch(/-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/]{40,}/);
    }
  });
});
