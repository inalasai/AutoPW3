import type { Tariff, TariffDirection } from '@autopw3/shared';
import { addLocalDays } from '../telemetry/timestamps';
import { Decimal, decimalFrom, exact } from './money';
import { selectVersion } from './select';
import type { RateProblemCode, TariffLookupOptions } from './types';

/**
 * Charges and tax (ENERGY_ACCOUNTING section 6, D-070). Every amount here is an exact decimal: nothing is
 * rounded until a caller calls `roundToMinorUnit` on a line it displays. Division (the VAT inside an inclusive
 * price) carries 28 significant digits.
 *
 * Tax modes, applied to the taxable amount (energy or standing charge, plus levies flagged taxable):
 * - `EXCLUSIVE`: stated amounts have no VAT; `vat = taxable * rate / 100` is added on top.
 * - `INCLUSIVE`: stated amounts already contain VAT; `vat = taxable - taxable / (1 + rate / 100)` is the part inside.
 * - `NONE`: no VAT. A levy not flagged taxable is outside VAT in every mode.
 */

/** Decimal form of an amount breakdown, used while adding up. */
export interface DecimalBreakdown {
  readonly baseAmount: Decimal;
  readonly levyAmount: Decimal;
  readonly vatAmount: Decimal;
  readonly totalAmount: Decimal;
}

/** The same, serialised: exact decimal strings in the tariff currency. */
export interface AmountBreakdown {
  /** Energy (rate times kWh, or an export credit) or the standing charge, as the tariff states it. */
  readonly baseAmount: string;
  /** All levies, as stated. */
  readonly levyAmount: string;
  /** VAT: added on top under `EXCLUSIVE`, contained in the stated amounts under `INCLUSIVE`, zero under `NONE`. */
  readonly vatAmount: string;
  /** What is payable (or, for an export tariff, receivable) including VAT. */
  readonly totalAmount: string;
  /** `totalAmount - vatAmount`. */
  readonly amountExcludingVat: string;
}

export interface LevyLine {
  readonly name: string;
  readonly amount: string;
  readonly taxable: boolean;
}

export const ZERO_BREAKDOWN: DecimalBreakdown = {
  baseAmount: new Decimal(0),
  levyAmount: new Decimal(0),
  vatAmount: new Decimal(0),
  totalAmount: new Decimal(0),
};

export function addBreakdowns(a: DecimalBreakdown, b: DecimalBreakdown): DecimalBreakdown {
  return {
    baseAmount: a.baseAmount.plus(b.baseAmount),
    levyAmount: a.levyAmount.plus(b.levyAmount),
    vatAmount: a.vatAmount.plus(b.vatAmount),
    totalAmount: a.totalAmount.plus(b.totalAmount),
  };
}

export function serialiseBreakdown(b: DecimalBreakdown): AmountBreakdown {
  return {
    baseAmount: exact(b.baseAmount),
    levyAmount: exact(b.levyAmount),
    vatAmount: exact(b.vatAmount),
    totalAmount: exact(b.totalAmount),
    amountExcludingVat: exact(b.totalAmount.minus(b.vatAmount)),
  };
}

interface AppliedLevy {
  readonly name: string;
  readonly amount: Decimal;
  readonly taxable: boolean;
}

/** Combine a base amount and levies under the tariff's tax mode. Throws `RangeError` if a taxed tariff has no VAT rate. */
function combine(
  base: Decimal,
  levies: readonly AppliedLevy[],
  tariff: Pick<Tariff, 'taxMode' | 'vatRatePercent'>,
): DecimalBreakdown {
  const levyAmount = levies.reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
  const taxableLevies = levies
    .filter((l) => l.taxable)
    .reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
  const taxable = base.plus(taxableLevies);

  let vat = new Decimal(0);
  if (tariff.taxMode !== 'NONE') {
    if (tariff.vatRatePercent === null) {
      throw new RangeError('a taxed tariff needs vatRatePercent; parse it with TariffSchema first');
    }
    const rate = decimalFrom(tariff.vatRatePercent).div(100);
    vat =
      tariff.taxMode === 'EXCLUSIVE'
        ? taxable.times(rate)
        : taxable.minus(taxable.div(rate.plus(1)));
  }
  const totalAmount =
    tariff.taxMode === 'EXCLUSIVE' ? base.plus(levyAmount).plus(vat) : base.plus(levyAmount);
  return { baseAmount: base, levyAmount, vatAmount: vat, totalAmount };
}

export interface EnergyCharge {
  readonly breakdown: DecimalBreakdown;
  readonly levyLines: readonly LevyLine[];
  /** For an export tariff, its payment model; `null` for imports. */
  readonly exportPaymentModel: 'PER_KWH' | 'NONE' | null;
}

/**
 * The charge for energy of `kwh` at `rate` under one tariff version.
 * - IMPORT: `kwh * rate`, plus each `PER_KWH` levy as `kwh * amount`.
 * - EXPORT: `kwh * rate` when the payment model is `PER_KWH`; an explicit `NONE` pays exactly zero. Levies do not
 *   apply to exports (`validateTariff` reports them with `LEVY_ON_EXPORT`).
 * The rate may be negative (a dynamic price); the arithmetic does not care.
 */
export function energyCharge(
  tariff: Tariff,
  direction: TariffDirection,
  kwh: Decimal,
  rate: Decimal,
): EnergyCharge {
  if (direction === 'EXPORT') {
    if (tariff.exportPaymentModel === null) {
      throw new RangeError(
        'an EXPORT tariff needs exportPaymentModel; parse it with TariffSchema first',
      );
    }
    const base = tariff.exportPaymentModel === 'PER_KWH' ? kwh.times(rate) : new Decimal(0);
    return {
      breakdown: combine(base, [], tariff),
      levyLines: [],
      exportPaymentModel: tariff.exportPaymentModel,
    };
  }
  const applied: AppliedLevy[] = tariff.levies
    .filter((l) => l.kind === 'PER_KWH')
    .map((l) => ({ name: l.name, amount: kwh.times(decimalFrom(l.amount)), taxable: l.taxable }));
  return {
    breakdown: combine(kwh.times(rate), applied, tariff),
    levyLines: applied.map((l) => ({ name: l.name, amount: exact(l.amount), taxable: l.taxable })),
    exportPaymentModel: null,
  };
}

/** The charges for one local day: the standing charge and the `PER_DAY` levies of the version in force. */
export interface DayCharge {
  readonly localDate: string;
  readonly tariffId: string;
  /** `standingChargePerDay` of the version in force; a tariff that states none has no standing charge. */
  readonly standingChargeAmount: string;
  readonly levyLines: readonly LevyLine[];
  readonly amounts: AmountBreakdown;
}

export interface DayChargeProblem {
  readonly localDate: string;
  readonly code: Extract<RateProblemCode, 'NO_TARIFF_FOR_DATE' | 'AMBIGUOUS_TARIFF'>;
}

export type DayChargesResult =
  | {
      readonly ok: true;
      readonly currency: string | null;
      readonly days: readonly DayCharge[];
      readonly totals: AmountBreakdown;
    }
  | { readonly ok: false; readonly problems: readonly DayChargeProblem[] };

/** Longest span of local days accepted (the API's daily maximum, API_CONTRACT section 1). */
export const MAX_CHARGE_DAYS = 1100;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Standing charge and per-day levies for the local dates `[fromDate, toDate)`, using the IMPORT version in force
 * on each date. Each local date is charged once, so a 23-hour or 25-hour day costs the same as any other.
 * Whether a partly covered day is charged is a decision for the caller (the accounting engine); this function
 * only counts whole local dates. A date with no version, or an ambiguous one, makes the whole result a list of
 * problems: it is never charged as zero.
 */
export function chargesForLocalDates(
  fromDate: string,
  toDate: string,
  tariffs: readonly Tariff[],
  options: Pick<TariffLookupOptions, 'siteId'> = {},
): DayChargesResult {
  if (!LOCAL_DATE.test(fromDate) || !LOCAL_DATE.test(toDate)) {
    throw new RangeError('dates must be YYYY-MM-DD');
  }
  if (toDate <= fromDate) throw new RangeError('toDate must be after fromDate');

  const days: DayCharge[] = [];
  const problems: DayChargeProblem[] = [];
  let currency: string | null = null;
  let total = ZERO_BREAKDOWN;
  let count = 0;

  for (let date = fromDate; date < toDate; date = addLocalDays(date, 1)) {
    count += 1;
    if (count > MAX_CHARGE_DAYS) throw new RangeError(`more than ${MAX_CHARGE_DAYS} days`);
    const selection = selectVersion(tariffs, 'IMPORT', options.siteId ?? null, () => date);
    if (selection.kind === 'NONE') {
      problems.push({ localDate: date, code: 'NO_TARIFF_FOR_DATE' });
      continue;
    }
    if (selection.kind === 'AMBIGUOUS') {
      problems.push({ localDate: date, code: 'AMBIGUOUS_TARIFF' });
      continue;
    }
    const tariff = selection.tariff;
    if (currency !== null && currency !== tariff.currency) {
      throw new RangeError('the versions use different currencies; validateTariffSet rejects this');
    }
    currency = tariff.currency;

    const standing =
      tariff.standingChargePerDay === null
        ? new Decimal(0)
        : decimalFrom(tariff.standingChargePerDay);
    const applied: AppliedLevy[] = tariff.levies
      .filter((l) => l.kind === 'PER_DAY')
      .map((l) => ({ name: l.name, amount: decimalFrom(l.amount), taxable: l.taxable }));
    const breakdown = combine(standing, applied, tariff);
    total = addBreakdowns(total, breakdown);
    days.push({
      localDate: date,
      tariffId: tariff.id,
      standingChargeAmount: exact(standing),
      levyLines: applied.map((l) => ({
        name: l.name,
        amount: exact(l.amount),
        taxable: l.taxable,
      })),
      amounts: serialiseBreakdown(breakdown),
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, currency, days, totals: serialiseBreakdown(total) };
}
