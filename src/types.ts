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
