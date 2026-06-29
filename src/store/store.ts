import { DatabaseSync } from "node:sqlite";

export interface CoverageEntry {
  file: string;
  line: number;
}

export interface TestRecord {
  testId: string;
  runner: string;
  path: string;
}

export interface StoredTest extends TestRecord {
  lastSeen: number;
}

export interface RunInput {
  ts: number;
  changedFiles: string[];
  selectedTests: string[];
  passed: boolean;
  durationMs: number;
  suiteSize: number;
}

export interface StoredRun extends RunInput {
  id: number;
}

export interface MetricsRecord {
  runId: number;
  recallEst: number | null;
  reduction: number;
  selectedCount: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tests (
    test_id   TEXT PRIMARY KEY,
    runner    TEXT NOT NULL,
    path      TEXT NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coverage (
    file    TEXT NOT NULL,
    line    INTEGER NOT NULL,
    test_id TEXT NOT NULL,
    PRIMARY KEY (file, line, test_id)
  );
  CREATE INDEX IF NOT EXISTS coverage_by_file ON coverage (file);
  CREATE TABLE IF NOT EXISTS runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts             INTEGER NOT NULL,
    changed_files  TEXT NOT NULL,
    selected_tests TEXT NOT NULL,
    passed         INTEGER NOT NULL,
    duration_ms    INTEGER NOT NULL,
    suite_size     INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS metrics (
    run_id         INTEGER NOT NULL,
    recall_est     REAL,
    reduction      REAL NOT NULL,
    selected_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS source_hashes (
    file       TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    indexed_at INTEGER NOT NULL
  );
`;

/**
 * SQLite-backed index store. Owns the on-disk schema and is the only module that
 * speaks SQL. Pass `:memory:` for an ephemeral database (used in tests).
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** Replace all coverage rows for a test with the freshly observed entries. */
  setCoverageForTest(testId: string, entries: CoverageEntry[]): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM coverage WHERE test_id = ?").run(testId);
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO coverage (file, line, test_id) VALUES (?, ?, ?)",
      );
      for (const entry of entries) {
        insert.run(entry.file, entry.line, testId);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Tests covering the given lines of a file. When `lines` is empty, returns every
   * test touching the file (whole-file fallback). Results are sorted for stability.
   */
  getTestsForLines(file: string, lines: number[]): string[] {
    if (lines.length === 0) {
      const rows = this.db
        .prepare(
          "SELECT DISTINCT test_id FROM coverage WHERE file = ? ORDER BY test_id",
        )
        .all(file) as Array<{ test_id: string }>;
      return rows.map((r) => r.test_id);
    }

    const placeholders = lines.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT DISTINCT test_id FROM coverage
         WHERE file = ? AND line IN (${placeholders})
         ORDER BY test_id`,
      )
      .all(file, ...lines) as Array<{ test_id: string }>;
    return rows.map((r) => r.test_id);
  }

  getSourceHash(file: string): string | undefined {
    const row = this.db
      .prepare("SELECT hash FROM source_hashes WHERE file = ?")
      .get(file) as { hash: string } | undefined;
    return row?.hash;
  }

  setSourceHash(file: string, hash: string, indexedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO source_hashes (file, hash, indexed_at) VALUES (?, ?, ?)
         ON CONFLICT (file) DO UPDATE SET hash = excluded.hash, indexed_at = excluded.indexed_at`,
      )
      .run(file, hash, indexedAt);
  }

  logRun(run: RunInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO runs (ts, changed_files, selected_tests, passed, duration_ms, suite_size)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.ts,
        JSON.stringify(run.changedFiles),
        JSON.stringify(run.selectedTests),
        run.passed ? 1 : 0,
        run.durationMs,
        run.suiteSize,
      );
    return Number(result.lastInsertRowid);
  }

  getRecentRuns(limit: number): StoredRun[] {
    const rows = this.db
      .prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?")
      .all(limit) as Array<{
      id: number;
      ts: number;
      changed_files: string;
      selected_tests: string;
      passed: number;
      duration_ms: number;
      suite_size: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      changedFiles: JSON.parse(r.changed_files) as string[],
      selectedTests: JSON.parse(r.selected_tests) as string[],
      passed: r.passed === 1,
      durationMs: r.duration_ms,
      suiteSize: r.suite_size,
    }));
  }

  recordMetrics(m: MetricsRecord): void {
    this.db
      .prepare(
        `INSERT INTO metrics (run_id, recall_est, reduction, selected_count)
         VALUES (?, ?, ?, ?)`,
      )
      .run(m.runId, m.recallEst, m.reduction, m.selectedCount);
  }

  getRecentMetrics(limit: number): MetricsRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM metrics ORDER BY run_id DESC LIMIT ?")
      .all(limit) as Array<{
      run_id: number;
      recall_est: number | null;
      reduction: number;
      selected_count: number;
    }>;
    return rows.map((r) => ({
      runId: r.run_id,
      recallEst: r.recall_est,
      reduction: r.reduction,
      selectedCount: r.selected_count,
    }));
  }

  registerTest(test: TestRecord, lastSeen: number): void {
    this.db
      .prepare(
        `INSERT INTO tests (test_id, runner, path, last_seen) VALUES (?, ?, ?, ?)
         ON CONFLICT (test_id) DO UPDATE SET
           runner = excluded.runner, path = excluded.path, last_seen = excluded.last_seen`,
      )
      .run(test.testId, test.runner, test.path, lastSeen);
  }

  getTest(testId: string): StoredTest | undefined {
    const row = this.db
      .prepare("SELECT * FROM tests WHERE test_id = ?")
      .get(testId) as
      | { test_id: string; runner: string; path: string; last_seen: number }
      | undefined;
    if (!row) return undefined;
    return {
      testId: row.test_id,
      runner: row.runner,
      path: row.path,
      lastSeen: row.last_seen,
    };
  }
}
