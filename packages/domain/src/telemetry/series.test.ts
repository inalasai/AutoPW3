import { describe, expect, it } from 'vitest';
import {
  coverageFraction,
  dedupeBySampledAt,
  detectGaps,
  detectGapsInRange,
  sortBySampledAt,
} from './series';
import type { DedupeKey } from './series';

function at(minute: number): string {
  return new Date(Date.UTC(2026, 5, 21, 12, minute)).toISOString().replace('.000Z', 'Z');
}

function sample(
  minute: number,
  extra: Partial<DedupeKey> & { tag?: string } = {},
): DedupeKey & { tag: string } {
  return {
    sampledAt: at(minute),
    receivedAt: at(minute),
    quality: 'OK',
    tag: `m${minute}`,
    ...extra,
  };
}

describe('sortBySampledAt', () => {
  it('orders by instant and returns a new array', () => {
    const input = [sample(10), sample(0), sample(5)];
    const sorted = sortBySampledAt(input);
    expect(sorted.map((s) => s.tag)).toEqual(['m0', 'm5', 'm10']);
    expect(input.map((s) => s.tag)).toEqual(['m10', 'm0', 'm5']);
  });

  it('orders by instant, not by text, when offsets differ', () => {
    const a = { sampledAt: '2026-06-21T13:30:00+01:00' }; // 12:30Z
    const b = { sampledAt: '2026-06-21T12:10:00Z' };
    expect(sortBySampledAt([a, b])).toEqual([b, a]);
  });

  it('is stable for equal instants and puts unreadable instants last', () => {
    const x = { sampledAt: at(0), id: 'x' };
    const y = { sampledAt: at(0), id: 'y' };
    const bad = { sampledAt: 'garbage', id: 'bad' };
    expect(sortBySampledAt([bad, y, x]).map((s) => s.id)).toEqual(['y', 'x', 'bad']);
  });
});

describe('dedupeBySampledAt', () => {
  it('keeps one sample per instant, in time order, and counts what it dropped', () => {
    const { items, dropped } = dedupeBySampledAt([sample(5), sample(0), sample(5)]);
    expect(items.map((s) => s.sampledAt)).toEqual([at(0), at(5)]);
    expect(dropped).toBe(1);
  });

  it('prefers the later delivery (receivedAt)', () => {
    const early = sample(5, { receivedAt: at(6), tag: 'early' });
    const late = sample(5, { receivedAt: at(9), tag: 'late' });
    expect(dedupeBySampledAt([late, early]).items[0]?.tag).toBe('late');
    expect(dedupeBySampledAt([early, late]).items[0]?.tag).toBe('late');
  });

  it('on equal receipt prefers the better quality', () => {
    const suspect = sample(5, { quality: 'SUSPECT', tag: 'suspect' });
    const partial = sample(5, { quality: 'PARTIAL', tag: 'partial' });
    const ok = sample(5, { quality: 'OK', tag: 'ok' });
    expect(dedupeBySampledAt([suspect, partial, ok]).items[0]?.tag).toBe('ok');
    expect(dedupeBySampledAt([ok, partial, suspect]).items[0]?.tag).toBe('ok');
  });

  it('on a complete tie keeps the one later in the input', () => {
    const a = sample(5, { tag: 'first' });
    const b = sample(5, { tag: 'second' });
    expect(dedupeBySampledAt([a, b]).items[0]?.tag).toBe('second');
  });

  it('treats the same instant written with different offsets as a duplicate', () => {
    const utc = sample(0, { tag: 'utc' });
    const offset = {
      ...sample(0, { tag: 'offset' }),
      sampledAt: '2026-06-21T13:00:00+01:00',
      receivedAt: at(1),
    };
    const { items, dropped } = dedupeBySampledAt([utc, offset]);
    expect(dropped).toBe(1);
    expect(items[0]?.tag).toBe('offset');
  });

  it('does nothing to a clean series', () => {
    const clean = [sample(0), sample(5), sample(10)];
    expect(dedupeBySampledAt(clean)).toEqual({ items: clean, dropped: 0 });
  });
});

describe('detectGaps (samples expected every 5 minutes)', () => {
  const options = { expectedIntervalSeconds: 300 };

  it('finds nothing in a regular series', () => {
    expect(detectGaps([sample(0), sample(5), sample(10), sample(15)], options)).toEqual([]);
  });

  it('allows up to twice the interval by default (a single missed sample is not a gap)', () => {
    expect(detectGaps([sample(0), sample(10)], options)).toEqual([]); // 600 s = 2 x 300
  });

  it('reports a spacing above the allowance as a half-open gap with a count of missing samples', () => {
    const gaps = detectGaps([sample(0), sample(5), sample(20), sample(25)], options);
    expect(gaps).toEqual([{ from: at(5), to: at(20), seconds: 900, missingSamples: 2 }]);
  });

  it('flags a spacing one second over the allowance', () => {
    const justOver = [{ sampledAt: '2026-06-21T12:00:00Z' }, { sampledAt: '2026-06-21T12:10:01Z' }];
    expect(detectGaps(justOver, options)).toHaveLength(1);
  });

  it('honours a custom allowance', () => {
    expect(detectGaps([sample(0), sample(20)], { ...options, maxGapSeconds: 1800 })).toEqual([]);
  });

  it('does not need sorted input and ignores duplicates', () => {
    expect(detectGaps([sample(25), sample(0), sample(0), sample(5)], options)).toEqual([
      { from: at(5), to: at(25), seconds: 1200, missingSamples: 3 },
    ]);
  });

  it('returns nothing for zero or one sample', () => {
    expect(detectGaps([], options)).toEqual([]);
    expect(detectGaps([sample(0)], options)).toEqual([]);
  });

  it('rejects options that make no sense', () => {
    expect(() => detectGaps([], { expectedIntervalSeconds: 0 })).toThrow(RangeError);
    expect(() => detectGaps([], { expectedIntervalSeconds: -5 })).toThrow(RangeError);
    expect(() => detectGaps([], { expectedIntervalSeconds: 300, maxGapSeconds: 100 })).toThrow(
      RangeError,
    );
  });
});

describe('detectGapsInRange', () => {
  const options = { expectedIntervalSeconds: 300 };
  const range = { from: at(0), to: at(60) };

  it('with no samples the whole range is one gap', () => {
    expect(detectGapsInRange([], range, options)).toEqual([
      { from: at(0), to: at(60), seconds: 3600, missingSamples: 11 },
    ]);
  });

  it('finds a leading gap when the first sample starts late', () => {
    const samples = [sample(30), sample(35), sample(40), sample(45), sample(50), sample(55)];
    expect(detectGapsInRange(samples, range, options)).toEqual([
      { from: at(0), to: at(30), seconds: 1800, missingSamples: 5 },
    ]);
  });

  it('finds a trailing gap when the last sample stops early', () => {
    const samples = [sample(0), sample(5), sample(10), sample(15)];
    expect(detectGapsInRange(samples, range, options)).toEqual([
      { from: at(20), to: at(60), seconds: 2400, missingSamples: 7 },
    ]);
  });

  it('has no gap for a complete range, and counts samples outside the range as nothing', () => {
    const samples = Array.from({ length: 12 }, (_, i) => sample(i * 5));
    expect(detectGapsInRange(samples, range, options)).toEqual([]);
    expect(detectGapsInRange([sample(-10), sample(90)], range, options)).toHaveLength(1);
  });

  it('rejects a range that does not end after it starts', () => {
    expect(() => detectGapsInRange([], { from: at(10), to: at(10) }, options)).toThrow(RangeError);
    expect(() => detectGapsInRange([], { from: 'x', to: at(10) }, options)).toThrow(RangeError);
  });
});

describe('coverageFraction', () => {
  const options = { expectedIntervalSeconds: 300 };
  const range = { from: at(0), to: at(60) };

  it('is 1 for a complete series', () => {
    const samples = Array.from({ length: 12 }, (_, i) => sample(i * 5));
    expect(coverageFraction(samples, range, options)).toBe(1);
  });

  it('is 0 with no samples', () => {
    expect(coverageFraction([], range, options)).toBe(0);
  });

  it('holds the last value across a spacing within the allowance', () => {
    // 0, 10, 20 ... every 10 minutes: each covers 10 minutes (<= 600 s), the last covers 5.
    const samples = [0, 10, 20, 30, 40, 50].map((m) => sample(m));
    // covered = 5 x 600 s + 300 s = 3300 s of 3600 s
    expect(coverageFraction(samples, range, options)).toBeCloseTo(3300 / 3600, 10);
  });

  it('leaves a larger gap uncovered: a sample then covers only its own interval', () => {
    // 0..15 (4 samples, covering to :20) then nothing until :40..:55 (4 samples, covering to :60)
    const samples = [0, 5, 10, 15, 40, 45, 50, 55].map((m) => sample(m));
    expect(coverageFraction(samples, range, options)).toBeCloseTo((1200 + 1200) / 3600, 10);
  });

  it('clips to the range and never exceeds 1', () => {
    const samples = [sample(-5), ...Array.from({ length: 14 }, (_, i) => sample(i * 5))];
    expect(coverageFraction(samples, range, options)).toBe(1);
  });

  it('ignores duplicates', () => {
    expect(coverageFraction([sample(0), sample(0)], range, options)).toBeCloseTo(300 / 3600, 10);
  });
});
