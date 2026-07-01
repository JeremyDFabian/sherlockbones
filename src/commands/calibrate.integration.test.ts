import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectContext } from "../cli/context.js";
import { calibrate } from "./calibrate.js";
import { rebuildIndex } from "./rebuild.js";

describe("calibrate (integration)", () => {
  it("measures recall against the full suite for a breaking change", async () => {
    const repoRoot = process.cwd();
    const fixtureDir = path.join(repoRoot, "fixtures/sample-app");
    const ctx: ProjectContext = {
      root: fixtureDir,
      dbPath: path.join(mkdtempSync(path.join(tmpdir(), "bones-cal-")), "index.db"),
      vitestBin: path.join(repoRoot, "node_modules/.bin/vitest"),
      configPath: path.join(fixtureDir, "vitest.config.ts"),
    };
    rebuildIndex(ctx);

    const file = path.join(fixtureDir, "src", "pricing.ts");
    const original = readFileSync(file, "utf8");
    const mutated = original.replace("amount - (amount * pct)", "amount + (amount * pct)");
    expect(mutated).not.toBe(original);

    try {
      writeFileSync(file, mutated);
      const result = await calibrate(ctx, { changed: ["src/pricing.ts"] });

      // The edit breaks tests, and selection caught every failure the full suite found.
      expect(result.totalFailures).toBeGreaterThan(0);
      expect(result.caught).toBe(result.totalFailures);
      expect(result.recall).toBe(1);
    } finally {
      writeFileSync(file, original);
    }
  }, 90_000);
});
