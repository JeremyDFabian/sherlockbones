import path from "node:path";
import type { Store } from "../store/store.js";
import type { SelectedTest } from "../types.js";
import { guessTests } from "./heuristic.js";
import type { ImportGraph } from "./import-graph.js";

export type ImpactTier = "coverage" | "import-graph" | "heuristic" | "none";

const TIER_PRECISION: Record<ImpactTier, number> = {
  none: 0,
  heuristic: 1,
  "import-graph": 2,
  coverage: 3,
};

export interface ChangedFile {
  /** Project-relative path. */
  file: string;
  /** Changed line numbers, when known. Empty/absent → whole-file lookup. */
  lines?: number[];
}

export interface SelectionResult {
  tests: SelectedTest[];
  /** Best (most precise) tier that produced results. */
  tier: ImpactTier;
  /** True when any fallback tier or stale coverage was involved. */
  lowConfidence: boolean;
  /** Changed files no tier could map to a test. */
  unmapped: string[];
}

export interface ImpactMapDeps {
  store: Store;
  projectRoot: string;
  /** Lazily built (only consulted on a coverage miss or staleness). */
  getImportGraph: () => ImportGraph;
  /** Absolute paths of the project's test files. */
  getTestFiles: () => string[];
  /** Current content hash of a project-relative file, or null if missing. */
  hashFile: (relPath: string) => string | null;
}

/** Split a stored test id ("file > describe > name") into file and full name. */
export function parseTestId(testId: string): SelectedTest {
  const parts = testId.split(" > ");
  const file = parts[0] ?? testId;
  const name = parts.slice(1).join(" > ");
  return name ? { file, name } : { file };
}

/**
 * Answers "which tests cover these changed files?" by degrading through three
 * tiers — coverage (precise) → import graph (cold start) → heuristic (last resort)
 * — and failing open: stale or missing coverage widens to whole-file runs rather
 * than returning a falsely confident empty set.
 */
export class ImpactMap {
  constructor(private readonly deps: ImpactMapDeps) {}

  select(changed: ChangedFile[]): SelectionResult {
    const collected: SelectedTest[] = [];
    const unmapped: string[] = [];
    let bestTier: ImpactTier = "none";
    let lowConfidence = false;

    for (const { file, lines } of changed) {
      const outcome = this.selectForFile(file, lines ?? []);
      collected.push(...outcome.tests);
      if (outcome.tests.length === 0) unmapped.push(file);
      if (TIER_PRECISION[outcome.tier] > TIER_PRECISION[bestTier]) {
        bestTier = outcome.tier;
      }
      lowConfidence ||= outcome.lowConfidence;
    }

    return {
      tests: normalize(collected),
      tier: bestTier,
      lowConfidence,
      unmapped,
    };
  }

  private selectForFile(
    file: string,
    lines: number[],
  ): { tests: SelectedTest[]; tier: ImpactTier; lowConfidence: boolean } {
    const coverageIds = this.deps.store.getTestsForLines(file, lines);

    if (coverageIds.length > 0) {
      if (this.isStale(file)) {
        // Coverage exists but the file changed since it was recorded: trust the
        // set of files, not the exact tests. Widen to whole files + import graph.
        const wholeFromCoverage = uniqueFiles(coverageIds).map((f) => ({ file: f }));
        return {
          tests: [...wholeFromCoverage, ...this.importGraphTests(file)],
          tier: "coverage",
          lowConfidence: true,
        };
      }
      return {
        tests: coverageIds.map(parseTestId),
        tier: "coverage",
        lowConfidence: false,
      };
    }

    const graphTests = this.importGraphTests(file);
    if (graphTests.length > 0) {
      return { tests: graphTests, tier: "import-graph", lowConfidence: true };
    }

    const heuristicTests = this.heuristicTests(file);
    if (heuristicTests.length > 0) {
      return { tests: heuristicTests, tier: "heuristic", lowConfidence: true };
    }

    return { tests: [], tier: "none", lowConfidence: true };
  }

  private isStale(file: string): boolean {
    const stored = this.deps.store.getSourceHash(file);
    if (stored === undefined) return true;
    const current = this.deps.hashFile(file);
    return current !== null && current !== stored;
  }

  private importGraphTests(file: string): SelectedTest[] {
    const abs = path.join(this.deps.projectRoot, file);
    return this.deps
      .getImportGraph()
      .testsImporting(abs)
      .map((f) => ({ file: this.relativize(f) }));
  }

  private heuristicTests(file: string): SelectedTest[] {
    const abs = path.join(this.deps.projectRoot, file);
    return guessTests(abs, this.deps.getTestFiles()).map((f) => ({
      file: this.relativize(f),
    }));
  }

  private relativize(abs: string): string {
    return path.relative(this.deps.projectRoot, abs).split(path.sep).join("/");
  }
}

function uniqueFiles(testIds: string[]): string[] {
  return [...new Set(testIds.map((id) => parseTestId(id).file))];
}

/**
 * Collapse selected tests per file: if any whole-file run is requested for a file,
 * it supersedes the named selections (running the file runs them anyway). Sorted by
 * (file, name) for stable output.
 */
function normalize(tests: SelectedTest[]): SelectedTest[] {
  const byFile = new Map<string, { whole: boolean; names: Set<string> }>();
  for (const t of tests) {
    let entry = byFile.get(t.file);
    if (!entry) {
      entry = { whole: false, names: new Set<string>() };
      byFile.set(t.file, entry);
    }
    if (t.name === undefined) entry.whole = true;
    else entry.names.add(t.name);
  }

  const out: SelectedTest[] = [];
  for (const [file, entry] of byFile) {
    if (entry.whole) {
      out.push({ file });
    } else {
      for (const name of entry.names) out.push({ file, name });
    }
  }

  return out.sort((a, b) =>
    a.file === b.file ? (a.name ?? "").localeCompare(b.name ?? "") : a.file < b.file ? -1 : 1,
  );
}
