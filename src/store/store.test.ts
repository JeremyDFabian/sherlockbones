import { describe, expect, it } from "vitest";
import { Store } from "./store.js";

function freshStore(): Store {
  // In-memory database keeps each test isolated and fast.
  return new Store(":memory:");
}

describe("Store coverage index", () => {
  it("returns tests covering the requested lines", () => {
    const store = freshStore();
    store.setCoverageForTest("t1", [
      { file: "a.ts", line: 1 },
      { file: "a.ts", line: 2 },
    ]);
    store.setCoverageForTest("t2", [
      { file: "a.ts", line: 2 },
      { file: "b.ts", line: 5 },
    ]);

    expect(store.getTestsForLines("a.ts", [1])).toEqual(["t1"]);
    expect(store.getTestsForLines("a.ts", [2])).toEqual(["t1", "t2"]);
    expect(store.getTestsForLines("b.ts", [5])).toEqual(["t2"]);
    expect(store.getTestsForLines("c.ts", [1])).toEqual([]);
  });

  it("returns every test touching a file when no lines are given", () => {
    const store = freshStore();
    store.setCoverageForTest("t1", [{ file: "a.ts", line: 1 }]);
    store.setCoverageForTest("t2", [{ file: "a.ts", line: 99 }]);

    expect(store.getTestsForLines("a.ts", [])).toEqual(["t1", "t2"]);
  });

  it("replaces a test's prior coverage when it is recaptured (self-heal)", () => {
    const store = freshStore();
    store.setCoverageForTest("t1", [{ file: "a.ts", line: 1 }]);
    store.setCoverageForTest("t1", [{ file: "a.ts", line: 9 }]);

    expect(store.getTestsForLines("a.ts", [1])).toEqual([]);
    expect(store.getTestsForLines("a.ts", [9])).toEqual(["t1"]);
  });
});

describe("Store source hashes", () => {
  it("round-trips a source hash and reports unknown files as undefined", () => {
    const store = freshStore();
    expect(store.getSourceHash("a.ts")).toBeUndefined();

    store.setSourceHash("a.ts", "abc123", 1000);
    expect(store.getSourceHash("a.ts")).toBe("abc123");

    store.setSourceHash("a.ts", "def456", 2000);
    expect(store.getSourceHash("a.ts")).toBe("def456");
  });
});

describe("Store runs and metrics", () => {
  it("logs runs with incrementing ids and round-trips fields", () => {
    const store = freshStore();
    const id1 = store.logRun({
      ts: 100,
      changedFiles: ["a.ts"],
      selectedTests: ["t1", "t2"],
      passed: true,
      durationMs: 1200,
      suiteSize: 800,
    });
    const id2 = store.logRun({
      ts: 200,
      changedFiles: ["b.ts"],
      selectedTests: ["t3"],
      passed: false,
      durationMs: 300,
      suiteSize: 800,
    });

    expect(id2).toBeGreaterThan(id1);

    const runs = store.getRecentRuns(10);
    expect(runs).toHaveLength(2);
    // Most recent first.
    expect(runs[0]).toMatchObject({
      id: id2,
      changedFiles: ["b.ts"],
      selectedTests: ["t3"],
      passed: false,
      durationMs: 300,
      suiteSize: 800,
    });
    expect(runs[1]).toMatchObject({ id: id1, passed: true, changedFiles: ["a.ts"] });
  });

  it("associates metrics with a run", () => {
    const store = freshStore();
    const runId = store.logRun({
      ts: 100,
      changedFiles: ["a.ts"],
      selectedTests: ["t1"],
      passed: true,
      durationMs: 50,
      suiteSize: 100,
    });
    store.recordMetrics({
      runId,
      recallEst: 0.95,
      reduction: 0.99,
      selectedCount: 1,
    });

    const metrics = store.getRecentMetrics(10);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      runId,
      recallEst: 0.95,
      reduction: 0.99,
      selectedCount: 1,
    });
  });
});

describe("Store test registry", () => {
  it("upserts test metadata keyed by test id", () => {
    const store = freshStore();
    store.registerTest({ testId: "t1", runner: "vitest", path: "a.test.ts" }, 100);
    expect(store.getTest("t1")).toMatchObject({
      testId: "t1",
      runner: "vitest",
      path: "a.test.ts",
      lastSeen: 100,
    });

    store.registerTest({ testId: "t1", runner: "vitest", path: "a.test.ts" }, 200);
    expect(store.getTest("t1")?.lastSeen).toBe(200);
  });
});
