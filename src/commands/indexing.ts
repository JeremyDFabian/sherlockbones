import { readFileSync } from "node:fs";
import path from "node:path";
import { foldCoverage } from "../coverage/extractor.js";
import { parseTestId } from "../impact/impact-map.js";
import { hashContent, isTestFile } from "../project/project.js";
import type { Store } from "../store/store.js";

/**
 * Fold a per-test coverage JSONL file into the store: each test's coverage replaces
 * its prior entries (self-heal) and the test is registered. Returns the number of
 * tests folded. Missing/empty input yields 0.
 */
export function foldAndStore(store: Store, root: string, jsonlPath: string): number {
  let jsonl: string;
  try {
    jsonl = readFileSync(jsonlPath, "utf8");
  } catch {
    return 0;
  }

  const records = foldCoverage(jsonl, { projectRoot: root, isTestFile });
  const now = Date.now();
  for (const record of records) {
    store.setCoverageForTest(record.testId, record.entries);
    store.registerTest(
      { testId: record.testId, runner: "vitest", path: parseTestId(record.testId).file },
      now,
    );
  }
  return records.length;
}

/** Record current content hashes for the given project-relative source files. */
export function recordSourceHashes(
  store: Store,
  root: string,
  relFiles: string[],
): void {
  const now = Date.now();
  for (const rel of relFiles) {
    if (isTestFile(rel)) continue;
    try {
      const content = readFileSync(path.join(root, rel), "utf8");
      store.setSourceHash(rel, hashContent(content), now);
    } catch {
      // File was deleted; leave its hash so staleness is detected on next run.
    }
  }
}
