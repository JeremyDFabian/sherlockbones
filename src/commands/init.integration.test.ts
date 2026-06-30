import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ProjectContext } from "../cli/context.js";
import { init } from "./init.js";

const repoRoot = process.cwd();
const fixtureDir = path.join(repoRoot, "fixtures/sample-app");

afterAll(() => {
  // init writes the capture config into the fixture's .sherlockbones dir.
  rmSync(path.join(fixtureDir, ".sherlockbones"), { recursive: true, force: true });
});

describe("init + rebuild (integration)", () => {
  it("generates a working capture config and builds the index", () => {
    const ctx: ProjectContext = {
      root: fixtureDir,
      dbPath: path.join(mkdtempSync(path.join(tmpdir(), "bones-init-db-")), "index.db"),
      vitestBin: path.join(repoRoot, "node_modules/.bin/vitest"),
    };

    const result = init(ctx, { rebuild: true });

    // No agents configured in the fixture, but the capture config must let the
    // rebuild capture coverage for all four fixture tests.
    expect(result.agents).toEqual([]);
    expect(result.indexedTests).toBe(4);
  }, 90_000);
});
