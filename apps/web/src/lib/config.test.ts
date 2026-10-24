import { describe, expect, it } from 'vitest';
import { looksLikePrivilegedKey, parseSupabaseUrl, readConfig } from './config';

/** Build a fake JWT (header.payload.signature) with the given claims. Not a real key. */
function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

const LIVE = {
  VITE_DEMO_MODE: 'false',
  VITE_SUPABASE_URL: 'https://example-project.supabase.co',
  VITE_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon' }),
};

describe('readConfig: demo mode', () => {
  it('defaults to demo mode when nothing is set', () => {
    expect(readConfig({}).demoMode).toBe(true);
  });

  it('stays in demo mode for any value except an explicit "false"', () => {
    expect(readConfig({ VITE_DEMO_MODE: 'true' }).demoMode).toBe(true);
    expect(readConfig({ VITE_DEMO_MODE: '' }).demoMode).toBe(true);
    expect(readConfig({ VITE_DEMO_MODE: 'no' }).demoMode).toBe(true);
  });

  it('leaves demo mode only on an explicit "false"', () => {
    expect(readConfig({ VITE_DEMO_MODE: 'false' }).demoMode).toBe(false);
  });

  it('needs no sign-in in demo mode, even if Supabase variables are present', () => {
    expect(readConfig({ ...LIVE, VITE_DEMO_MODE: 'true' }).auth).toEqual({ kind: 'none' });
  });
});

describe('readConfig: live sign-in', () => {
  it('uses Supabase when the URL and the public key are set', () => {
    const { auth } = readConfig(LIVE);
    expect(auth).toEqual({
      kind: 'supabase',
      url: 'https://example-project.supabase.co',
      anonKey: LIVE.VITE_SUPABASE_ANON_KEY,
    });
  });

  it('reduces the URL to its origin', () => {
    const { auth } = readConfig({
      ...LIVE,
      VITE_SUPABASE_URL: 'https://example-project.supabase.co/rest/v1/',
    });
    expect(auth).toMatchObject({ kind: 'supabase', url: 'https://example-project.supabase.co' });
  });

  it('is invalid, with a reason that names variables and never shows their values', () => {
    for (const env of [
      { VITE_DEMO_MODE: 'false' },
      { ...LIVE, VITE_SUPABASE_URL: '' },
      { ...LIVE, VITE_SUPABASE_ANON_KEY: '' },
      { ...LIVE, VITE_SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co' },
      { ...LIVE, VITE_SUPABASE_ANON_KEY: 'YOUR_VALUE_HERE' },
    ]) {
      const { auth } = readConfig(env);
      expect(auth.kind).toBe('invalid');
      if (auth.kind === 'invalid') {
        expect(auth.reason).toContain('VITE_SUPABASE_URL');
        expect(auth.reason).not.toContain(LIVE.VITE_SUPABASE_ANON_KEY);
      }
    }
  });

  it('refuses a plain http URL unless it is this machine', () => {
    expect(readConfig({ ...LIVE, VITE_SUPABASE_URL: 'http://example.com' }).auth.kind).toBe(
      'invalid',
    );
    expect(readConfig({ ...LIVE, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }).auth).toMatchObject(
      { kind: 'supabase', url: 'http://127.0.0.1:54321' },
    );
    expect(readConfig({ ...LIVE, VITE_SUPABASE_URL: 'http://localhost:54321' }).auth.kind).toBe(
      'supabase',
    );
  });

  it('refuses a privileged key in the browser variable (stop condition: no service-role key in browser code)', () => {
    for (const key of [fakeJwt({ role: 'service_role' }), 'sb_secret_abcdef0123456789']) {
      const { auth } = readConfig({ ...LIVE, VITE_SUPABASE_ANON_KEY: key });
      expect(auth.kind).toBe('invalid');
      if (auth.kind === 'invalid') {
        expect(auth.reason).toContain('privileged');
        expect(auth.reason).not.toContain(key);
      }
    }
  });

  it('accepts the new publishable key format', () => {
    expect(
      readConfig({ ...LIVE, VITE_SUPABASE_ANON_KEY: 'sb_publishable_abcdef0123456789' }).auth.kind,
    ).toBe('supabase');
  });
});

describe('readConfig: mock sign-in', () => {
  const MOCK = { VITE_DEMO_MODE: 'false', VITE_AUTH_MODE: 'mock' };

  it('is allowed in a development build', () => {
    expect(readConfig(MOCK, { isDev: true }).auth).toEqual({ kind: 'mock' });
  });

  it('is refused in a production build', () => {
    const { auth } = readConfig(MOCK, { isDev: false });
    expect(auth.kind).toBe('invalid');
    expect(readConfig(MOCK).auth.kind).toBe('invalid');
  });

  it('does nothing in demo mode', () => {
    expect(readConfig({ VITE_AUTH_MODE: 'mock' }, { isDev: true }).auth).toEqual({ kind: 'none' });
  });
});

describe('looksLikePrivilegedKey and parseSupabaseUrl', () => {
  it('recognises privileged keys and not public ones', () => {
    expect(looksLikePrivilegedKey(fakeJwt({ role: 'service_role' }))).toBe(true);
    expect(looksLikePrivilegedKey('sb_secret_x')).toBe(true);
    expect(looksLikePrivilegedKey(fakeJwt({ role: 'anon' }))).toBe(false);
    expect(looksLikePrivilegedKey('sb_publishable_x')).toBe(false);
    expect(looksLikePrivilegedKey('not a jwt')).toBe(false);
  });

  it('rejects text that is not a URL', () => {
    expect(parseSupabaseUrl('not a url')).toBeNull();
    expect(parseSupabaseUrl('ftp://example.com')).toBeNull();
  });
});
