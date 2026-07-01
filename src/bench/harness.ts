import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProjectContext } from "../cli/context.js";
import { rebuildIndex } from "../commands/rebuild.js";
import { runChanged } from "../commands/run.js";
import type { TestResult } from "../runner/runner.js";
import { VitestRunner } from "../runner/runner.js";
import { aggregate, type BenchSummary, type EditResult } from "./metrics.js";

export interface EditSpec {
  label: string;
  /** Project-relative source file to mutate. */
  file: string;
  /** Substring to replace and its breaking replacement. */
  find: string;
  replace: string;
}

function failedIds(results: TestResult[]): string[] {
  return results
    .filter((r) => r.status === "failed")
    .map((r) => `${r.file} > ${r.name}`);
}

/**
 * Measure one breaking edit: apply the mutation, run sherlockbones selection, run
 * the whole suite for ground truth, then restore the file. Reports which failures
 * the selection caught versus what the full suite found.
 */
export async function benchmarkEdit(ctx: ProjectContext, spec: EditSpec): Promise<EditResult> {
  const abs = path.join(ctx.root, spec.file);
  const original = readFileSync(abs, "utf8");
  const mutated = original.replace(spec.find, spec.replace);
  if (mutated === original) {
    throw new Error(`mutation for "${spec.label}" did not change ${spec.file}`);
  }

  try {
    writeFileSync(abs, mutated);

    const selected = await runChanged(ctx, {
      changed: [spec.file],
      format: "agent",
      budget: {},
    });
    const selectedFailures = new Set(failedIds(selected.summary.results));

    const full = new VitestRunner({
      projectRoot: ctx.root,
      vitestBin: ctx.vitestBin,
      configPath: ctx.configPath,
    }).run([]);
    const fullFailures = failedIds(full.results);

    return {
      label: spec.label,
      fullFailures,
      caughtFailures: fullFailures.filter((id) => selectedFailures.has(id)),
      selectedCount: selected.summary.selectedCount,
      suiteSize: full.results.length,
      selectedMs: selected.summary.durationMs,
      fullMs: full.durationMs,
    };
  } finally {
    writeFileSync(abs, original);
  }
}

/** Rebuild the index and benchmark each edit independently. */
export async function runBenchmark(
  ctx: ProjectContext,
  specs: EditSpec[],
): Promise<EditResult[]> {
  const results: EditResult[] = [];
  for (const spec of specs) {
    rebuildIndex(ctx);
    results.push(await benchmarkEdit(ctx, spec));
  }
  return results;
}

export function formatBench(results: EditResult[]): string {
  const summary: BenchSummary = aggregate(results);
  const lines = [
    "sherlockbones benchmark",
    "─".repeat(48),
    ...results.map(
      (r) =>
        `  ${r.label}: caught ${r.caughtFailures.length}/${r.fullFailures.length}, ` +
        `ran ${r.selectedCount}/${r.suiteSize} tests`,
    ),
    "─".repeat(48),
    `  edits:     ${summary.edits}`,
    `  recall:    ${(summary.recall * 100).toFixed(1)}%`,
    `  reduction: ${(summary.reduction * 100).toFixed(1)}%`,
    `  speedup:   ${summary.speedup.toFixed(1)}x`,
  ];
  return lines.join("\n");
}
