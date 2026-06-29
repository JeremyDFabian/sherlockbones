export function applyDiscount(amount: number, pct: number): number {
  if (pct < 0 || pct > 100) {
    throw new Error("invalid percentage");
  }
  return amount - (amount * pct) / 100;
}
