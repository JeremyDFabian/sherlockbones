import { describe, expect, it } from "vitest";
import { Store } from "../store/store.js";
import { ImpactMap, parseTestId } from "./impact-map.js";
import { ImportGraph } from "./import-graph.js";

const isTestFile = (f: string) => f.includes(".test.");

interface SetupOptions {
  coverage?: Array<{ testId: string; file: string; line: number }>;
  hashes?: Record<string, string>; // stored hashes
  current?: Record<string, string>; // current on-disk hashes
  graphFiles?: Record<string, string>;
  testFiles?: string[];
}

function makeMap(opts: SetupOptions): ImpactMap {
  const store = new Store(":memory:");
  for (const c of opts.coverage ?? []) {
    store.setCoverageForTest(c.testId, [{ file: c.file, line: c.line }]);
  }
  for (const [file, hash] of Object.entries(opts.hashes ?? {})) {
    store.setSourceHash(file, hash, 0);
  }
  const graph = ImportGraph.build(opts.graphFiles ?? {}, isTestFile);
  return new ImpactMap({
    store,
    projectRoot: "/p",
    getImportGraph: () => graph,
    getTestFiles: () => opts.testFiles ?? [],
    hashFile: (rel) => opts.current?.[rel] ?? null,
  });
}

describe("parseTestId", () => {
  it("splits a test id into file and full name", () => {
    expect(parseTestId("test/cart.test.ts > cart > sums item prices")).toEqual({
      file: "test/cart.test.ts",
      name: "cart > sums item prices",
    });
  });
});

describe("ImpactMap.select", () => {
  it("uses fresh coverage for an exact line match", () => {
    const map = makeMap({
      coverage: [
        { testId: "test/cart.test.ts > cart > sums", file: "src/cart.ts", line: 12 },
      ],
      hashes: { "src/cart.ts": "h1" },
      current: { "src/cart.ts": "h1" },
    });

    const result = map.select([{ file: "src/cart.ts", lines: [12] }]);
    expect(result.tier).toBe("coverage");
    expect(result.lowConfidence).toBe(false);
    expect(result.tests).toEqual([{ file: "test/cart.test.ts", name: "cart > sums" }]);
    expect(result.unmapped).toEqual([]);
  });

  it("falls back to the import graph when there is no coverage", () => {
    const map = makeMap({
      graphFiles: {
        "/p/src/payment.ts": "export const x = 1;",
        "/p/test/payment.test.ts": `import "../src/payment";`,
      },
    });

    const result = map.select([{ file: "src/payment.ts" }]);
    expect(result.tier).toBe("import-graph");
    expect(result.lowConfidence).toBe(true);
    expect(result.tests).toEqual([{ file: "test/payment.test.ts" }]);
  });

  it("falls back to the heuristic when coverage and the import graph are empty", () => {
    const map = makeMap({ testFiles: ["/p/src/widget.test.ts"] });

    const result = map.select([{ file: "src/widget.ts" }]);
    expect(result.tier).toBe("heuristic");
    expect(result.lowConfidence).toBe(true);
    expect(result.tests).toEqual([{ file: "src/widget.test.ts" }]);
  });

  it("reports files it cannot map at any tier", () => {
    const map = makeMap({});
    const result = map.select([{ file: "src/ghost.ts" }]);
    expect(result.tier).toBe("none");
    expect(result.tests).toEqual([]);
    expect(result.unmapped).toEqual(["src/ghost.ts"]);
  });

  it("over-includes whole files when coverage is stale", () => {
    const map = makeMap({
      coverage: [
        { testId: "test/cart.test.ts > cart > sums", file: "src/cart.ts", line: 12 },
      ],
      hashes: { "src/cart.ts": "old" },
      current: { "src/cart.ts": "new" }, // changed on disk -> stale
      graphFiles: {
        "/p/src/cart.ts": "export const x = 1;",
        "/p/test/cart.test.ts": `import "../src/cart";`,
        "/p/test/extra.test.ts": `import "../src/cart";`,
      },
    });

    const result = map.select([{ file: "src/cart.ts", lines: [12] }]);
    expect(result.lowConfidence).toBe(true);
    // Stale coverage degrades to whole-file runs, unioned with the import graph.
    expect(result.tests).toEqual([
      { file: "test/cart.test.ts" },
      { file: "test/extra.test.ts" },
    ]);
  });

  it("unions tiers across files and reports the best tier used", () => {
    const map = makeMap({
      coverage: [
        { testId: "test/a.test.ts > a > works", file: "src/a.ts", line: 3 },
      ],
      hashes: { "src/a.ts": "h" },
      current: { "src/a.ts": "h" },
      testFiles: ["/p/src/b.test.ts"],
    });

    const result = map.select([{ file: "src/a.ts", lines: [3] }, { file: "src/b.ts" }]);
    expect(result.tier).toBe("coverage"); // best tier that produced results
    expect(result.lowConfidence).toBe(true); // a fallback was also used
    expect(result.tests).toEqual([
      { file: "src/b.test.ts" },
      { file: "test/a.test.ts", name: "a > works" },
    ]);
  });
});
