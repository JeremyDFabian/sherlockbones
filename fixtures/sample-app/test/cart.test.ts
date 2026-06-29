import { describe, expect, it } from "vitest";
import { subtotal, total } from "../src/cart.js";

describe("cart", () => {
  it("sums item prices", () => {
    expect(subtotal([{ name: "a", price: 5, qty: 2 }])).toBe(10);
  });

  it("applies a discount to the total", () => {
    expect(total([{ name: "a", price: 100, qty: 1 }], 10)).toBe(90);
  });
});
