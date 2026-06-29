import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { istanbulToFileLines, type IstanbulCoverageData } from "./extractor.js";

// Vitest setup file injected during a sherlockbones coverage capture. It isolates
// per-test coverage by zeroing Istanbul's statement counters before each test and
// snapshotting them afterwards, writing one JSONL record per test to the file named
// in BONES_COVERAGE_OUT. It is a no-op when that env var or instrumentation is absent.
//
// Vitest's istanbul provider exposes the live coverage object as the
// `__VITEST_COVERAGE__` global. Zeroing it mid-run discards Vitest's own aggregate
// report, which is fine: a capture run exists only to build our per-test index.

declare global {
  var __VITEST_COVERAGE__: IstanbulCoverageData | undefined;
}

const outPath = process.env.BONES_COVERAGE_OUT;
let outReady = false;

interface TaskLike {
  name: string;
  suite?: TaskLike;
  file?: { name: string };
}

function buildTestId(task: TaskLike): string {
  const parts = [task.name];
  let suite = task.suite;
  while (suite && suite.name) {
    parts.unshift(suite.name);
    suite = suite.suite;
  }
  const file = task.file?.name ?? "unknown";
  return `${file} > ${parts.join(" > ")}`;
}

function resetCounts(coverage: IstanbulCoverageData): void {
  for (const file of Object.values(coverage)) {
    for (const id of Object.keys(file.s)) {
      file.s[id] = 0;
    }
  }
}

beforeEach(() => {
  if (globalThis.__VITEST_COVERAGE__) {
    resetCounts(globalThis.__VITEST_COVERAGE__);
  }
});

afterEach((ctx) => {
  if (!outPath) return;
  const coverage = globalThis.__VITEST_COVERAGE__;
  if (!coverage) return;

  if (!outReady) {
    mkdirSync(dirname(outPath), { recursive: true });
    outReady = true;
  }

  const files = istanbulToFileLines(coverage);
  const testId = buildTestId(ctx.task as unknown as TaskLike);
  appendFileSync(outPath, JSON.stringify({ testId, files }) + "\n");
});
