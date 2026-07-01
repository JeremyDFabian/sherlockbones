import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectContext } from "../cli/context.js";
import { rebuildIndex } from "./rebuild.js";
import { runChanged } from "./run.js";

function fixtureContext(): ProjectContext {
  const repoRoot = process.cwd();
  const fixtureDir = path.join(repoRoot, "fixtures/sample-app");
  return {
    root: fixtureDir,
    dbPath: path.join(mkdtempSync(path.join(tmpdir(), "bones-db-")), "index.db"),
    vitestBin: path.join(repoRoot, "node_modules/.bin/vitest"),
    configPath: path.join(fixtureDir, "vitest.config.ts"),
  };
}

describe("rebuild + run (integration)", () => {
  it("rebuilds the index then selects covering tests for a changed file", async () => {
    const ctx = fixtureContext();

    const rebuilt = rebuildIndex(ctx);
    expect(rebuilt.tests).toBe(4);

    // pricing.ts is exercised by both pricing tests and the cart discount test.
    const result = await runChanged(ctx, {
      changed: ["src/pricing.ts"],
      format: "human",
      budget: {},
    });

    expect(result.summary.tier).toBe("coverage");
    expect(result.exitCode).toBe(0);
    expect(result.summary.passed).toBe(true);
    // Both pricing tests plus the cart test that runs through pricing.
    const files = new Set(result.summary.results.map((r) => r.file));
    expect([...files].some((f) => f.endsWith("pricing.test.ts"))).toBe(true);
    expect([...files].some((f) => f.endsWith("cart.test.ts"))).toBe(true);
    // Selection is a true subset is not guaranteed here (small suite), but it must
    // not have fallen back.
    expect(result.summary.lowConfidence).toBe(false);
  }, 90_000);

  it("maps a cart-only change without pulling in unrelated suites", async () => {
    const ctx = fixtureContext();
    rebuildIndex(ctx);

    const result = await runChanged(ctx, {
      changed: ["src/cart.ts"],
      format: "agent",
      budget: {},
    });

    const files = new Set(result.summary.results.map((r) => r.file));
    // cart.ts is only exercised by cart.test.ts.
    expect([...files].every((f) => f.endsWith("cart.test.ts"))).toBe(true);
    expect(result.summary.passed).toBe(true);
  }, 90_000);
});
