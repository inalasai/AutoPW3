import type { PricePoint } from '@autopw3/shared';
import { describe, expect, it } from 'vitest';
import { findPricePoint, indexPricePoints, pricePointsOverlapping } from './observations';
import { ms } from './test-helpers';

function point(start: string, end: string, rate: string): PricePoint {
  return { intervalStart: start, intervalEnd: end, ratePerKwh: rate };
}

const THREE: PricePoint[] = [
  point('2026-01-15T00:30:00Z', '2026-01-15T01:00:00Z', '0.200000'),
  point('2026-01-15T00:00:00Z', '2026-01-15T00:30:00Z', '0.100000'),
  // 01:00 to 01:30 is missing on purpose
  point('2026-01-15T01:30:00Z', '2026-01-15T02:00:00Z', '0.300000'),
];

describe('indexPricePoints', () => {
  it('sorts the points of each tariff by start and reports no overlap for clean data', () => {
    const idx = indexPricePoints([{ tariffId: 'a', pricePoints: THREE }]);
    expect(idx.points.get('a')?.map((p) => p.ratePerKwh)).toEqual([
      '0.100000',
      '0.200000',
      '0.300000',
    ]);
    expect(idx.overlapping.size).toBe(0);
  });

  it('remembers tariffs whose points overlap', () => {
    const idx = indexPricePoints([
      {
        tariffId: 'a',
        pricePoints: [
          point('2026-01-15T00:00:00Z', '2026-01-15T01:00:00Z', '0.1'),
          point('2026-01-15T00:30:00Z', '2026-01-15T01:30:00Z', '0.2'),
        ],
      },
      { tariffId: 'b', pricePoints: THREE },
    ]);
    expect([...idx.overlapping]).toEqual(['a']);
  });

  it('merges entries given twice for one tariff', () => {
    const idx = indexPricePoints([
      { tariffId: 'a', pricePoints: [THREE[1] as PricePoint] },
      { tariffId: 'a', pricePoints: [THREE[0] as PricePoint] },
    ]);
    expect(idx.points.get('a')).toHaveLength(2);
  });

  it('refuses an unreadable or empty interval', () => {
    expect(() =>
      indexPricePoints([
        { tariffId: 'a', pricePoints: [point('not a time', '2026-01-15T01:00:00Z', '0.1')] },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      indexPricePoints([
        {
          tariffId: 'a',
          pricePoints: [point('2026-01-15T01:00:00Z', '2026-01-15T01:00:00Z', '0.1')],
        },
      ]),
    ).toThrow(RangeError);
  });
});

describe('findPricePoint: half-open intervals', () => {
  const idx = indexPricePoints([{ tariffId: 'a', pricePoints: THREE }]);
  const at = (iso: string) => findPricePoint(idx, 'a', ms(iso));

  it('includes the start instant and excludes the end instant', () => {
    expect(at('2026-01-15T00:00:00Z')).toMatchObject({
      kind: 'POINT',
      point: { ratePerKwh: '0.100000' },
    });
    expect(at('2026-01-15T00:29:59.999Z')).toMatchObject({
      kind: 'POINT',
      point: { ratePerKwh: '0.100000' },
    });
    expect(at('2026-01-15T00:30:00Z')).toMatchObject({
      kind: 'POINT',
      point: { ratePerKwh: '0.200000' },
    });
    expect(at('2026-01-15T00:59:59.999Z')).toMatchObject({
      kind: 'POINT',
      point: { ratePerKwh: '0.200000' },
    });
  });

  it('finds nothing in a hole, before the first point and from the last end onwards', () => {
    expect(at('2026-01-15T01:00:00Z')).toEqual({ kind: 'NONE' });
    expect(at('2026-01-15T01:29:59.999Z')).toEqual({ kind: 'NONE' });
    expect(at('2026-01-14T23:59:59.999Z')).toEqual({ kind: 'NONE' });
    expect(at('2026-01-15T02:00:00Z')).toEqual({ kind: 'NONE' });
  });

  it('finds nothing for an unknown tariff or when no observations were given', () => {
    expect(findPricePoint(idx, 'zzz', ms('2026-01-15T00:00:00Z'))).toEqual({ kind: 'NONE' });
    expect(findPricePoint(undefined, 'a', ms('2026-01-15T00:00:00Z'))).toEqual({ kind: 'NONE' });
  });

  it('reports ambiguity inside an overlap and still answers outside it', () => {
    const overlapping = indexPricePoints([
      {
        tariffId: 'a',
        pricePoints: [
          point('2026-01-15T00:00:00Z', '2026-01-15T01:00:00Z', '0.1'),
          point('2026-01-15T00:30:00Z', '2026-01-15T01:30:00Z', '0.2'),
        ],
      },
    ]);
    expect(findPricePoint(overlapping, 'a', ms('2026-01-15T00:15:00Z'))).toMatchObject({
      kind: 'POINT',
    });
    expect(findPricePoint(overlapping, 'a', ms('2026-01-15T00:45:00Z'))).toEqual({
      kind: 'AMBIGUOUS',
    });
    expect(findPricePoint(overlapping, 'a', ms('2026-01-15T01:15:00Z'))).toMatchObject({
      kind: 'POINT',
    });
    expect(findPricePoint(overlapping, 'a', ms('2026-01-15T01:30:00Z'))).toEqual({ kind: 'NONE' });
  });
});

describe('pricePointsOverlapping', () => {
  const idx = indexPricePoints([{ tariffId: 'a', pricePoints: THREE }]);

  it('lists the points that touch a range, treating ends as exclusive', () => {
    const hits = pricePointsOverlapping(
      idx,
      'a',
      ms('2026-01-15T00:30:00Z'),
      ms('2026-01-15T01:00:00Z'),
    );
    expect(hits.map((p) => p.ratePerKwh)).toEqual(['0.200000']);
    expect(pricePointsOverlapping(idx, 'zzz', 0, 10)).toEqual([]);
    expect(pricePointsOverlapping(undefined, 'a', 0, 10)).toEqual([]);
  });
});
