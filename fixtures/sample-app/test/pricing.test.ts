import { describe, expect, it } from "vitest";
import { applyDiscount } from "../src/pricing.js";

describe("applyDiscount", () => {
  it("subtracts the percentage", () => {
    expect(applyDiscount(100, 10)).toBe(90);
  });

  it("throws on an invalid percentage", () => {
    expect(() => applyDiscount(100, 150)).toThrow();
  });
});
