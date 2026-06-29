import path from "node:path";
import type { CoverageRecord } from "../types.js";

/** Minimal shape of an Istanbul per-file coverage object (only what we read). */
interface IstanbulFileCoverage {
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  s: Record<string, number>;
}

export type IstanbulCoverageData = Record<string, IstanbulFileCoverage>;

/** One raw per-test record as written by the in-worker capture hook. */
interface RawTestRecord {
  testId: string;
  files: Record<string, number[]>;
}

export interface FoldOptions {
  projectRoot: string;
  /** Given a project-relative path, returns true if it is itself a test file. */
  isTestFile: (relPath: string) => boolean;
}

/**
 * Reduce an Istanbul coverage object to the set of covered source lines per file.
 * A statement counts as covered when its hit count is > 0; multi-line statements
 * mark every line they span. Files with no covered lines are omitted.
 */
export function istanbulToFileLines(
  data: IstanbulCoverageData,
): Record<string, number[]> {
  const result: Record<string, number[]> = {};

  for (const [file, fileCoverage] of Object.entries(data)) {
    const lines = new Set<number>();
    for (const [id, count] of Object.entries(fileCoverage.s)) {
      if (count <= 0) continue;
      const statement = fileCoverage.statementMap[id];
      if (!statement) continue;
      for (let line = statement.start.line; line <= statement.end.line; line++) {
        lines.add(line);
      }
    }
    if (lines.size > 0) {
      result[file] = [...lines].sort((a, b) => a - b);
    }
  }

  return result;
}

function toProjectRelative(projectRoot: string, file: string): string {
  return path.relative(projectRoot, file).split(path.sep).join("/");
}

/**
 * Parse the JSONL stream of raw per-test coverage and normalize it into
 * {@link CoverageRecord}s: project-relative paths only, with node_modules,
 * out-of-root, and test files dropped. Records for the same test are merged and
 * de-duplicated. Test order follows first appearance; entries are sorted by
 * (file, line) for stable storage.
 */
export function foldCoverage(jsonl: string, opts: FoldOptions): CoverageRecord[] {
  // testId -> "file:line" keys, preserving first-seen test order via the Map.
  const byTest = new Map<string, Set<string>>();

  for (const rawLine of jsonl.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;

    const record = JSON.parse(trimmed) as RawTestRecord;
    let keys = byTest.get(record.testId);
    if (!keys) {
      keys = new Set<string>();
      byTest.set(record.testId, keys);
    }

    for (const [absFile, lines] of Object.entries(record.files)) {
      const rel = toProjectRelative(opts.projectRoot, absFile);
      if (rel.startsWith("..")) continue; // outside project root
      if (rel.split("/").includes("node_modules")) continue;
      if (opts.isTestFile(rel)) continue;

      for (const line of lines) {
        keys.add(`${rel}:${line}`);
      }
    }
  }

  const records: CoverageRecord[] = [];
  for (const [testId, keys] of byTest) {
    const entries = [...keys]
      .map((key) => {
        const idx = key.lastIndexOf(":");
        return { file: key.slice(0, idx), line: Number(key.slice(idx + 1)) };
      })
      .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
    records.push({ testId, entries });
  }

  return records;
}
