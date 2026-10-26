import { describe, expect, it } from 'vitest';
import type { EnergyIntervalOf, IntervalCostDetail } from '@autopw3/domain';
import { aggregateSeries, MAX_CHART_POINTS } from './aggregation';

function makeInterval(
  start: string,
  end: string,
  solarWh: number,
  homeWh: number,
  gridImportWh: number = 0,
  gridExportWh: number = 0,
  batteryChargedWh: number = 0,
  batteryDischargedWh: number = 0,
  quality: 'OK' | 'SUSPECT' = 'OK',
): EnergyIntervalOf<'DEMO'> {
  return {
    source: 'DEMO',
    intervalStart: start,
    intervalEnd: end,
    resolutionSeconds: 900,
    solarGeneratedWh: solarWh,
    homeConsumedWh: homeWh,
    gridImportWh,
    gridExportWh,
    batteryChargedWh,
    batteryDischargedWh,
    quality,
  };
}

describe('aggregation utilities', () => {
  const intervals: EnergyIntervalOf<'DEMO'>[] = [
    makeInterval('2026-06-21T12:00:00Z', '2026-06-21T12:15:00Z', 1000, 500, 0, 500),
    makeInterval('2026-06-21T12:15:00Z', '2026-06-21T12:30:00Z', 1200, 600, 0, 600),
    makeInterval('2026-06-21T12:30:00Z', '2026-06-21T12:45:00Z', 800, 400, 0, 400),
    makeInterval('2026-06-21T12:45:00Z', '2026-06-21T13:00:00Z', 1000, 500, 0, 500),
  ];

  const costDetails: IntervalCostDetail[] = [
    {
      intervalStart: '2026-06-21T12:00:00Z',
      intervalEnd: '2026-06-21T12:15:00Z',
      importPrice: null,
      exportPrice: {
        status: 'PRICED',
        direction: 'EXPORT',
        currency: 'EUR',
        energyKwh: '0.500000',
        exportPaymentModel: 'PER_KWH',
        amounts: {
          baseAmount: '0.050000',
          levyAmount: '0.000000',
          vatAmount: '0.000000',
          totalAmount: '0.050000',
          amountExcludingVat: '0.050000',
        },
        parts: [],
      },
    },
  ];

  it('aggregates at interval resolution with exact kWh conversion', () => {
    const { energyPoints, costPoints } = aggregateSeries(
      intervals,
      costDetails,
      'interval',
      'Europe/Dublin',
    );

    expect(energyPoints).toHaveLength(4);
    expect(energyPoints[0]!.solarKwh).toBe(1.0);
    expect(energyPoints[0]!.homeKwh).toBe(0.5);
    expect(energyPoints[0]!.gridExportKwh).toBe(0.5);
    expect(energyPoints[0]!.isGap).toBe(false);

    expect(costPoints).toHaveLength(4);
    expect(costPoints[0]!.exportCredit).toBe(0.05);
    expect(costPoints[0]!.netCost).toBe(-0.05);
  });

  it('aggregates 4 quarter-hour intervals into 1 hourly bucket', () => {
    const { energyPoints, costPoints } = aggregateSeries(
      intervals,
      costDetails,
      'hourly',
      'Europe/Dublin',
    );

    expect(energyPoints).toHaveLength(1);
    // Sum: 1000 + 1200 + 800 + 1000 = 4000 Wh = 4.0 kWh
    expect(energyPoints[0]!.solarKwh).toBe(4.0);
    // Home sum: 500 + 600 + 400 + 500 = 2000 Wh = 2.0 kWh
    expect(energyPoints[0]!.homeKwh).toBe(2.0);

    expect(costPoints).toHaveLength(1);
    expect(costPoints[0]!.exportCredit).toBe(0.05);
  });

  it('flags SUSPECT intervals as gaps in both interval and aggregated modes', () => {
    const withSuspect: EnergyIntervalOf<'DEMO'>[] = [
      makeInterval(
        '2026-06-21T12:00:00Z',
        '2026-06-21T12:15:00Z',
        1000,
        500,
        0,
        0,
        0,
        0,
        'SUSPECT',
      ),
    ];

    const { energyPoints: intervalPoints } = aggregateSeries(
      withSuspect,
      [],
      'interval',
      'Europe/Dublin',
    );
    expect(intervalPoints[0]!.isGap).toBe(true);

    const { energyPoints: hourlyPoints } = aggregateSeries(
      withSuspect,
      [],
      'hourly',
      'Europe/Dublin',
    );
    expect(hourlyPoints[0]!.isGap).toBe(true);
  });

  it('downsamples responsibly when points exceed MAX_CHART_POINTS', () => {
    const manyIntervals: EnergyIntervalOf<'DEMO'>[] = [];
    for (let i = 0; i < 600; i++) {
      manyIntervals.push(
        makeInterval(
          new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
          new Date(Date.UTC(2026, 0, 1, 0, (i + 1) * 15)).toISOString(),
          100,
          100,
        ),
      );
    }

    const { energyPoints } = aggregateSeries(manyIntervals, [], 'interval', 'Europe/Dublin');
    expect(energyPoints.length).toBeLessThanOrEqual(MAX_CHART_POINTS);
  });
});
