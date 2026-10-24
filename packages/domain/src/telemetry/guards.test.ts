import { PersistedPowerSampleSchema } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { demoDay } from '../fixtures/datasets';
import {
  DemoDataInLivePathError,
  acceptForLiveIngestion,
  assertLiveSource,
  requireLiveSamples,
  selectAccountableSamples,
} from './guards';
import { normalisePowerReading } from './normalise';
import type { DemoPowerSample, LivePowerSample } from './types';

const raw = {
  sampledAt: '2026-06-21T12:00:00Z',
  solarPowerW: 3000,
  batteryPowerW: -1000,
  gridPowerW: -500,
  loadPowerW: 1500,
  batterySocPercent: 50,
};

function live(overrides: Partial<LivePowerSample> = {}): LivePowerSample {
  const { sample } = normalisePowerReading(raw, { source: 'TESLA', receivedAt: raw.sampledAt });
  return { ...sample, source: 'TESLA', ...overrides };
}

const demo: DemoPowerSample = normalisePowerReading(raw, {
  source: 'DEMO',
  receivedAt: raw.sampledAt,
}).sample;

describe('demo data cannot reach a live path', () => {
  it('is a compile error to pass demo samples to a live-accounting function', () => {
    // The directive below is the proof: if the types ever allowed this, `tsc` (npm run typecheck) would fail
    // with "unused @ts-expect-error". The runtime assertion in the next test covers the untyped case.
    expect(() =>
      // @ts-expect-error DemoPowerSample has source 'DEMO'; live accounting accepts source 'TESLA' only
      selectAccountableSamples([demo]),
    ).toThrow(DemoDataInLivePathError);
  });

  it('is a compile error for the broad PowerSample type too (it may be demo)', () => {
    const maybeDemo: Array<LivePowerSample | DemoPowerSample> = [live(), demo];
    expect(() =>
      // @ts-expect-error a union that includes DEMO is not accepted
      requireLiveSamples(maybeDemo, 'test'),
    ).toThrow(DemoDataInLivePathError);
  });

  it('is a compile error to hand a demo sample to live ingestion', () => {
    expect(() =>
      // @ts-expect-error DemoPowerSample is not a LivePowerSample
      acceptForLiveIngestion(demo),
    ).toThrow(DemoDataInLivePathError);
  });

  it('is also refused at runtime when types are gone: JSON, a cast, or any', () => {
    const fromJson = JSON.parse(JSON.stringify([demo])) as LivePowerSample[];
    expect(() => selectAccountableSamples(fromJson)).toThrow(DemoDataInLivePathError);
    expect(() => requireLiveSamples(fromJson, 'ingestion')).toThrow(DemoDataInLivePathError);
    expect(() => acceptForLiveIngestion(fromJson[0] as LivePowerSample)).toThrow(
      DemoDataInLivePathError,
    );
  });

  it('refuses one demo sample hidden among thousands of live ones', () => {
    const many = Array.from({ length: 5000 }, () => live());
    many[4321] = demo as unknown as LivePowerSample;
    expect(() => selectAccountableSamples(many)).toThrow(DemoDataInLivePathError);
  });

  it('refuses a missing, unknown or differently cased source', () => {
    for (const source of [undefined, null, '', 'demo', 'Tesla', 'MOCK', 'TESLA ']) {
      expect(() => assertLiveSource({ source }, 'test')).toThrow(DemoDataInLivePathError);
    }
    expect(() => assertLiveSource({ source: 'TESLA' }, 'test')).not.toThrow();
  });

  it('names the path in the error and carries no sample data', () => {
    try {
      requireLiveSamples([demo] as unknown as LivePowerSample[], 'rollup');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DemoDataInLivePathError);
      const e = error as DemoDataInLivePathError;
      expect(e.code).toBe('DEMO_DATA_IN_LIVE_PATH');
      expect(e.path).toBe('rollup');
      expect(e.message).toContain('rollup');
      expect(e.message).not.toContain('3000');
    }
  });

  it('refuses every sample of every demo dataset', () => {
    const day = demoDay();
    expect(() => selectAccountableSamples(day.power as unknown as LivePowerSample[])).toThrow(
      DemoDataInLivePathError,
    );
  });

  it('matches the persisted schema, which also rejects DEMO (the database CHECK is the third layer)', () => {
    expect(PersistedPowerSampleSchema.safeParse(demo).success).toBe(false);
    expect(PersistedPowerSampleSchema.safeParse(live()).success).toBe(true);
  });
});

describe('live samples pass the gates', () => {
  it('requireLiveSamples returns the same array', () => {
    const samples = [live(), live()];
    expect(requireLiveSamples(samples, 'test')).toBe(samples);
  });

  it('acceptForLiveIngestion returns a validated sample and rejects a malformed one', () => {
    expect(acceptForLiveIngestion(live()).source).toBe('TESLA');
    expect(() => acceptForLiveIngestion(live({ batterySocPercent: 130 }))).toThrow();
  });

  it('accounting leaves SUSPECT samples out and says how many', () => {
    const samples = [live(), live({ quality: 'SUSPECT' }), live({ quality: 'PARTIAL' })];
    const { accountable, excludedSuspect } = selectAccountableSamples(samples);
    expect(accountable.map((s) => s.quality)).toEqual(['OK', 'PARTIAL']);
    expect(excludedSuspect).toBe(1);
  });

  it('accepts an empty list', () => {
    expect(selectAccountableSamples([])).toEqual({ accountable: [], excludedSuspect: 0 });
  });
});
