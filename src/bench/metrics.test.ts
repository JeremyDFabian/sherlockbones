import { describe, expect, it } from "vitest";
import { aggregate, type EditResult } from "./metrics.js";

const base: EditResult = {
  label: "edit",
  fullFailures: ["a", "b"],
  caughtFailures: ["a", "b"],
  selectedCount: 2,
  suiteSize: 100,
  selectedMs: 100,
  fullMs: 1000,
};

describe("aggregate", () => {
  it("computes recall, reduction, and speedup for a perfect run", () => {
    const summary = aggregate([base]);
    expect(summary.edits).toBe(1);
    expect(summary.recall).toBeCloseTo(1);
    expect(summary.reduction).toBeCloseTo(0.98);
    expect(summary.speedup).toBeCloseTo(10);
  });

  it("counts missed failures against recall", () => {
    const summary = aggregate([{ ...base, caughtFailures: ["a"] }]);
    expect(summary.recall).toBeCloseTo(0.5);
  });

  it("treats an edit with no failures as full recall", () => {
    const summary = aggregate([
      { ...base, fullFailures: [], caughtFailures: [] },
    ]);
    expect(summary.recall).toBeCloseTo(1);
  });

  it("averages reduction and totals time across edits", () => {
    const summary = aggregate([
      { ...base, selectedCount: 2, suiteSize: 100, selectedMs: 100, fullMs: 1000 },
      { ...base, selectedCount: 10, suiteSize: 100, selectedMs: 300, fullMs: 1000 },
    ]);
    expect(summary.reduction).toBeCloseTo(1 - (0.02 + 0.1) / 2); // 0.94
    expect(summary.speedup).toBeCloseTo(2000 / 400); // 5
  });
});
