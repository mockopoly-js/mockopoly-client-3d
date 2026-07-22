/** Format money with K/M suffixes: 1500 → £1.5K, 15000000 → £15.000M */
export function formatMoney(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}£${m.toFixed(3)}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    // Show decimal only if not whole
    const formatted = k % 1 === 0 ? k.toFixed(0) : k.toFixed(1);
    return `${sign}£${formatted}K`;
  }
  return `${sign}£${abs}`;
}
