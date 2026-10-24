/**
 * Deterministic pseudo-randomness for the demo fixtures. There is no generator state: every value is a pure
 * hash of `(seed, a, b)`, so any instant can be computed on its own, in any order, with identical results, and
 * nothing depends on call order or on `Math.random()` (forbidden in packages/domain).
 */

function mix(input: number): number {
  let h = input | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A 32-bit unsigned integer derived from the three inputs. */
export function hash32(seed: number, a: number, b = 0): number {
  return mix(mix((seed | 0) + Math.imul(a | 0, 0x9e3779b1)) + Math.imul(b | 0, 0x85ebca77));
}

/** A number in `[0, 1)` derived from the three inputs. */
export function unit(seed: number, a: number, b = 0): number {
  return hash32(seed, a, b) / 4_294_967_296;
}

/** 32-bit FNV-1a over a string, as 8 lowercase hex digits. Used to fingerprint datasets in tests. */
export function fnv1a32Hex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
