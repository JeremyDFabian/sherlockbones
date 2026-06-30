export interface EditResult {
  label: string;
  /** Test ids that failed when the whole suite ran (ground truth). */
  fullFailures: string[];
  /** Failures that the selected subset also ran and caught. */
  caughtFailures: string[];
  selectedCount: number;
  suiteSize: number;
  selectedMs: number;
  fullMs: number;
}

export interface BenchSummary {
  edits: number;
  /** Caught failures ÷ all failures the full suite found (1 when none failed). */
  recall: number;
  /** 1 − mean(selected ÷ suite size). */
  reduction: number;
  /** Total full-suite time ÷ total selected time. */
  speedup: number;
}

/** Aggregate per-edit benchmark results into the headline metrics. */
export function aggregate(results: EditResult[]): BenchSummary {
  let totalFull = 0;
  let totalCaught = 0;
  let reductionSum = 0;
  let selectedMs = 0;
  let fullMs = 0;

  for (const r of results) {
    totalFull += r.fullFailures.length;
    totalCaught += r.caughtFailures.length;
    reductionSum += r.suiteSize > 0 ? 1 - r.selectedCount / r.suiteSize : 0;
    selectedMs += r.selectedMs;
    fullMs += r.fullMs;
  }

  return {
    edits: results.length,
    recall: totalFull === 0 ? 1 : totalCaught / totalFull,
    reduction: results.length > 0 ? reductionSum / results.length : 0,
    speedup: selectedMs > 0 ? fullMs / selectedMs : 0,
  };
}
