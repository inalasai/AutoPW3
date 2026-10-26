import { describe, expect, it } from 'vitest';
import { validateTariffForm } from './validate';
import { createDefaultFormState } from './windows';

describe('validateTariffForm', () => {
  it('passes validation for a complete, well-formed tariff', () => {
    const state = createDefaultFormState();
    const result = validateTariffForm(state);
    expect(result.valid).toBe(true);
    expect(result.problems).toHaveLength(0);
  });

  it('detects slot overlaps (acceptance criterion: overlapping tariffs cannot be saved)', () => {
    const state = createDefaultFormState();
    // Introduce overlapping windows: 00:00-10:00 and 08:00-23:00
    state.windows = [
      {
        id: 'w1',
        dayType: 'ALL',
        startTime: '00:00',
        endTime: '10:00',
        ratePerKwh: '0.180000',
        label: 'Night',
      },
      {
        id: 'w2',
        dayType: 'ALL',
        startTime: '08:00',
        endTime: '24:00',
        ratePerKwh: '0.350000',
        label: 'Day',
      },
    ];

    const result = validateTariffForm(state);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.code === 'SLOT_OVERLAP')).toBe(true);
  });

  it('detects coverage gaps (acceptance criterion: incomplete tariffs cannot be saved)', () => {
    const state = createDefaultFormState();
    // Only covers 08:00 to 18:00 -> gaps from 00:00 to 08:00 and 18:00 to 24:00
    state.windows = [
      {
        id: 'w1',
        dayType: 'ALL',
        startTime: '08:00',
        endTime: '18:00',
        ratePerKwh: '0.300000',
        label: 'Day',
      },
    ];

    const result = validateTariffForm(state);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.code === 'COVERAGE_GAP')).toBe(true);
  });

  it('flags missing required fields for FLAT tariffs', () => {
    const state = createDefaultFormState();
    state.priceMode = 'FLAT';
    state.flatRatePerKwh = ''; // Missing flat rate

    const result = validateTariffForm(state);
    expect(result.valid).toBe(false);
    expect(result.fieldErrors['flatRatePerKwh']).toBeDefined();
  });

  it('flags missing export payment model on EXPORT tariffs', () => {
    const state = createDefaultFormState();
    state.direction = 'EXPORT';
    state.exportPaymentModel = '';

    const result = validateTariffForm(state);
    expect(result.valid).toBe(false);
    expect(result.fieldErrors['exportPaymentModel']).toBeDefined();
  });
});
