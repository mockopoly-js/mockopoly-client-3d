import { describe, it, expect } from 'vitest';
import { formatMoney } from './format';

describe('formatMoney', () => {
  it('formats millions with three decimals', () => {
    expect(formatMoney(15_000_000)).toBe('£15.000M');
  });
  it('formats whole thousands without decimals', () => {
    expect(formatMoney(2_000)).toBe('£2K');
  });
  it('formats fractional thousands with one decimal', () => {
    expect(formatMoney(1_500)).toBe('£1.5K');
  });
  it('formats sub-thousands raw', () => {
    expect(formatMoney(500)).toBe('£500');
  });
  it('formats negatives with a leading minus', () => {
    expect(formatMoney(-1_200_000)).toBe('-£1.200M');
  });
});
