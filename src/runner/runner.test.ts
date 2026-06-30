import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseVitestJson, VitestRunner } from "./runner.js";

describe("parseVitestJson", () => {
  it("flattens assertion results and surfaces failures with messages", () => {
    const sample = {
      success: false,
      numFailedTests: 1,
      testResults: [
        {
          name: "/p/test/cart.test.ts",
          assertionResults: [
            { fullName: "cart sums", status: "passed", failureMessages: [] },
            {
              fullName: "cart total",
              status: "failed",
              failureMessages: ["AssertionError: expected 90 to be 80"],
              location: { line: 12, column: 5 },
            },
          ],
        },
        {
          name: "/p/test/skip.test.ts",
          assertionResults: [
            { fullName: "skipped one", status: "skipped", failureMessages: [] },
          ],
        },
      ],
    };

    const parsed = parseVitestJson(sample);
    expect(parsed.passed).toBe(false);
    expect(parsed.results).toEqual([
      { file: "/p/test/cart.test.ts", name: "cart sums", status: "passed" },
      {
        file: "/p/test/cart.test.ts",
        name: "cart total",
        status: "failed",
        message: "AssertionError: expected 90 to be 80",
        line: 12,
      },
      { file: "/p/test/skip.test.ts", name: "skipped one", status: "skipped" },
    ]);
  });

  it("reports success when nothing failed", () => {
    const parsed = parseVitestJson({
      success: true,
      numFailedTests: 0,
      testResults: [
        {
          name: "/p/a.test.ts",
          assertionResults: [{ fullName: "a works", status: "passed", failureMessages: [] }],
        },
      ],
    });
    expect(parsed.passed).toBe(true);
    expect(parsed.results).toHaveLength(1);
  });
});

describe("VitestRunner.run error handling", () => {
  it("throws a clear error when vitest produces no report", () => {
    // `false` exits non-zero and writes nothing, simulating a vitest startup crash.
    const runner = new VitestRunner({ projectRoot: process.cwd(), vitestBin: "false" });
    expect(() => runner.run([])).toThrow(/did not produce a test report/i);
  });
});

describe("VitestRunner.run (integration)", () => {
  it("runs the given test files and parses real results", () => {
    const repoRoot = process.cwd();
    const fixtureDir = path.join(repoRoot, "fixtures/sample-app");
    const runner = new VitestRunner({
      projectRoot: repoRoot,
      vitestBin: path.join(repoRoot, "node_modules/.bin/vitest"),
      configPath: path.join(fixtureDir, "vitest.config.ts"),
    });

    const outcome = runner.run([
      path.join(fixtureDir, "test/cart.test.ts"),
      path.join(fixtureDir, "test/pricing.test.ts"),
    ]);

    expect(outcome.passed).toBe(true);
    expect(outcome.results).toHaveLength(4);
    expect(outcome.results.every((r) => r.status === "passed")).toBe(true);
    expect(outcome.durationMs).toBeGreaterThan(0);
  }, 60_000);
});
