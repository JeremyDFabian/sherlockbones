import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectContext } from "../cli/context.js";
import { rebuildIndex } from "../commands/rebuild.js";
import { benchmarkEdit } from "./harness.js";

describe("benchmarkEdit (integration)", () => {
  it("catches the failures a breaking edit introduces", async () => {
    const repoRoot = process.cwd();
    const fixtureDir = path.join(repoRoot, "fixtures/sample-app");
    const ctx: ProjectContext = {
      root: fixtureDir,
      dbPath: path.join(mkdtempSync(path.join(tmpdir(), "bones-bench-")), "index.db"),
      vitestBin: path.join(repoRoot, "node_modules/.bin/vitest"),
      configPath: path.join(fixtureDir, "vitest.config.ts"),
    };

    rebuildIndex(ctx);

    const result = await benchmarkEdit(ctx, {
      label: "invert discount",
      file: "src/pricing.ts",
      find: "amount - (amount * pct)",
      replace: "amount + (amount * pct)",
    });

    // The edit breaks at least one test, and selection caught everything it broke.
    expect(result.fullFailures.length).toBeGreaterThan(0);
    expect(result.caughtFailures).toEqual(result.fullFailures);
  }, 90_000);
});
