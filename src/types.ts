/** A single covered source location: a file and a 1-based line number. */
export interface CoverageEntry {
  file: string;
  line: number;
}

/** The set of source locations a single test exercised. */
export interface CoverageRecord {
  testId: string;
  entries: CoverageEntry[];
}

/**
 * A test to run. `name` (a test's full name) selects a single test from coverage;
 * when absent, the whole `file` runs — the fallback tiers work at file granularity.
 */
export interface SelectedTest {
  file: string;
  name?: string;
}
