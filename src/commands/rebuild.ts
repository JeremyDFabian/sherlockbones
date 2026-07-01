import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, type ProjectContext } from "../cli/context.js";
import { loadProject } from "../project/project.js";
import { VitestRunner } from "../runner/runner.js";
import { foldAndStore, recordSourceHashes } from "./indexing.js";

export interface RebuildResult {
  tests: number;
}

/** A full-suite rebuild is legitimately slower than a per-edit run; cap generously. */
const REBUILD_TIMEOUT_MS = 600_000;

/**
 * Rebuild the impact index from scratch: run the whole suite with coverage capture,
 * fold per-test coverage into the store, and record source hashes for staleness.
 * Requires the project's Vitest config to load the sherlockbones setup file with
 * istanbul coverage enabled (installed by `bones init`).
 */
export function rebuildIndex(ctx: ProjectContext): RebuildResult {
  const outDir = mkdtempSync(path.join(tmpdir(), "bones-rebuild-"));
  const out = path.join(outDir, "cov.jsonl");

  try {
    const runner = new VitestRunner({
      projectRoot: ctx.root,
      vitestBin: ctx.vitestBin,
      configPath: ctx.configPath,
      coverageOut: out,
      timeoutMs: REBUILD_TIMEOUT_MS,
    });
    runner.run([]); // empty file list → whole suite

    const store = openStore(ctx);
    try {
      const tests = foldAndStore(store, ctx.root, out);
      const relSources = Object.keys(loadProject(ctx.root).files).map((abs) =>
        path.relative(ctx.root, abs).split(path.sep).join("/"),
      );
      recordSourceHashes(store, ctx.root, relSources);
      return { tests };
    } finally {
      store.close();
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
