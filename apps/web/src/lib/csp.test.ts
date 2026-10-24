/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withConnectSrc } from './csp';

const HEADERS = readFileSync(join(import.meta.dirname, '..', '..', 'public', '_headers'), 'utf8');

describe('withConnectSrc', () => {
  it('leaves the headers alone when there is no origin (demo mode)', () => {
    expect(withConnectSrc(HEADERS, null)).toBe(HEADERS);
  });

  it('adds the Supabase origin to connect-src and changes nothing else', () => {
    const out = withConnectSrc(HEADERS, 'https://example-project.supabase.co');
    expect(out).toContain("connect-src 'self' https://example-project.supabase.co;");
    expect(out.replace(' https://example-project.supabase.co', '')).toBe(HEADERS);
  });

  it('is idempotent', () => {
    const once = withConnectSrc(HEADERS, 'https://example-project.supabase.co');
    expect(withConnectSrc(once, 'https://example-project.supabase.co')).toBe(once);
  });

  it('keeps script-src and default-src strict', () => {
    const out = withConnectSrc(HEADERS, 'https://example-project.supabase.co');
    expect(out).toContain("default-src 'self';");
    expect(out).toContain("script-src 'self';");
    expect(out).not.toContain("'unsafe-inline'");
    expect(out).not.toContain("'unsafe-eval'");
  });

  it('rejects an origin that could change other directives', () => {
    for (const bad of [
      'https://x.supabase.co; script-src *',
      'https://x.supabase.co/path',
      'javascript:alert(1)',
      'https://',
      '',
    ]) {
      expect(() => withConnectSrc(HEADERS, bad)).toThrow();
    }
  });

  it('fails loudly if the policy has nothing to extend', () => {
    expect(() => withConnectSrc("default-src 'self'", 'https://x.supabase.co')).toThrow(
      /connect-src/,
    );
  });
});
