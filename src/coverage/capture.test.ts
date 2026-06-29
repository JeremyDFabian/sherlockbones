import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { foldCoverage } from "./extractor.js";

// End-to-end proof of the moat: run the real per-test capture against the sample
// fixture and assert that each test is attributed exactly the source it exercised.
describe("per-test coverage capture", () => {
  it("attributes source files to the tests that exercise them", () => {
    const repoRoot = process.cwd();
    const fixtureDir = path.join(repoRoot, "fixtures/sample-app");
    const config = path.join(fixtureDir, "vitest.config.ts");
    const vitestBin = path.join(repoRoot, "node_modules/.bin/vitest");
    const out = path.join(mkdtempSync(path.join(tmpdir(), "bones-")), "cov.jsonl");

    execFileSync(vitestBin, ["run", "--config", config], {
      cwd: repoRoot,
      env: { ...process.env, BONES_COVERAGE_OUT: out },
      stdio: "ignore",
    });

    const records = foldCoverage(readFileSync(out, "utf8"), {
      projectRoot: fixtureDir,
      isTestFile: (p) => p.includes(".test."),
    });

    const filesFor = (needle: string): string[] => {
      const record = records.find((r) => r.testId.includes(needle));
      expect(record, `no record matching "${needle}"`).toBeDefined();
      return [...new Set(record!.entries.map((e) => e.file))].sort();
    };

    // A test that only touches the cart must not pull in pricing.
    expect(filesFor("sums item prices")).toEqual(["src/cart.ts"]);
    // A test that only touches pricing must not pull in the cart.
    expect(filesFor("subtracts the percentage")).toEqual(["src/pricing.ts"]);
    // The discount path runs through both modules.
    expect(filesFor("applies a discount")).toEqual(["src/cart.ts", "src/pricing.ts"]);

    // Line-level precision in *original* coordinates: subtotal's body lives on
    // lines 10-14, so its test must cover line 12 and must not claim the interface
    // declaration on line 4 (which only exists pre-transpile).
    const subtotalLines = records
      .find((r) => r.testId.includes("sums item prices"))!
      .entries.filter((e) => e.file === "src/cart.ts")
      .map((e) => e.line);
    expect(subtotalLines).toContain(12);
    expect(subtotalLines).not.toContain(4);
  }, 60_000);
});
