import pc from "picocolors";
import { openStore, type ProjectContext } from "../cli/context.js";
import { changedSourceFiles } from "../project/project.js";
import { type TestResult, VitestRunner } from "../runner/runner.js";
import { runChanged } from "./run.js";

export interface CalibrateResult {
  /** Files the calibration ran against. */
  changed: string[];
  /** Caught ÷ total failures, or null when the suite is green (recall unmeasurable). */
  recall: number | null;
  caught: number;
  totalFailures: number;
  selectedCount: number;
  suiteSize: number;
  reduction: number;
}

function failureIds(results: TestResult[]): string[] {
  return results.filter((r) => r.status === "failed").map((r) => `${r.file} > ${r.name}`);
}

/**
 * Measure live failure recall: run the whole suite for ground truth, run what
 * selection picks for the current change, and report the fraction of real failures
 * the selection caught. Recall is only defined when something actually fails — on a
 * green suite it's null (you can't measure "of the failures, how many did we run?"
 * when there are none). The result is persisted so `bones stats` surfaces recall.
 *
 * This is an explicit calibration pass, not the hot path: it runs the full suite.
 */
export async function calibrate(
  ctx: ProjectContext,
  opts: { changed?: string[] } = {},
): Promise<CalibrateResult> {
  const changed =
    opts.changed && opts.changed.length > 0 ? opts.changed : changedSourceFiles(ctx.root);

  // Ground truth: the entire suite against the current working tree.
  const full = new VitestRunner({
    projectRoot: ctx.root,
    vitestBin: ctx.vitestBin,
    configPath: ctx.configPath,
  }).run([]);
  const fullFailures = new Set(failureIds(full.results));
  const suiteSize = full.results.length;

  // What selection would run for the change (cold, so it also self-heals coverage).
  let selectedFailures = new Set<string>();
  let selectedCount = 0;
  if (changed.length > 0) {
    const selected = await runChanged(ctx, {
      changed,
      format: "agent",
      budget: {},
      daemon: false,
    });
    selectedFailures = new Set(failureIds(selected.summary.results));
    selectedCount = selected.summary.selectedCount;
  }

  const caught = [...fullFailures].filter((id) => selectedFailures.has(id));
  const recall = fullFailures.size > 0 ? caught.length / fullFailures.size : null;
  const reduction = suiteSize > 0 ? 1 - selectedCount / suiteSize : 0;

  const store = openStore(ctx);
  try {
    const runId = store.logRun({
      ts: Date.now(),
      changedFiles: changed,
      selectedTests: [...selectedFailures],
      passed: fullFailures.size === 0,
      durationMs: full.durationMs,
      suiteSize,
    });
    store.recordMetrics({ runId, recallEst: recall, reduction, selectedCount });
  } finally {
    store.close();
  }

  return {
    changed,
    recall,
    caught: caught.length,
    totalFailures: fullFailures.size,
    selectedCount,
    suiteSize,
    reduction,
  };
}

export function formatCalibrate(r: CalibrateResult): string {
  const changed = r.changed.length > 0 ? r.changed.join(", ") : "(none — clean tree)";
  const recallLine =
    r.recall === null
      ? pc.dim("recall:    n/a — suite is green, no failures to measure against")
      : `recall:    ${(r.recall * 100).toFixed(1)}%  (caught ${r.caught}/${r.totalFailures} failures)`;
  return [
    pc.bold("bones calibrate"),
    `  changed:   ${changed}`,
    `  ${recallLine}`,
    `  reduction: ${(r.reduction * 100).toFixed(1)}%  (selected ${r.selectedCount} / ${r.suiteSize})`,
  ].join("\n");
}
