import pc from "picocolors";
import type { Store } from "../store/store.js";

export interface StatsSummary {
  runs: number;
  avgReduction: number | null;
  avgRecall: number | null;
  lastDurationMs: number | null;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Aggregate reduction/recall/speed over recent runs. */
export function computeStats(store: Store, limit = 50): StatsSummary {
  const metrics = store.getRecentMetrics(limit);
  const runs = store.getRecentRuns(limit);
  const reductions = metrics.map((m) => m.reduction);
  const recalls = metrics
    .map((m) => m.recallEst)
    .filter((r): r is number => r !== null);

  return {
    runs: runs.length,
    avgReduction: reductions.length > 0 ? mean(reductions) : null,
    avgRecall: recalls.length > 0 ? mean(recalls) : null,
    lastDurationMs: runs[0]?.durationMs ?? null,
  };
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function formatStats(stats: StatsSummary): string {
  if (stats.runs === 0) return "bones: no runs recorded yet — run `bones map --rebuild` first.";
  return [
    pc.bold("bones stats"),
    `  runs recorded:  ${stats.runs}`,
    `  avg reduction:  ${pct(stats.avgReduction)}`,
    `  avg recall:     ${pct(stats.avgRecall)}`,
    `  last duration:  ${stats.lastDurationMs ?? "n/a"}ms`,
  ].join("\n");
}
