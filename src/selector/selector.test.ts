import { describe, expect, it } from "vitest";
import type { SelectedTest } from "../types.js";
import { plan } from "./selector.js";

const tests: SelectedTest[] = [
  { file: "a.test.ts", name: "one" },
  { file: "b.test.ts", name: "two" },
  { file: "c.test.ts", name: "three" },
];

describe("plan", () => {
  it("selects everything when there is no budget", () => {
    const result = plan(tests);
    expect(result.selected).toEqual(tests);
    expect(result.skipped).toEqual([]);
  });

  it("caps by maximum test count, preserving order and reporting the rest", () => {
    const result = plan(tests, { maxTests: 2 });
    expect(result.selected).toEqual([tests[0], tests[1]]);
    expect(result.skipped).toEqual([tests[2]]);
  });

  it("caps by estimated seconds using the duration estimate", () => {
    const result = plan(tests, { maxSeconds: 1 }, () => 400);
    // 400 + 400 <= 1000, 1200 > 1000.
    expect(result.selected).toEqual([tests[0], tests[1]]);
    expect(result.skipped).toEqual([tests[2]]);
  });

  it("handles no candidates", () => {
    expect(plan([], { maxTests: 5 })).toEqual({ selected: [], skipped: [] });
  });
});
