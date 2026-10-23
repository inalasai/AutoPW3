/**
 * Canonical JSON: one stable text form of a JSON value, so two equal bodies always produce the same text.
 * Used for `params_hash` (SHA-256 of the canonical command params) and for the idempotency rule "same key and the
 * same body replays; same key and a different body is 409". Hashing itself happens in the caller (Worker or domain)
 * with Web Crypto; this file only builds the text.
 *
 * Rules: object keys sorted by UTF-16 code unit, no whitespace, `undefined` properties omitted (as JSON does),
 * numbers must be finite. Anything JSON cannot represent throws a TypeError instead of being silently dropped.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: number must be finite');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError('canonicalJson: only plain objects and arrays are supported');
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const item = record[key];
        if (item === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
  }
}
