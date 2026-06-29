import { describe, expect, it } from "vitest";
import { guessTests } from "./heuristic.js";

describe("guessTests", () => {
  const testFiles = [
    "/p/src/cart.test.ts",
    "/p/test/cart.spec.ts",
    "/p/src/checkout.test.ts",
    "/p/src/dashboard.test.tsx",
  ];

  it("matches test files sharing the source file's stem", () => {
    expect(guessTests("/p/src/cart.ts", testFiles)).toEqual([
      "/p/src/cart.test.ts",
      "/p/test/cart.spec.ts",
    ]);
  });

  it("matches across extensions (tsx source → tsx test)", () => {
    expect(guessTests("/p/src/dashboard.tsx", testFiles)).toEqual([
      "/p/src/dashboard.test.tsx",
    ]);
  });

  it("returns nothing when no test shares the stem", () => {
    expect(guessTests("/p/src/payment.ts", testFiles)).toEqual([]);
  });

  it("returns the test itself when the changed file is a test", () => {
    expect(guessTests("/p/src/cart.test.ts", testFiles)).toEqual([
      "/p/src/cart.test.ts",
    ]);
  });
});
