import { describe, expect, it } from 'vitest';
import {
  CreateTariffRequestSchema,
  EndTariffRequestSchema,
  PricePointSchema,
  PutPricePointsRequestSchema,
  TariffLevySchema,
  TariffSeasonSchema,
  TariffSlotSchema,
  ValidateTariffResponseSchema,
} from './tariffs';

// ILLUSTRATIVE EXAMPLE values only (not a real Irish tariff).
const flatImport = {
  name: 'Flat import (example)',
  direction: 'IMPORT',
  priceMode: 'FLAT',
  currency: 'EUR',
  timezone: 'Europe/Dublin',
  effectiveFrom: '2026-01-01',
  taxMode: 'EXCLUSIVE',
  vatRatePercent: '23.0000',
  flatRatePerKwh: '0.300000',
  standingChargePerDay: '0.600000',
};

const touImport = {
  ...flatImport,
  name: 'Day/night (example)',
  priceMode: 'TIME_OF_USE',
  flatRatePerKwh: null,
  slots: [
    { startMinute: 0, endMinute: 480, ratePerKwh: '0.150000', label: 'Night' },
    { startMinute: 480, endMinute: 1440, ratePerKwh: '0.350000', label: 'Day' },
  ],
};

describe('CreateTariffRequestSchema', () => {
  it('accepts a flat import tariff and applies defaults', () => {
    const t = CreateTariffRequestSchema.parse(flatImport);
    expect(t.siteId).toBeNull();
    expect(t.effectiveTo).toBeNull();
    expect(t.slots).toEqual([]);
    expect(t.exportPaymentModel).toBeNull();
  });

  it('accepts a time-of-use tariff with two slots', () => {
    expect(CreateTariffRequestSchema.safeParse(touImport).success).toBe(true);
  });

  it('rejects a rate sent as a number (money must be a string)', () => {
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, flatRatePerKwh: 0.3 }).success,
    ).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({
        ...touImport,
        slots: [{ startMinute: 0, endMinute: 1440, ratePerKwh: 0.15 }],
      }).success,
    ).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, standingChargePerDay: 0.6 }).success,
    ).toBe(false);
  });

  it('rejects a negative rate and a rate with more than 6 decimals', () => {
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, flatRatePerKwh: '-0.1' }).success,
    ).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, flatRatePerKwh: '0.1234567' }).success,
    ).toBe(false);
  });

  it('rejects a slot with a negative or zero window length', () => {
    for (const slot of [
      { startMinute: 600, endMinute: 480, ratePerKwh: '0.1' },
      { startMinute: 480, endMinute: 480, ratePerKwh: '0.1' },
    ]) {
      expect(CreateTariffRequestSchema.safeParse({ ...touImport, slots: [slot] }).success).toBe(
        false,
      );
    }
  });

  it('keeps a missing rate an error: FLAT needs a rate, others must not carry one', () => {
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, flatRatePerKwh: null }).success,
    ).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({ ...touImport, flatRatePerKwh: '0.2' }).success,
    ).toBe(false);
  });

  it('needs at least one slot for time-of-use and none for flat', () => {
    expect(CreateTariffRequestSchema.safeParse({ ...touImport, slots: [] }).success).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, slots: touImport.slots }).success,
    ).toBe(false);
  });

  it('couples tax mode and VAT percent', () => {
    expect(CreateTariffRequestSchema.safeParse({ ...flatImport, taxMode: 'NONE' }).success).toBe(
      false,
    );
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, vatRatePercent: null }).success,
    ).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, taxMode: 'NONE', vatRatePercent: null })
        .success,
    ).toBe(true);
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, vatRatePercent: '123' }).success,
    ).toBe(false);
    // 0.23 is the fraction form; as a percent string it would silently mean 0.23 percent, so the field name carries the unit.
    expect(CreateTariffRequestSchema.safeParse({ ...flatImport, vatRate: '0.2300' }).success).toBe(
      false,
    );
  });

  it('keeps direction-specific fields apart', () => {
    const exportTariff = {
      ...flatImport,
      direction: 'EXPORT',
      standingChargePerDay: null,
      exportPaymentModel: 'PER_KWH',
      taxMode: 'NONE',
      vatRatePercent: null,
    };
    expect(CreateTariffRequestSchema.safeParse(exportTariff).success).toBe(true);
    expect(
      CreateTariffRequestSchema.safeParse({ ...exportTariff, exportPaymentModel: null }).success,
    ).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({ ...exportTariff, standingChargePerDay: '0.5' }).success,
    ).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, exportPaymentModel: 'NONE' }).success,
    ).toBe(false);
  });

  it('validates currency, timezone and effective dates', () => {
    expect(CreateTariffRequestSchema.safeParse({ ...flatImport, currency: 'eur' }).success).toBe(
      false,
    );
    expect(CreateTariffRequestSchema.safeParse({ ...flatImport, currency: 'EURO' }).success).toBe(
      false,
    );
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, timezone: 'Europe/Dubln' }).success,
    ).toBe(false);
    expect(CreateTariffRequestSchema.safeParse({ ...flatImport, timezone: '+00:00' }).success).toBe(
      false,
    );
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, effectiveFrom: '2026-13-01' }).success,
    ).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, effectiveTo: '2026-01-01' }).success,
    ).toBe(false);
    expect(
      CreateTariffRequestSchema.safeParse({ ...flatImport, effectiveTo: '2027-01-01' }).success,
    ).toBe(true);
  });

  it('accepts a new version of an existing tariff via tariffKey and rejects a bad key', () => {
    const key = '3f8b1c2e-9a4d-4e7b-8c11-6d5f0a2b7e90';
    expect(CreateTariffRequestSchema.safeParse({ ...flatImport, tariffKey: key }).success).toBe(
      true,
    );
    expect(CreateTariffRequestSchema.safeParse({ ...flatImport, tariffKey: 'abc' }).success).toBe(
      false,
    );
  });

  it('rejects unknown fields instead of ignoring them', () => {
    expect(CreateTariffRequestSchema.safeParse({ ...flatImport, role: 'ADMIN' }).success).toBe(
      false,
    );
  });
});

describe('seasons, overrides, levies, price points', () => {
  const season = {
    name: 'Winter',
    startMonth: 11,
    startDay: 1,
    endMonth: 2,
    endDay: 28,
    slots: [],
  };

  it('accepts a season that wraps the year end', () => {
    expect(TariffSeasonSchema.safeParse(season).success).toBe(true);
  });

  it('rejects an impossible month/day', () => {
    expect(TariffSeasonSchema.safeParse({ ...season, endDay: 30 }).success).toBe(false); // 30 February
    expect(TariffSeasonSchema.safeParse({ ...season, startMonth: 4, startDay: 31 }).success).toBe(
      false,
    );
    expect(TariffSeasonSchema.safeParse({ ...season, startMonth: 13 }).success).toBe(false);
  });

  it('accepts a leap day', () => {
    expect(TariffSeasonSchema.safeParse({ ...season, endDay: 29 }).success).toBe(true);
  });

  it('requires a levy amount to be a non-negative string', () => {
    const levy = { name: 'PSO (example)', kind: 'PER_DAY', amount: '0.100000', taxable: false };
    expect(TariffLevySchema.safeParse(levy).success).toBe(true);
    expect(TariffLevySchema.safeParse({ ...levy, amount: 0.1 }).success).toBe(false);
    expect(TariffLevySchema.safeParse({ ...levy, kind: 'MONTHLY' }).success).toBe(false);
  });

  it('requires an override to end after it starts', () => {
    const o = {
      name: 'Holiday',
      dateFrom: '2026-12-24',
      dateTo: '2026-12-27',
      priority: 5,
      slots: [],
    };
    expect(CreateTariffRequestSchema.safeParse({ ...flatImport, overrides: [o] }).success).toBe(
      true,
    );
    expect(
      CreateTariffRequestSchema.safeParse({
        ...flatImport,
        overrides: [{ ...o, dateTo: '2026-12-24' }],
      }).success,
    ).toBe(false);
  });

  it('requires a price point to have positive length and a string rate', () => {
    const p = {
      intervalStart: '2026-10-25T00:00:00Z',
      intervalEnd: '2026-10-25T00:30:00Z',
      ratePerKwh: '0.2',
    };
    expect(PricePointSchema.safeParse(p).success).toBe(true);
    expect(PricePointSchema.safeParse({ ...p, intervalEnd: p.intervalStart }).success).toBe(false);
    expect(PricePointSchema.safeParse({ ...p, ratePerKwh: 0.2 }).success).toBe(false);
  });

  it('caps a price upload at 5,000 points and refuses an empty one', () => {
    const p = {
      intervalStart: '2026-10-25T00:00:00Z',
      intervalEnd: '2026-10-25T00:30:00Z',
      ratePerKwh: '0.2',
    };
    expect(
      PutPricePointsRequestSchema.safeParse({ pricePoints: Array(5000).fill(p) }).success,
    ).toBe(true);
    expect(
      PutPricePointsRequestSchema.safeParse({ pricePoints: Array(5001).fill(p) }).success,
    ).toBe(false);
    expect(PutPricePointsRequestSchema.safeParse({ pricePoints: [] }).success).toBe(false);
  });
});

describe('slot defaults and small schemas', () => {
  it('defaults a slot to every day with no label', () => {
    const s = TariffSlotSchema.parse({ startMinute: 0, endMinute: 60, ratePerKwh: '0.1' });
    expect(s.dayType).toBe('ALL');
    expect(s.label).toBeNull();
  });

  it('ends a version with a local date only', () => {
    expect(EndTariffRequestSchema.safeParse({ effectiveTo: '2026-12-31' }).success).toBe(true);
    expect(EndTariffRequestSchema.safeParse({ effectiveTo: '2026-12-31', name: 'x' }).success).toBe(
      false,
    );
  });

  it('keeps validate results consistent', () => {
    expect(ValidateTariffResponseSchema.safeParse({ valid: true, problems: [] }).success).toBe(
      true,
    );
    expect(
      ValidateTariffResponseSchema.safeParse({
        valid: false,
        problems: [
          { code: 'COVERAGE_GAP', path: 'slots', message: 'Minutes 480 to 600 have no rate' },
        ],
      }).success,
    ).toBe(true);
    expect(
      ValidateTariffResponseSchema.safeParse({
        valid: true,
        problems: [{ code: 'COVERAGE_GAP', path: 'slots', message: 'x' }],
      }).success,
    ).toBe(false);
    expect(ValidateTariffResponseSchema.safeParse({ valid: false, problems: [] }).success).toBe(
      false,
    );
  });
});
