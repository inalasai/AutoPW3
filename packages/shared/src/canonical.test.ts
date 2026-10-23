import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';

describe('canonicalJson', () => {
  it('sorts keys at every depth and removes whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2], c: true } })).toBe(
      '{"a":{"c":true,"d":[3,2]},"b":1}',
    );
  });

  it('gives the same text for equal bodies regardless of key order', () => {
    const one = canonicalJson({ kind: 'SET_BACKUP_RESERVE', params: { backupReservePercent: 30 } });
    const two = canonicalJson({ params: { backupReservePercent: 30 }, kind: 'SET_BACKUP_RESERVE' });
    expect(one).toBe(two);
  });

  it('gives different text when a value differs (same key, different body is a conflict)', () => {
    expect(canonicalJson({ a: 30 })).not.toBe(canonicalJson({ a: 31 }));
    expect(canonicalJson({ a: '30' })).not.toBe(canonicalJson({ a: 30 }));
  });

  it('omits undefined properties like JSON does, keeps null, and keeps array order', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
    expect(canonicalJson([2, 1])).toBe('[2,1]');
  });

  it('escapes strings exactly as JSON does', () => {
    expect(canonicalJson({ 'a"b': 'line\nbreak' })).toBe('{"a\\"b":"line\\nbreak"}');
  });

  it('refuses values JSON cannot represent', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson(10n)).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
    expect(() => canonicalJson(new Date(0))).toThrow(TypeError);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });
});
