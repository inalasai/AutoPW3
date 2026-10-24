import { DemoLiveReadingSchema, LiveReadingSchema } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../clock';
import {
  DEFAULT_STALE_AFTER_SECONDS,
  freshnessOf,
  toDemoLiveReading,
  toLiveReading,
} from './freshness';
import { normalisePowerReading } from './normalise';

const SAMPLED = '2026-06-21T12:00:00Z';
const sampledMs = Date.parse(SAMPLED);
const nowPlus = (seconds: number): Date => new Date(sampledMs + seconds * 1000);

describe('freshnessOf (default threshold 3600 s)', () => {
  it('uses one hour by default', () => {
    expect(DEFAULT_STALE_AFTER_SECONDS).toBe(3600);
  });

  it('is FRESH with the age in whole seconds', () => {
    expect(freshnessOf(SAMPLED, nowPlus(20))).toEqual({ ageSeconds: 20, freshness: 'FRESH' });
    expect(freshnessOf(SAMPLED, new Date(sampledMs + 20_900))).toEqual({
      ageSeconds: 20,
      freshness: 'FRESH',
    });
  });

  it('is still FRESH at exactly the threshold and STALE one second later', () => {
    expect(freshnessOf(SAMPLED, nowPlus(3600))).toEqual({ ageSeconds: 3600, freshness: 'FRESH' });
    expect(freshnessOf(SAMPLED, nowPlus(3601))).toEqual({ ageSeconds: 3601, freshness: 'STALE' });
  });

  it('is STALE for a very old reading', () => {
    expect(freshnessOf(SAMPLED, nowPlus(7 * 86_400)).freshness).toBe('STALE');
  });

  it('has a configurable threshold', () => {
    expect(freshnessOf(SAMPLED, nowPlus(120), { staleAfterSeconds: 60 }).freshness).toBe('STALE');
    expect(freshnessOf(SAMPLED, nowPlus(60), { staleAfterSeconds: 60 }).freshness).toBe('FRESH');
    expect(freshnessOf(SAMPLED, nowPlus(7200), { staleAfterSeconds: 86_400 }).freshness).toBe(
      'FRESH',
    );
  });

  it('is UNAVAILABLE with no timestamp or an unreadable one, and has no age', () => {
    expect(freshnessOf(null, nowPlus(0))).toEqual({ ageSeconds: null, freshness: 'UNAVAILABLE' });
    expect(freshnessOf('garbage', nowPlus(0))).toEqual({
      ageSeconds: null,
      freshness: 'UNAVAILABLE',
    });
  });

  it('accepts a timestamp a little ahead of now (clock skew) as age 0', () => {
    expect(freshnessOf(SAMPLED, nowPlus(-60))).toEqual({ ageSeconds: 0, freshness: 'FRESH' });
    expect(freshnessOf(SAMPLED, nowPlus(-120))).toEqual({ ageSeconds: 0, freshness: 'FRESH' });
  });

  it('will not call a reading from the future fresh', () => {
    expect(freshnessOf(SAMPLED, nowPlus(-121))).toEqual({
      ageSeconds: 0,
      freshness: 'UNAVAILABLE',
    });
    expect(freshnessOf(SAMPLED, nowPlus(-3600), { maxFutureSkewSeconds: 7200 }).freshness).toBe(
      'FRESH',
    );
  });

  it('rejects settings that make no sense', () => {
    expect(() => freshnessOf(SAMPLED, nowPlus(0), { staleAfterSeconds: 0 })).toThrow(RangeError);
    expect(() => freshnessOf(SAMPLED, nowPlus(0), { staleAfterSeconds: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => freshnessOf(SAMPLED, nowPlus(0), { maxFutureSkewSeconds: -1 })).toThrow(
      RangeError,
    );
    expect(() => freshnessOf(SAMPLED, new Date('nope'))).toThrow(RangeError);
  });

  it('follows an injected clock, so tests never depend on real time', () => {
    const clock = new FixedClock(new Date(sampledMs));
    expect(freshnessOf(SAMPLED, clock.now()).freshness).toBe('FRESH');
    clock.advanceMs(3_601_000);
    expect(freshnessOf(SAMPLED, clock.now()).freshness).toBe('STALE');
  });
});

describe('live readings', () => {
  const { sample } = normalisePowerReading(
    {
      sampledAt: SAMPLED,
      solarPowerW: 1000,
      batteryPowerW: 0,
      gridPowerW: 500,
      loadPowerW: 1500,
      batterySocPercent: 80,
    },
    { source: 'DEMO', receivedAt: SAMPLED },
  );

  it('adds age and freshness and still validates against the shared schema', () => {
    const reading = toDemoLiveReading(sample, nowPlus(30));
    expect(reading).toMatchObject({ ageSeconds: 30, freshness: 'FRESH', source: 'DEMO' });
    expect(DemoLiveReadingSchema.safeParse(reading).success).toBe(true);
    expect(LiveReadingSchema.safeParse(reading).success).toBe(true);
  });

  it('marks an old demo reading STALE', () => {
    expect(toDemoLiveReading(sample, nowPlus(12_600)).freshness).toBe('STALE');
  });

  it('keeps the source of a general sample', () => {
    const reading = toLiveReading(sample, nowPlus(5));
    expect(reading.source).toBe('DEMO');
    expect(reading.ageSeconds).toBe(5);
  });
});
