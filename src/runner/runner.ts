import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type TestStatus = "passed" | "failed" | "skipped";

export interface TestResult {
  file: string;
  name: string;
  status: TestStatus;
  message?: string;
  line?: number;
}

export interface ParsedRun {
  results: TestResult[];
  passed: boolean;
}

export interface RunOutcome extends ParsedRun {
  durationMs: number;
}

// Minimal shape of Vitest's JSON reporter output that we consume.
interface VitestJson {
  success?: boolean;
  numFailedTests?: number;
  testResults: Array<{
    name: string;
    assertionResults: Array<{
      fullName: string;
      status: string;
      failureMessages?: string[];
      location?: { line: number; column?: number };
    }>;
  }>;
}

function mapStatus(status: string): TestStatus {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  return "skipped";
}

/** Parse Vitest's JSON reporter output into flat, structured results. */
export function parseVitestJson(raw: string | VitestJson): ParsedRun {
  const json: VitestJson = typeof raw === "string" ? JSON.parse(raw) : raw;

  const results: TestResult[] = [];
  for (const file of json.testResults) {
    for (const assertion of file.assertionResults) {
      const result: TestResult = {
        file: file.name,
        name: assertion.fullName,
        status: mapStatus(assertion.status),
      };
      const message = assertion.failureMessages?.[0];
      if (message) result.message = message;
      if (assertion.location) result.line = assertion.location.line;
      results.push(result);
    }
  }

  const passed =
    json.success ?? results.every((r) => r.status !== "failed");
  return { results, passed };
}

export interface VitestRunnerOptions {
  projectRoot: string;
  vitestBin?: string;
  configPath?: string;
  /** When set, exported as BONES_COVERAGE_OUT so the run also captures coverage. */
  coverageOut?: string;
}

/**
 * Shells out to Vitest to run a set of test files and parses the results. v1 runs
 * whole files (recall-safe); per-test `-t` filtering is a future optimization.
 */
export class VitestRunner {
  constructor(private readonly options: VitestRunnerOptions) {}

  run(testFiles: string[]): RunOutcome {
    const outFile = path.join(mkdtempSync(path.join(tmpdir(), "bones-run-")), "out.json");
    const bin = this.options.vitestBin ?? "vitest";

    const args = ["run", ...testFiles, "--reporter=json", `--outputFile=${outFile}`];
    if (this.options.configPath) args.push("--config", this.options.configPath);

    const env = { ...process.env };
    if (this.options.coverageOut) env["BONES_COVERAGE_OUT"] = this.options.coverageOut;

    const start = Date.now();
    try {
      execFileSync(bin, args, { cwd: this.options.projectRoot, env, stdio: "ignore" });
    } catch {
      // Vitest exits non-zero when tests fail; the JSON report is still written.
    }
    const durationMs = Date.now() - start;

    if (!existsSync(outFile)) {
      // Vitest exited before writing the report — usually a startup failure such
      // as a missing @vitest/coverage-istanbul or an invalid config.
      throw new Error(
        `vitest did not produce a test report. It likely failed to start — ` +
          `check that the config is valid and @vitest/coverage-istanbul is installed.`,
      );
    }

    const parsed = parseVitestJson(readFileSync(outFile, "utf8"));
    return { ...parsed, durationMs };
  }
}
