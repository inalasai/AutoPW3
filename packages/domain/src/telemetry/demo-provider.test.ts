import { MAX_RANGE_DAYS } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../clock';
import { DEMO_SCENARIO_IDS, DEMO_SCENARIOS } from '../fixtures/scenarios';
import { demoDay } from '../fixtures/datasets';
import { DEMO_EPOCH_MS, DEMO_HORIZON_MS } from '../fixtures/demo-model';
import { createDemoTelemetryProvider } from './demo-provider';
import { freshnessOf } from './freshness';
import { TelemetryProviderError } from './provider';
import type { TelemetryProvider } from './provider';

const NOW = new Date('2026-06-21T12:02:30Z');
const SITE = 'site-1';

function provider(scenario?: (typeof DEMO_SCENARIO_IDS)[number]) {
  return createDemoTelemetryProvider({
    clock: new FixedClock(NOW),
    ...(scenario ? { scenario } : {}),
  });
}

async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TelemetryProviderError);
    return (error as TelemetryProviderError).code;
  }
  return 'NO_ERROR';
}

describe('capabilities', () => {
  it('says what it is: synthetic DEMO, no credentials, honest about resolution', () => {
    const caps = provider().getCapabilities();
    expect(caps.source).toBe('DEMO');
    expect(caps.synthetic).toBe(true);
    expect(caps.verification).toBe('SYNTHETIC');
    expect(caps.live).toEqual({
      supported: true,
      nativeCadenceSeconds: 300,
      cadenceVerified: true,
    });
    expect(caps.powerSeries.resolutionSeconds).toBe(300);
    expect(caps.powerSeries.maxRangeDays).toBe(MAX_RANGE_DAYS.power);
    expect(caps.energySeries.resolutions).toEqual(['interval', 'hourly', 'daily']);
    expect(caps.energySeries.nativeIntervalSeconds).toBe(900);
    expect(caps.energySeries.maxRangeDays).toEqual({
      interval: MAX_RANGE_DAYS.interval,
      hourly: MAX_RANGE_DAYS.hourly,
      daily: MAX_RANGE_DAYS.daily,
    });
    expect(Object.values(caps.fields).every((f) => f === 'SUPPORTED')).toBe(true);
  });

  it('satisfies the TelemetryProvider interface for DEMO', () => {
    const p: TelemetryProvider<'DEMO'> = provider();
    expect(p.source).toBe('DEMO');
  });
});

describe('live snapshot', () => {
  it('is deterministic for a given clock and labelled DEMO', async () => {
    const a = await provider().getLiveSnapshot({ siteId: SITE });
    const b = await provider().getLiveSnapshot({ siteId: SITE });
    expect(a).toEqual(b);
    expect(a.source).toBe('DEMO');
    expect(a.sample.source).toBe('DEMO');
    expect(a.sample.sampledAt).toBe('2026-06-21T12:00:00Z');
    expect(a.sample.receivedAt).toBe('2026-06-21T12:02:30Z');
    expect(a.sample.quality).toBe('OK');
    expect(a.issues).toEqual([]);
  });

  it('is the same data the series returns for that instant', async () => {
    const p = provider();
    const live = await p.getLiveSnapshot({ siteId: SITE });
    const series = await p.getPowerSeries({
      siteId: SITE,
      from: '2026-06-21T12:00:00Z',
      to: '2026-06-21T12:05:00Z',
    });
    expect(series.samples).toHaveLength(1);
    const { receivedAt: _liveReceived, ...liveValues } = live.sample;
    const { receivedAt: _seriesReceived, ...seriesValues } = series.samples[0] ?? live.sample;
    expect(seriesValues).toEqual(liveValues);
  });

  it('moves with the injected clock, not the real one', async () => {
    const clock = new FixedClock(NOW);
    const p = createDemoTelemetryProvider({ clock });
    const first = await p.getLiveSnapshot({ siteId: SITE });
    clock.advanceMs(6 * 3600 * 1000);
    const later = await p.getLiveSnapshot({ siteId: SITE });
    expect(later.sample.sampledAt).toBe('2026-06-21T18:00:00Z');
    expect(later.sample.sampledAt).not.toBe(first.sample.sampledAt);
    expect(freshnessOf(later.sample.sampledAt, clock.now()).freshness).toBe('FRESH');
  });

  it('refuses a time outside the demo world instead of making something up', async () => {
    const before = createDemoTelemetryProvider({
      clock: new FixedClock(new Date(DEMO_EPOCH_MS - 1)),
    });
    const after = createDemoTelemetryProvider({ clock: new FixedClock(new Date(DEMO_HORIZON_MS)) });
    expect(await errorCodeOf(before.getLiveSnapshot({ siteId: SITE }))).toBe('OUT_OF_COVERAGE');
    expect(await errorCodeOf(after.getLiveSnapshot({ siteId: SITE }))).toBe('OUT_OF_COVERAGE');
  });
});

describe('live snapshot scenarios', () => {
  it.each([...DEMO_SCENARIO_IDS])('%s serves what the scenario says it will', async (id) => {
    const scenario = DEMO_SCENARIOS[id];
    const result = await provider(id).getLiveSnapshot({ siteId: SITE });
    expect(result.sample.source).toBe('DEMO');
    expect(result.sample.quality).toBe(scenario.expect.quality);
    expect([...new Set(result.issues.map((i) => i.code))].sort()).toEqual([
      ...scenario.expect.issueCodes,
    ]);
    expect(freshnessOf(result.sample.sampledAt, NOW).freshness).toBe(scenario.expect.freshness);
  });

  it('a scenario still works at the edges of the demo world (it ignores the model)', async () => {
    const late = createDemoTelemetryProvider({
      clock: new FixedClock(new Date(DEMO_HORIZON_MS + 86_400_000)),
      scenario: 'SOLAR_SURPLUS',
    });
    expect((await late.getLiveSnapshot({ siteId: SITE })).sample.quality).toBe('OK');
  });
});

describe('power series', () => {
  it('returns [from, to) at 300 s with no gaps and full completeness', async () => {
    const result = await provider().getPowerSeries({
      siteId: SITE,
      from: '2026-06-20T23:00:00Z',
      to: '2026-06-21T23:00:00Z',
    });
    expect(result.source).toBe('DEMO');
    expect(result.resolutionSeconds).toBe(300);
    expect(result.samples).toEqual(demoDay().power);
    expect(result.gaps).toEqual([]);
    expect(result.completeness).toBe(1);
  });

  it('includes the start instant and excludes the end instant', async () => {
    const result = await provider().getPowerSeries({
      siteId: SITE,
      from: '2026-06-21T12:00:00Z',
      to: '2026-06-21T12:15:00Z',
    });
    expect(result.samples.map((s) => s.sampledAt)).toEqual([
      '2026-06-21T12:00:00Z',
      '2026-06-21T12:05:00Z',
      '2026-06-21T12:10:00Z',
    ]);
  });

  it('a start between steps begins at the next step, and a range with no step is one gap', async () => {
    const mid = await provider().getPowerSeries({
      siteId: SITE,
      from: '2026-06-21T12:01:00Z',
      to: '2026-06-21T12:11:00Z',
    });
    expect(mid.samples[0]?.sampledAt).toBe('2026-06-21T12:05:00Z');
    const tiny = await provider().getPowerSeries({
      siteId: SITE,
      from: '2026-06-21T12:01:00Z',
      to: '2026-06-21T12:03:00Z',
    });
    expect(tiny.samples).toEqual([]);
    expect(tiny.completeness).toBe(0);
    expect(tiny.gaps).toHaveLength(1);
  });

  it('rejects bad ranges with specific codes', async () => {
    const p = provider();
    const base = { siteId: SITE, from: '2026-06-21T12:00:00Z', to: '2026-06-21T13:00:00Z' };
    expect(await errorCodeOf(p.getPowerSeries({ ...base, to: base.from }))).toBe('RANGE_INVALID');
    expect(await errorCodeOf(p.getPowerSeries({ ...base, to: '2026-06-21T11:00:00Z' }))).toBe(
      'RANGE_INVALID',
    );
    expect(await errorCodeOf(p.getPowerSeries({ ...base, from: 'yesterday' }))).toBe(
      'RANGE_INVALID',
    );
    expect(await errorCodeOf(p.getPowerSeries({ ...base, from: '2026-06-21T12:00:00' }))).toBe(
      'RANGE_INVALID',
    );
    expect(await errorCodeOf(p.getPowerSeries({ ...base, to: '2026-07-21T12:00:00Z' }))).toBe(
      'RANGE_TOO_LARGE',
    );
  });

  it('refuses ranges outside the demo world', async () => {
    const p = provider();
    expect(
      await errorCodeOf(
        p.getPowerSeries({
          siteId: SITE,
          from: '2025-12-31T00:00:00Z',
          to: '2026-01-02T00:00:00Z',
        }),
      ),
    ).toBe('OUT_OF_COVERAGE');
    expect(
      await errorCodeOf(
        p.getPowerSeries({
          siteId: SITE,
          from: '2030-12-31T00:00:00Z',
          to: '2031-01-02T00:00:00Z',
        }),
      ),
    ).toBe('OUT_OF_COVERAGE');
  });
});

describe('energy series', () => {
  const request = (
    resolution: 'interval' | 'hourly' | 'daily',
    from: string,
    to: string,
    timezone = 'Europe/Dublin',
  ) => ({ siteId: SITE, from, to, resolution, timezone });

  it('interval: 900 s points that state their real resolution', async () => {
    const result = await provider().getEnergySeries(
      request('interval', '2026-06-21T12:00:00Z', '2026-06-21T13:00:00Z'),
    );
    expect(result.resolution).toBe('interval');
    expect(result.items).toHaveLength(4);
    for (const item of result.items) {
      expect(item.resolutionSecondsMin).toBe(900);
      expect(item.resolutionSecondsMax).toBe(900);
      expect(item.completeness).toBe(1);
      expect(item.quality).toBe('OK');
      expect(item.localDate).toBeUndefined();
    }
    expect(result.items[0]?.start).toBe('2026-06-21T12:00:00Z');
    expect(result.items[3]?.end).toBe('2026-06-21T13:00:00Z');
  });

  it('interval: a start inside an interval returns the whole interval, never a slice', async () => {
    const result = await provider().getEnergySeries(
      request('interval', '2026-06-21T12:07:00Z', '2026-06-21T12:20:00Z'),
    );
    expect(result.items.map((i) => i.start)).toEqual([
      '2026-06-21T12:00:00Z',
      '2026-06-21T12:15:00Z',
    ]);
  });

  it('hourly: an hour is the sum of its four intervals, with no finer resolution claimed', async () => {
    const p = provider();
    const hourly = await p.getEnergySeries(
      request('hourly', '2026-06-21T12:00:00Z', '2026-06-21T13:00:00Z'),
    );
    const intervals = await p.getEnergySeries(
      request('interval', '2026-06-21T12:00:00Z', '2026-06-21T13:00:00Z'),
    );
    expect(hourly.items).toHaveLength(1);
    const hour = hourly.items[0];
    const total = intervals.items.reduce((s, i) => s + (i.solarGeneratedWh ?? 0), 0);
    expect(hour?.solarGeneratedWh).toBeCloseTo(total, 1);
    expect(hour?.resolutionSecondsMin).toBe(900);
    expect(hour?.resolutionSecondsMax).toBe(900);
    expect(hour?.completeness).toBe(1);
  });

  it('hourly: partial first hour is still a whole UTC-aligned hour', async () => {
    const result = await provider().getEnergySeries(
      request('hourly', '2026-06-21T12:30:00Z', '2026-06-21T14:10:00Z'),
    );
    expect(result.items.map((i) => i.start)).toEqual([
      '2026-06-21T12:00:00Z',
      '2026-06-21T13:00:00Z',
      '2026-06-21T14:00:00Z',
    ]);
  });

  it('daily: buckets are local calendar days, labelled with their localDate', async () => {
    const result = await provider().getEnergySeries(
      request('daily', '2026-06-20T23:00:00Z', '2026-06-22T23:00:00Z'),
    );
    expect(result.items.map((i) => i.localDate)).toEqual(['2026-06-21', '2026-06-22']);
    expect(result.items[0]?.start).toBe('2026-06-20T23:00:00Z');
    expect(result.items[0]?.end).toBe('2026-06-21T23:00:00Z');
    expect(result.items[0]?.completeness).toBe(1);
  });

  it('daily: the day the clocks go back has 25 hours of data, not 24', async () => {
    const result = await provider().getEnergySeries(
      request('daily', '2026-10-24T23:00:00Z', '2026-10-25T23:30:00Z'),
    );
    const day = result.items.find((i) => i.localDate === '2026-10-25');
    expect(day?.start).toBe('2026-10-24T23:00:00Z');
    expect(day?.end).toBe('2026-10-26T00:00:00Z');
    expect((Date.parse(day?.end ?? '') - Date.parse(day?.start ?? '')) / 3_600_000).toBe(25);
    expect(day?.completeness).toBe(1);
    // 25 hours of 15-minute intervals feed the bucket.
    const intervals = await provider().getEnergySeries(
      request('interval', day?.start ?? '', day?.end ?? ''),
    );
    expect(intervals.items).toHaveLength(100);
    const sum = intervals.items.reduce((s, i) => s + (i.homeConsumedWh ?? 0), 0);
    expect(day?.homeConsumedWh).toBeCloseTo(sum, 0);
  });

  it('daily: the day the clocks go forward has 23 hours', async () => {
    const result = await provider().getEnergySeries(
      request('daily', '2026-03-29T00:00:00Z', '2026-03-29T12:00:00Z'),
    );
    const day = result.items.find((i) => i.localDate === '2026-03-29');
    expect((Date.parse(day?.end ?? '') - Date.parse(day?.start ?? '')) / 3_600_000).toBe(23);
  });

  it('daily depends on the zone: the same instants fall in different local days elsewhere', async () => {
    const dublin = await provider().getEnergySeries(
      request('daily', '2026-06-21T00:00:00Z', '2026-06-21T01:00:00Z', 'Europe/Dublin'),
    );
    const auckland = await provider().getEnergySeries(
      request('daily', '2026-06-21T00:00:00Z', '2026-06-21T01:00:00Z', 'Pacific/Auckland'),
    );
    expect(dublin.items[0]?.localDate).toBe('2026-06-21');
    expect(auckland.items[0]?.localDate).toBe('2026-06-21');
    expect(dublin.items[0]?.start).not.toBe(auckland.items[0]?.start);
  });

  it('is deterministic', async () => {
    const r = request('daily', '2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z');
    expect(await provider().getEnergySeries(r)).toEqual(await provider().getEnergySeries(r));
  });

  it('rejects an unknown timezone, a bad range, an oversize range and out-of-world ranges', async () => {
    const p = provider();
    expect(
      await errorCodeOf(
        p.getEnergySeries(
          request('daily', '2026-06-21T00:00:00Z', '2026-06-22T00:00:00Z', 'Not/AZone'),
        ),
      ),
    ).toBe('INVALID_REQUEST');
    expect(
      await errorCodeOf(
        p.getEnergySeries(request('daily', '2026-06-22T00:00:00Z', '2026-06-21T00:00:00Z')),
      ),
    ).toBe('RANGE_INVALID');
    expect(
      await errorCodeOf(
        p.getEnergySeries(request('interval', '2026-06-01T00:00:00Z', '2026-09-01T00:00:00Z')),
      ),
    ).toBe('RANGE_TOO_LARGE');
    expect(
      await errorCodeOf(
        p.getEnergySeries(request('daily', '2025-12-30T00:00:00Z', '2026-01-02T00:00:00Z')),
      ),
    ).toBe('OUT_OF_COVERAGE');
    expect(
      await errorCodeOf(
        p.getEnergySeries(request('hourly', '2030-12-31T00:00:00Z', '2031-01-02T00:00:00Z')),
      ),
    ).toBe('OUT_OF_COVERAGE');
  });
});

describe('errors', () => {
  it('carry a code and a short message, and no data', () => {
    const error = new TelemetryProviderError('RATE_LIMITED', 'try later');
    expect(error.name).toBe('TelemetryProviderError');
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toBe('try later');
    expect(error).toBeInstanceOf(Error);
  });
});
