import path from "node:path";
import {
  originalPositionFor,
  TraceMap,
  type SourceMapInput,
} from "@jridgewell/trace-mapping";
import type { CoverageRecord } from "../types.js";

interface Position {
  line: number;
  column: number;
}

/** Minimal shape of an Istanbul per-file coverage object (only what we read). */
interface IstanbulFileCoverage {
  /** Absolute path of the original source file. */
  path?: string;
  statementMap: Record<string, { start: Position; end: Position }>;
  s: Record<string, number>;
  /**
   * Source map from instrumented positions back to the original source. Present
   * when the runner instruments transpiled (TypeScript) code; statementMap
   * positions are then in transformed coordinates and must be remapped.
   */
  inputSourceMap?: SourceMapInput;
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
 * Reduce an Istanbul coverage object to the set of covered source lines per file,
 * keyed by original absolute path. A statement counts as covered when its hit count
 * is > 0; multi-line statements mark every line they span. When an input source map
 * is present (instrumented transpiled code), positions are remapped to the original
 * source so line numbers match the files a user actually edits. Files with no
 * covered lines are omitted.
 */
export function istanbulToFileLines(
  data: IstanbulCoverageData,
): Record<string, number[]> {
  const result: Record<string, Set<number>> = {};
  const mark = (file: string, line: number): void => {
    (result[file] ??= new Set<number>()).add(line);
  };

  for (const [key, fileCoverage] of Object.entries(data)) {
    const fallbackFile = fileCoverage.path ?? key;
    const tracer = fileCoverage.inputSourceMap
      ? new TraceMap(fileCoverage.inputSourceMap)
      : null;

    for (const [id, count] of Object.entries(fileCoverage.s)) {
      if (count <= 0) continue;
      const statement = fileCoverage.statementMap[id];
      if (!statement) continue;

      if (!tracer) {
        for (let line = statement.start.line; line <= statement.end.line; line++) {
          mark(fallbackFile, line);
        }
        continue;
      }

      markRemapped(tracer, statement, fallbackFile, mark);
    }
  }

  const out: Record<string, number[]> = {};
  for (const [file, lines] of Object.entries(result)) {
    out[file] = [...lines].sort((a, b) => a - b);
  }
  return out;
}

/** Remap a transformed statement's span to original source lines. */
function markRemapped(
  tracer: TraceMap,
  statement: { start: Position; end: Position },
  fallbackFile: string,
  mark: (file: string, line: number) => void,
): void {
  const start = originalPositionFor(tracer, statement.start);
  const end = originalPositionFor(tracer, statement.end);

  if (start.source === null || start.line === null) {
    // No mapping for this statement (instrumentation-only code): skip it.
    return;
  }

  const file = start.source;
  if (end.source === file && end.line !== null && end.line >= start.line) {
    for (let line = start.line; line <= end.line; line++) {
      mark(file, line);
    }
  } else {
    mark(file, start.line);
  }
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

    let record: RawTestRecord;
    try {
      record = JSON.parse(trimmed) as RawTestRecord;
    } catch {
      // A malformed line (e.g. interleaved concurrent writes) shouldn't lose the
      // rest of the coverage; skip it.
      continue;
    }
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
