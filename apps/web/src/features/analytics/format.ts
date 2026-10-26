import { Decimal, serialiseDecimal } from '@autopw3/shared';

/**
 * Formats a number or Decimal to an exact decimal string with specified scale
 * without using toFixed, complying with D-014 and the float-money ESLint guard.
 */
export function formatDec(value: number | Decimal, scale: number): string {
  const dec = value instanceof Decimal ? value : new Decimal(String(value));
  return serialiseDecimal(dec, scale);
}

/**
 * Rounds and converts a Decimal to a JavaScript number for charting libraries (Recharts).
 */
export function toChartNumber(value: number | Decimal, scale: number): number {
  return Number(formatDec(value, scale));
}
