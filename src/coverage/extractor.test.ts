import { describe, expect, it } from "vitest";
import { foldCoverage, istanbulToFileLines } from "./extractor.js";

describe("istanbulToFileLines", () => {
  it("maps covered statements to their source lines", () => {
    const data = {
      "/proj/src/a.ts": {
        path: "/proj/src/a.ts",
        statementMap: {
          "0": { start: { line: 1 }, end: { line: 1 } },
          "1": { start: { line: 3 }, end: { line: 5 } },
          "2": { start: { line: 8 }, end: { line: 8 } },
        },
        s: { "0": 1, "1": 2, "2": 0 },
      },
    };

    expect(istanbulToFileLines(data)).toEqual({
      "/proj/src/a.ts": [1, 3, 4, 5],
    });
  });

  it("omits files with no covered statements", () => {
    const data = {
      "/proj/src/a.ts": {
        path: "/proj/src/a.ts",
        statementMap: { "0": { start: { line: 1 }, end: { line: 1 } } },
        s: { "0": 0 },
      },
    };

    expect(istanbulToFileLines(data)).toEqual({});
  });
});

describe("foldCoverage", () => {
  const opts = {
    projectRoot: "/proj",
    isTestFile: (p: string) => p.includes(".test."),
  };

  it("normalizes raw per-test records to project-relative coverage", () => {
    const jsonl = [
      JSON.stringify({ testId: "t1", files: { "/proj/src/a.ts": [1, 2] } }),
      JSON.stringify({ testId: "t2", files: { "/proj/src/b.ts": [5] } }),
    ].join("\n");

    expect(foldCoverage(jsonl, opts)).toEqual([
      {
        testId: "t1",
        entries: [
          { file: "src/a.ts", line: 1 },
          { file: "src/a.ts", line: 2 },
        ],
      },
      { testId: "t2", entries: [{ file: "src/b.ts", line: 5 }] },
    ]);
  });

  it("drops node_modules, out-of-root, and test files", () => {
    const jsonl = JSON.stringify({
      testId: "t1",
      files: {
        "/proj/src/a.ts": [1],
        "/proj/node_modules/x/index.js": [2],
        "/proj/src/a.test.ts": [3],
        "/other/c.ts": [4],
      },
    });

    expect(foldCoverage(jsonl, opts)).toEqual([
      { testId: "t1", entries: [{ file: "src/a.ts", line: 1 }] },
    ]);
  });

  it("merges and de-duplicates lines for a test seen across records", () => {
    const jsonl = [
      JSON.stringify({ testId: "t1", files: { "/proj/src/a.ts": [1, 2] } }),
      JSON.stringify({ testId: "t1", files: { "/proj/src/a.ts": [2, 3] } }),
    ].join("\n");

    expect(foldCoverage(jsonl, opts)).toEqual([
      {
        testId: "t1",
        entries: [
          { file: "src/a.ts", line: 1 },
          { file: "src/a.ts", line: 2 },
          { file: "src/a.ts", line: 3 },
        ],
      },
    ]);
  });

  it("ignores blank lines in the jsonl", () => {
    const jsonl =
      "\n" + JSON.stringify({ testId: "t1", files: { "/proj/src/a.ts": [1] } }) + "\n\n";

    expect(foldCoverage(jsonl, opts)).toEqual([
      { testId: "t1", entries: [{ file: "src/a.ts", line: 1 }] },
    ]);
  });
});
