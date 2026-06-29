import { describe, expect, it } from "vitest";
import { ImportGraph, parseImportSpecifiers } from "./import-graph.js";

describe("parseImportSpecifiers", () => {
  it("extracts static, re-export, dynamic, and require specifiers", () => {
    const source = `
      import a from "./a";
      import { b } from "../b/c";
      export * from "./d";
      const e = require("./e");
      const f = await import("./f");
      import react from "react";
    `;
    expect(parseImportSpecifiers(source).sort()).toEqual([
      "../b/c",
      "./a",
      "./d",
      "./e",
      "./f",
      "react",
    ]);
  });

  it("returns nothing for a file with no imports", () => {
    expect(parseImportSpecifiers("export const x = 1;")).toEqual([]);
  });
});

describe("ImportGraph.testsImporting", () => {
  const files = {
    "/p/src/cart.ts": `import { applyDiscount } from "./pricing";`,
    "/p/src/pricing.ts": `export const x = 1;`,
    "/p/test/cart.test.ts": `import { total } from "../src/cart";`,
    "/p/test/pricing.test.ts": `import { applyDiscount } from "../src/pricing";`,
  };
  const isTestFile = (f: string) => f.includes(".test.");
  const graph = ImportGraph.build(files, isTestFile);

  it("finds tests that transitively import a changed module", () => {
    // pricing is imported by cart (→ cart.test) and directly by pricing.test.
    expect(graph.testsImporting("/p/src/pricing.ts")).toEqual([
      "/p/test/cart.test.ts",
      "/p/test/pricing.test.ts",
    ]);
  });

  it("finds only the directly-dependent test for a leaf-importer change", () => {
    expect(graph.testsImporting("/p/src/cart.ts")).toEqual(["/p/test/cart.test.ts"]);
  });

  it("returns the test itself when the changed file is a test", () => {
    expect(graph.testsImporting("/p/test/cart.test.ts")).toEqual([
      "/p/test/cart.test.ts",
    ]);
  });

  it("returns nothing for a file no test reaches", () => {
    const isolated = ImportGraph.build(
      { "/p/src/orphan.ts": `export const y = 2;`, "/p/test/cart.test.ts": `export {}` },
      isTestFile,
    );
    expect(isolated.testsImporting("/p/src/orphan.ts")).toEqual([]);
  });
});
