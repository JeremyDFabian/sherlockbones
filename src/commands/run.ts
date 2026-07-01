import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore, type ProjectContext } from "../cli/context.js";
import { format, type FormatMode, type RunSummary } from "../formatter/formatter.js";
import { ImpactMap } from "../impact/impact-map.js";
import { ImportGraph } from "../impact/import-graph.js";
import {
  changedLines,
  hashContent,
  isTestFile,
  loadProject,
} from "../project/project.js";
import { VitestRunner } from "../runner/runner.js";
import { type Budget, plan } from "../selector/selector.js";
import type { Store } from "../store/store.js";
import { foldAndStore } from "./indexing.js";

/** Hot-path cap: a per-edit run should never block the loop for longer than this. */
const RUN_TIMEOUT_MS = 120_000;

export interface RunOptions {
  changed: string[];
  format: FormatMode;
  budget: Budget;
}

export interface RunResult {
  output: string;
  exitCode: number;
  summary: RunSummary;
}

function memoize<T>(factory: () => T): () => T {
  let value: T | undefined;
  let computed = false;
  return () => {
    if (!computed) {
      value = factory();
      computed = true;
    }
    return value as T;
  };
}

/**
 * The hot path: map changed files to covering tests, run them within budget, and
 * report. Also self-heals — folds the run's own coverage back into the index and
 * refreshes hashes for the changed files.
 */
export function runChanged(ctx: ProjectContext, opts: RunOptions): RunResult {
  const store = openStore(ctx);
  try {
    return runWithStore(store, ctx, opts);
  } finally {
    store.close();
  }
}

function runWithStore(store: Store, ctx: ProjectContext, opts: RunOptions): RunResult {
  // The project scan only happens if a fallback tier actually needs it.
  const loaded = memoize(() => loadProject(ctx.root));
  const impact = new ImpactMap({
    store,
    projectRoot: ctx.root,
    getImportGraph: memoize(() => ImportGraph.build(loaded().files, isTestFile)),
    getTestFiles: () => loaded().testFiles,
    hashFile: (rel) => {
      const file = loaded().files[path.join(ctx.root, rel)];
      return file === undefined ? null : hashContent(file);
    },
  });

  const changed = opts.changed.map((file) => ({
    file,
    lines: changedLines(ctx.root, file),
  }));
  const selection = impact.select(changed);
  const planned = plan(selection.tests, opts.budget);
  const testFiles = [...new Set(planned.selected.map((t) => t.file))];

  let results: RunSummary["results"] = [];
  let passed = true;
  let durationMs = 0;
  if (testFiles.length > 0) {
    const coverageDir = mkdtempSync(path.join(tmpdir(), "bones-run-"));
    const coverageOut = path.join(coverageDir, "cov.jsonl");
    try {
      const runner = new VitestRunner({
        projectRoot: ctx.root,
        vitestBin: ctx.vitestBin,
        configPath: ctx.configPath,
        coverageOut,
        timeoutMs: RUN_TIMEOUT_MS,
      });
      const outcome = runner.run(testFiles.map((f) => path.join(ctx.root, f)));
      results = outcome.results;
      passed = outcome.passed;
      durationMs = outcome.durationMs;

      // Self-heal: fold this run's coverage back into the index. We deliberately do
      // NOT refresh the changed files' source hashes here. An incremental run only
      // re-executes a subset of a file's covering tests, so the rest keep pre-edit
      // (line-shifted) mappings; marking the file "fresh" would make isStale() trust
      // those stale mappings and risk missing a covering test — the cardinal sin.
      // An edited file therefore stays "stale" (→ recall-safe whole-file widening)
      // until the next `bones map --rebuild` re-hashes it authoritatively.
      foldAndStore(store, ctx.root, coverageOut);
    } finally {
      rmSync(coverageDir, { recursive: true, force: true });
    }
  }

  const summary: RunSummary = {
    results,
    passed,
    durationMs,
    tier: selection.tier,
    lowConfidence: selection.lowConfidence,
    selectedCount: planned.selected.length,
    skippedCount: planned.skipped.length,
    unmapped: selection.unmapped,
  };

  persistRun(store, opts, summary);

  return {
    output: format(summary, opts.format),
    exitCode: passed ? 0 : 1,
    summary,
  };
}

function persistRun(store: Store, opts: RunOptions, summary: RunSummary): void {
  const suiteSize = store.countTests();
  const runId = store.logRun({
    ts: Date.now(),
    changedFiles: opts.changed,
    selectedTests: summary.results.map((r) => `${r.file} > ${r.name}`),
    passed: summary.passed,
    durationMs: summary.durationMs,
    suiteSize,
  });
  store.recordMetrics({
    runId,
    recallEst: null,
    reduction: suiteSize > 0 ? 1 - summary.selectedCount / suiteSize : 0,
    selectedCount: summary.selectedCount,
  });
}
