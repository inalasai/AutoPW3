import type { Tariff, TariffDirection } from '@autopw3/shared';
import { resolveTariffRate } from './resolve';
import type { RateResult, TariffLookupOptions } from './types';

/** Helpers shared by the tariff tests. Not exported from the package. */

/** Epoch milliseconds of an ISO instant with an explicit zone; fails the test loudly on a typo. */
export function ms(iso: string): number {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) throw new Error(`bad test instant: ${iso}`);
  return value;
}

/** A copy of a tariff with some fields replaced. */
export function variant(base: Tariff, patch: Partial<Tariff>): Tariff {
  return { ...base, ...patch };
}

/** Resolve an ISO instant and return the rate string, or the problem code when there is no rate. */
export function rateOrCode(
  iso: string,
  tariffs: readonly Tariff[],
  direction: TariffDirection = 'IMPORT',
  options: TariffLookupOptions = {},
): string {
  const r: RateResult = resolveTariffRate(ms(iso), tariffs, direction, options);
  return r.ok ? r.ratePerKwh : r.code;
}
