import { applyDiscount } from "./pricing.js";

export interface Item {
  name: string;
  price: number;
  qty: number;
}

export function subtotal(items: Item[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return sum;
}

export function total(items: Item[], discountPct: number): number {
  return applyDiscount(subtotal(items), discountPct);
}
