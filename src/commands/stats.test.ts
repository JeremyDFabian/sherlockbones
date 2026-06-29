import { describe, expect, it } from "vitest";
import { Store } from "../store/store.js";
import { computeStats } from "./stats.js";

function seed(store: Store, recall: number | null): void {
  const id = store.logRun({
    ts: 1,
    changedFiles: ["a.ts"],
    selectedTests: ["t"],
    passed: true,
    durationMs: 1500,
    suiteSize: 100,
  });
  store.recordMetrics({ runId: id, recallEst: recall, reduction: 0.98, selectedCount: 2 });
}

describe("computeStats", () => {
  it("reports zero runs for an empty index", () => {
    expect(computeStats(new Store(":memory:"))).toEqual({
      runs: 0,
      avgReduction: null,
      avgRecall: null,
      lastDurationMs: null,
    });
  });

  it("averages reduction and recall over recorded runs", () => {
    const store = new Store(":memory:");
    seed(store, 0.95);
    seed(store, null);

    const stats = computeStats(store);
    expect(stats.runs).toBe(2);
    expect(stats.avgReduction).toBeCloseTo(0.98);
    expect(stats.avgRecall).toBeCloseTo(0.95); // only non-null recall counts
    expect(stats.lastDurationMs).toBe(1500);
  });
});
