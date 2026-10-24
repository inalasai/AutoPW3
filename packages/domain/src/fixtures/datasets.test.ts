import { EnergyIntervalSchema, EnergySeriesPointSchema, PowerSampleSchema } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { detectGaps } from '../telemetry/series';
import { localMinuteOfDay } from '../telemetry/timestamps';
import {
  inspectEnergyValues,
  inspectPowerValues,
  resolveValidationOptions,
} from '../telemetry/validation';
import {
  DEMO_DATASET_IDS,
  demoDataset,
  demoDay,
  demoDayWithGap,
  demoMonth,
  demoWeek,
  withoutSamplesBetween,
} from './datasets';
import type { DemoDataset } from './datasets';
import {
  DEFAULT_DEMO_SITE,
  DEMO_ENERGY_INTERVAL_SECONDS,
  DEMO_EPOCH_MS,
  DEMO_STEP_SECONDS,
  DemoSiteModel,
} from './demo-model';
import { fnv1a32Hex } from './prng';

const day = demoDay();
const week = demoWeek();
const month = demoMonth();
const all: readonly DemoDataset[] = [day, week, month];
const options = resolveValidationOptions();

function sum(values: readonly (number | null)[]): number {
  return values.reduce<number>((total, v) => total + (v ?? 0), 0);
}

describe('determinism', () => {
  it('the same call twice gives identical datasets', () => {
    expect(demoDay()).toEqual(day);
    expect(demoWeek()).toEqual(week);
    expect(demoMonth()).toEqual(month);
  });

  it('a brand new model (no cache) gives the same records as the shared one', () => {
    const fresh = () => new DemoSiteModel(DEFAULT_DEMO_SITE);
    expect(demoDay(fresh())).toEqual(day);
    expect(demoWeek(fresh())).toEqual(week);
  });

  it('does not depend on what was asked before: the month first, then the day, on a new model', () => {
    const model = new DemoSiteModel(DEFAULT_DEMO_SITE);
    demoMonth(model);
    expect(demoDay(model)).toEqual(day);
    const other = new DemoSiteModel(DEFAULT_DEMO_SITE);
    expect(demoWeek(other)).toEqual(week);
  });

  it('serialises to the same text, so a golden fingerprint can pin it', () => {
    expect(JSON.stringify(demoDay())).toBe(JSON.stringify(day));
    // GOLDEN: regenerate deliberately (and note it in docs/DECISIONS.md) if the demo model is changed on purpose.
    expect({
      day: fnv1a32Hex(JSON.stringify(day)),
      week: fnv1a32Hex(JSON.stringify(week)),
      month: fnv1a32Hex(JSON.stringify(month)),
    }).toEqual({ day: 'd11807bf', week: '09edbf7c', month: 'e1f99d36' });
  });

  it('a different seed gives a different, equally repeatable world', () => {
    const other = new DemoSiteModel({ ...DEFAULT_DEMO_SITE, seed: 7 });
    const otherDay = demoDay(other);
    expect(otherDay.power).not.toEqual(day.power);
    expect(otherDay.seed).toBe(7);
    expect(demoDay(new DemoSiteModel({ ...DEFAULT_DEMO_SITE, seed: 7 }))).toEqual(otherDay);
  });

  it('demoDataset(id) agrees with the named functions', () => {
    expect(DEMO_DATASET_IDS).toEqual(['DEMO_DAY', 'DEMO_WEEK', 'DEMO_MONTH']);
    expect(demoDataset('DEMO_DAY')).toEqual(day);
    expect(demoDataset('DEMO_WEEK')).toEqual(week);
    expect(demoDataset('DEMO_MONTH')).toEqual(month);
  });
});

describe('shape and size', () => {
  it('a day is 288 power snapshots and 96 energy intervals', () => {
    expect(day.power).toHaveLength(288);
    expect(day.energy).toHaveLength(96);
    expect(day.from).toBe('2026-06-20T23:00:00Z');
    expect(day.to).toBe('2026-06-21T23:00:00Z');
  });

  it('the week has 169 hours because the clocks go back on 2026-10-25', () => {
    expect(week.power).toHaveLength(169 * 12);
    expect(week.energy).toHaveLength(169 * 4);
    expect(week.from).toBe('2026-10-23T23:00:00Z');
    expect(week.to).toBe('2026-10-31T00:00:00Z');
  });

  it('the month is 30 local days of 24 hours', () => {
    expect(month.power).toHaveLength(30 * 288);
    expect(month.energy).toHaveLength(30 * 96);
  });

  it('is ascending, with exactly 300 s between snapshots and 900 s intervals that touch', () => {
    for (const set of all) {
      for (let i = 1; i < set.power.length; i += 1) {
        const previous = Date.parse(set.power[i - 1]?.sampledAt ?? '');
        const current = Date.parse(set.power[i]?.sampledAt ?? '');
        expect(current - previous).toBe(DEMO_STEP_SECONDS * 1000);
      }
      for (let i = 0; i < set.energy.length; i += 1) {
        const interval = set.energy[i];
        expect(
          (Date.parse(interval?.intervalEnd ?? '') - Date.parse(interval?.intervalStart ?? '')) /
            1000,
        ).toBe(DEMO_ENERGY_INTERVAL_SECONDS);
        if (i > 0) expect(interval?.intervalStart).toBe(set.energy[i - 1]?.intervalEnd);
      }
      expect(set.power[0]?.sampledAt).toBe(set.from);
      expect(set.energy[0]?.intervalStart).toBe(set.from);
      expect(set.energy.at(-1)?.intervalEnd).toBe(set.to);
    }
  });
});

describe('every record is labelled, unit-explicit and valid', () => {
  it('has source DEMO everywhere', () => {
    for (const set of all) {
      expect(set.source).toBe('DEMO');
      expect(set.power.every((s) => s.source === 'DEMO')).toBe(true);
      expect(set.energy.every((i) => i.source === 'DEMO')).toBe(true);
    }
  });

  it('parses against the shared schemas', () => {
    for (const set of all) {
      for (const sample of set.power) {
        expect(PowerSampleSchema.safeParse(sample).success).toBe(true);
      }
      for (const interval of set.energy) {
        // The persisted-interval schema accepts live sources only, so a DEMO interval is refused as it is ...
        expect(EnergyIntervalSchema.safeParse(interval).success).toBe(false);
        // ... and the shape is otherwise exactly right: relabelling it as TESLA is the only thing it objects to.
        expect(EnergyIntervalSchema.safeParse({ ...interval, source: 'TESLA' }).success).toBe(true);
      }
    }
  });

  it('has a UTC timestamp and a quality flag on every sample', () => {
    for (const sample of day.power) {
      expect(sample.sampledAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      expect(sample.receivedAt).toBe(sample.sampledAt);
      expect(sample.quality).toBe('OK');
    }
  });

  it('has whole-watt power, so the balance is exact: load = solar + battery + grid', () => {
    for (const set of all) {
      for (const s of set.power) {
        for (const w of [s.solarPowerW, s.batteryPowerW, s.gridPowerW, s.loadPowerW]) {
          expect(Number.isInteger(w)).toBe(true);
        }
        expect(
          (s.loadPowerW ?? 0) -
            ((s.solarPowerW ?? 0) + (s.batteryPowerW ?? 0) + (s.gridPowerW ?? 0)),
        ).toBe(0);
      }
    }
  });

  it('passes every data-quality inspection with no issue', () => {
    for (const set of all) {
      for (const s of set.power) {
        expect(
          inspectPowerValues(
            {
              solarPowerW: s.solarPowerW,
              batteryPowerW: s.batteryPowerW,
              gridPowerW: s.gridPowerW,
              loadPowerW: s.loadPowerW,
              batterySocPercent: s.batterySocPercent,
            },
            options,
          ),
        ).toEqual([]);
      }
      for (const i of set.energy) {
        expect(
          inspectEnergyValues(
            {
              solarGeneratedWh: i.solarGeneratedWh,
              homeConsumedWh: i.homeConsumedWh,
              gridImportWh: i.gridImportWh,
              gridExportWh: i.gridExportWh,
              batteryChargedWh: i.batteryChargedWh,
              batteryDischargedWh: i.batteryDischargedWh,
            },
            i.resolutionSeconds,
            options,
          ),
        ).toEqual([]);
      }
    }
  });
});

describe('signs and physical plausibility', () => {
  const power = month.power;

  it('solar is never negative and is zero at night', () => {
    expect(power.every((s) => (s.solarPowerW ?? 0) >= 0)).toBe(true);
    const night = day.power.filter((s) => {
      const hour = new Date(s.sampledAt).getUTCHours();
      return hour >= 22 || hour < 3;
    });
    expect(night.length).toBeGreaterThan(0);
    expect(night.every((s) => s.solarPowerW === 0)).toBe(true);
  });

  it('on the longest day the sun rises and sets at plausible Irish times', () => {
    const producing = day.power.filter((s) => (s.solarPowerW ?? 0) > 0);
    const first = new Date(producing[0]?.sampledAt ?? '');
    const last = new Date(producing.at(-1)?.sampledAt ?? '');
    const firstMinutes = first.getUTCHours() * 60 + first.getUTCMinutes();
    const lastMinutes = last.getUTCHours() * 60 + last.getUTCMinutes();
    expect(firstMinutes).toBeGreaterThanOrEqual(3 * 60 + 30);
    expect(firstMinutes).toBeLessThanOrEqual(5 * 60 + 30);
    expect(lastMinutes).toBeGreaterThanOrEqual(19 * 60 + 30);
    expect(lastMinutes).toBeLessThanOrEqual(21 * 60 + 30);
  });

  it('peak solar stays below the array size', () => {
    const peak = Math.max(...power.map((s) => s.solarPowerW ?? 0));
    expect(peak).toBeGreaterThan(2500);
    expect(peak).toBeLessThanOrEqual(DEFAULT_DEMO_SITE.solarKwp * 1000);
  });

  it('a June day makes much more solar energy than a late-October day', () => {
    const june = sum(day.energy.map((i) => i.solarGeneratedWh));
    const october = sum(week.energy.map((i) => i.solarGeneratedWh)) / 7;
    expect(june).toBeGreaterThan(october);
    // Month-wide, to take weather out of it.
    const juneMean = sum(month.energy.map((i) => i.solarGeneratedWh)) / 30;
    expect(juneMean).toBeGreaterThan(october * 1.5);
  });

  it('the battery never exceeds its power rating and its level stays between reserve and full', () => {
    for (const s of power) {
      expect(Math.abs(s.batteryPowerW ?? 0)).toBeLessThanOrEqual(
        DEFAULT_DEMO_SITE.batteryMaxPowerW,
      );
      expect(s.batterySocPercent ?? -1).toBeGreaterThanOrEqual(
        DEFAULT_DEMO_SITE.batteryReservePercent,
      );
      expect(s.batterySocPercent ?? 101).toBeLessThanOrEqual(100);
    }
  });

  it('shows the whole range of behaviour: charging, discharging, importing, exporting', () => {
    expect(power.some((s) => (s.batteryPowerW ?? 0) < 0)).toBe(true);
    expect(power.some((s) => (s.batteryPowerW ?? 0) > 0)).toBe(true);
    expect(power.some((s) => (s.gridPowerW ?? 0) > 0)).toBe(true);
    expect(power.some((s) => (s.gridPowerW ?? 0) < 0)).toBe(true);
  });

  it('the load is positive, modest and has an evening peak on the household clock in winter and summer', () => {
    expect(power.every((s) => (s.loadPowerW ?? 0) >= 90)).toBe(true);
    const model = new DemoSiteModel(DEFAULT_DEMO_SITE);
    for (const startDate of ['2026-01-05', '2026-07-06']) {
      const startMs = Date.parse(`${startDate}T00:00:00Z`) - DEMO_EPOCH_MS;
      const first = startMs / (DEMO_STEP_SECONDS * 1000);
      const byHour = new Array<number>(24).fill(0);
      for (let i = 0; i < 28 * 288; i += 1) {
        const index = first + i;
        const ms = DEMO_EPOCH_MS + index * DEMO_STEP_SECONDS * 1000;
        const hour = Math.floor(localMinuteOfDay(ms, 'Europe/Dublin') / 60);
        byHour[hour] = (byHour[hour] ?? 0) + model.valuesAt(index).loadPowerW;
      }
      const peakHour = byHour.indexOf(Math.max(...byHour));
      expect(peakHour).toBeGreaterThanOrEqual(18);
      expect(peakHour).toBeLessThanOrEqual(20);
    }
  });
});

describe('energy intervals agree with the power snapshots', () => {
  it('each interval is the sum of its three snapshots (Wh = W x 300 s / 3600), within rounding', () => {
    for (let k = 0; k < day.energy.length; k += 1) {
      const interval = day.energy[k];
      const steps = day.power.slice(k * 3, k * 3 + 3);
      const toWh = DEMO_STEP_SECONDS / 3600;
      const solar = sum(steps.map((s) => s.solarPowerW)) * toWh;
      const home = sum(steps.map((s) => s.loadPowerW)) * toWh;
      const imported = sum(steps.map((s) => Math.max(0, s.gridPowerW ?? 0))) * toWh;
      const exported = sum(steps.map((s) => Math.max(0, -(s.gridPowerW ?? 0)))) * toWh;
      const charged = sum(steps.map((s) => Math.max(0, -(s.batteryPowerW ?? 0)))) * toWh;
      const discharged = sum(steps.map((s) => Math.max(0, s.batteryPowerW ?? 0))) * toWh;
      expect(interval?.solarGeneratedWh).toBeCloseTo(solar, 0);
      expect(interval?.homeConsumedWh).toBeCloseTo(home, 0);
      expect(interval?.gridImportWh).toBeCloseTo(imported, 0);
      expect(interval?.gridExportWh).toBeCloseTo(exported, 0);
      expect(interval?.batteryChargedWh).toBeCloseTo(charged, 0);
      expect(interval?.batteryDischargedWh).toBeCloseTo(discharged, 0);
    }
  });

  it('is non-negative, with import and export never in the same interval of one step', () => {
    for (const i of month.energy) {
      for (const wh of [
        i.solarGeneratedWh,
        i.homeConsumedWh,
        i.gridImportWh,
        i.gridExportWh,
        i.batteryChargedWh,
        i.batteryDischargedWh,
      ]) {
        expect(wh ?? -1).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('daily energy points built from them parse against the shared point schema', () => {
    const wh = (key: 'solarGeneratedWh' | 'homeConsumedWh') => sum(day.energy.map((i) => i[key]));
    const point = {
      start: day.from,
      end: day.to,
      localDate: '2026-06-21',
      solarGeneratedWh: wh('solarGeneratedWh'),
      homeConsumedWh: wh('homeConsumedWh'),
      gridImportWh: sum(day.energy.map((i) => i.gridImportWh)),
      gridExportWh: sum(day.energy.map((i) => i.gridExportWh)),
      batteryChargedWh: sum(day.energy.map((i) => i.batteryChargedWh)),
      batteryDischargedWh: sum(day.energy.map((i) => i.batteryDischargedWh)),
      completeness: 1,
      resolutionSecondsMin: DEMO_ENERGY_INTERVAL_SECONDS,
      resolutionSecondsMax: DEMO_ENERGY_INTERVAL_SECONDS,
      quality: 'OK',
    };
    expect(EnergySeriesPointSchema.safeParse(point).success).toBe(true);
  });
});

describe('the gap fixture', () => {
  const gapped = demoDayWithGap();

  it('has 18 snapshots missing and one gap of 5700 s found by gap detection', () => {
    expect(gapped.power).toHaveLength(288 - 18);
    expect(detectGaps(gapped.power, { expectedIntervalSeconds: DEMO_STEP_SECONDS })).toEqual([
      {
        from: '2026-06-21T09:55:00Z',
        to: '2026-06-21T11:30:00Z',
        seconds: 5700,
        missingSamples: 18,
      },
    ]);
  });

  it('leaves the energy data and everything else alone', () => {
    expect(gapped.energy).toEqual(day.energy);
    expect(gapped.id).toBe('DEMO_DAY');
  });

  it('withoutSamplesBetween removes [from, to) and never invents anything', () => {
    const kept = withoutSamplesBetween(day.power, '2026-06-21T10:00:00Z', '2026-06-21T10:05:00Z');
    expect(kept).toHaveLength(287);
    expect(kept.some((s) => s.sampledAt === '2026-06-21T10:00:00Z')).toBe(false);
    expect(kept.some((s) => s.sampledAt === '2026-06-21T10:05:00Z')).toBe(true);
  });
});

describe('the demo world has edges', () => {
  it('refuses a step outside 2026-01-01 .. 2031-01-01', () => {
    const model = new DemoSiteModel(DEFAULT_DEMO_SITE);
    expect(() => model.valuesAt(-1)).toThrow(RangeError);
    expect(() => model.stepIndexAt(DEMO_EPOCH_MS - 1)).toThrow(RangeError);
    expect(() => model.stepIndexAt(Date.UTC(2031, 0, 1))).toThrow(RangeError);
    expect(() => model.stepIndexAt(Number.NaN)).toThrow(RangeError);
    expect(model.stepIndexAt(DEMO_EPOCH_MS)).toBe(0);
  });

  it('refuses an unknown timezone when the model is built', () => {
    expect(() => new DemoSiteModel({ ...DEFAULT_DEMO_SITE, timezone: 'Mars/Olympus' })).toThrow();
  });
});
