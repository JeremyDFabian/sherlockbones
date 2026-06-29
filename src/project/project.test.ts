import path from "node:path";
import { describe, expect, it } from "vitest";
import { findSourceFiles, hashContent, isTestFile, parseDiffHunks } from "./project.js";

describe("isTestFile", () => {
  it("recognizes .test and .spec files", () => {
    expect(isTestFile("src/cart.test.ts")).toBe(true);
    expect(isTestFile("src/cart.spec.tsx")).toBe(true);
    expect(isTestFile("src/cart.ts")).toBe(false);
  });
});

describe("hashContent", () => {
  it("is deterministic and content-sensitive", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
});

describe("findSourceFiles", () => {
  it("collects ts/tsx files and skips node_modules", () => {
    const fixture = path.join(process.cwd(), "fixtures/sample-app");
    const files = findSourceFiles(fixture);
    const rel = files.map((f) => path.relative(fixture, f)).sort();
    expect(rel).toContain("src/cart.ts");
    expect(rel).toContain("src/pricing.ts");
    expect(rel).toContain("test/cart.test.ts");
    expect(rel.some((f) => f.includes("node_modules"))).toBe(false);
  });
});

describe("parseDiffHunks", () => {
  it("extracts added/modified line numbers from a unified diff", () => {
    const diff = [
      "diff --git a/src/cart.ts b/src/cart.ts",
      "--- a/src/cart.ts",
      "+++ b/src/cart.ts",
      "@@ -10,2 +10,3 @@ export function subtotal()",
      "-  old",
      "+  new1",
      "+  new2",
      "+  new3",
      "@@ -20 +21 @@",
      "-x",
      "+y",
    ].join("\n");

    expect(parseDiffHunks(diff)).toEqual([10, 11, 12, 21]);
  });

  it("includes the anchor line for a pure deletion", () => {
    const diff = ["@@ -5,2 +5,0 @@", "-gone1", "-gone2"].join("\n");
    expect(parseDiffHunks(diff)).toEqual([5]);
  });
});
