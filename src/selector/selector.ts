import type { SelectedTest } from "../types.js";

export interface Budget {
  /** Maximum number of tests to run. */
  maxTests?: number;
  /** Maximum estimated wall-clock seconds (needs a duration estimate to bind). */
  maxSeconds?: number;
}

export interface PlanResult {
  selected: SelectedTest[];
  skipped: SelectedTest[];
}

/**
 * Decide which candidate tests to run within a budget, in the order given (the
 * impact map orders them). Anything that doesn't fit is reported in `skipped` —
 * selection never truncates silently, since a hidden skip is a recall blind spot.
 *
 * `estimateMs` supplies a per-test duration estimate for the seconds budget; with
 * the default estimate of 0 the seconds budget is a no-op.
 */
export function plan(
  candidates: SelectedTest[],
  budget: Budget = {},
  estimateMs: (test: SelectedTest) => number = () => 0,
): PlanResult {
  const selected: SelectedTest[] = [];
  const skipped: SelectedTest[] = [];
  let accumulatedMs = 0;

  for (const test of candidates) {
    const overCount =
      budget.maxTests !== undefined && selected.length + 1 > budget.maxTests;
    const overTime =
      budget.maxSeconds !== undefined &&
      accumulatedMs + estimateMs(test) > budget.maxSeconds * 1000;

    if (overCount || overTime) {
      skipped.push(test);
      continue;
    }

    selected.push(test);
    accumulatedMs += estimateMs(test);
  }

  return { selected, skipped };
}
