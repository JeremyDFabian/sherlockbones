import { describe, expect, it } from "vitest";
import { formatAgent, formatHuman, type RunSummary } from "./formatter.js";

const failing: RunSummary = {
  results: [
    { file: "test/cart.test.ts", name: "cart sums", status: "passed" },
    {
      file: "test/cart.test.ts",
      name: "cart total",
      status: "failed",
      message: "AssertionError: expected 90 to be 80\n    at cart.test.ts:12:5",
      line: 12,
    },
  ],
  passed: false,
  durationMs: 1200,
  tier: "coverage",
  lowConfidence: false,
  selectedCount: 2,
  skippedCount: 0,
  unmapped: [],
};

const passing: RunSummary = {
  results: [
    { file: "test/cart.test.ts", name: "cart sums", status: "passed" },
    { file: "test/cart.test.ts", name: "cart total", status: "passed" },
  ],
  passed: true,
  durationMs: 800,
  tier: "coverage",
  lowConfidence: false,
  selectedCount: 2,
  skippedCount: 0,
  unmapped: [],
};

describe("formatAgent", () => {
  it("stays quiet on success", () => {
    expect(formatAgent(passing)).toBe("");
  });

  it("reports failures compactly with file:line and the first message line", () => {
    const out = formatAgent(failing);
    expect(out).toContain("1 failed");
    expect(out).toContain("FAIL test/cart.test.ts:12 cart total");
    expect(out).toContain("AssertionError: expected 90 to be 80");
    // Only the first line of the message — no stack noise.
    expect(out).not.toContain("at cart.test.ts:12:5");
  });

  it("flags low-confidence selection and skipped tests", () => {
    const out = formatAgent({
      ...failing,
      lowConfidence: true,
      tier: "import-graph",
      skippedCount: 3,
    });
    expect(out).toContain("low confidence");
    expect(out).toContain("skipped 3");
  });
});

describe("formatHuman", () => {
  it("summarizes a passing run", () => {
    const out = formatHuman(passing);
    expect(out).toContain("2 passed");
    expect(out).toContain("coverage");
  });

  it("lists failures", () => {
    const out = formatHuman(failing);
    expect(out).toContain("cart total");
    expect(out).toContain("AssertionError: expected 90 to be 80");
  });
});
