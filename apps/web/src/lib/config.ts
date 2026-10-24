/**
 * Public, browser-visible configuration. `VITE_` variables are public: never put a secret in one.
 * Demo mode is the default so the app runs with no Tesla or production database credentials.
 */

/** How the app signs people in. Decided once at start-up from the build-time variables. */
export type AuthConfig =
  /** Demo mode: nobody signs in, all pages are open and labelled DEMO. */
  | { kind: 'none' }
  /** Live mode: Supabase Auth with the project URL and the public (anon) key. */
  | { kind: 'supabase'; url: string; anonKey: string }
  /** Development only: in-memory accounts for tests and the Playwright smoke test. Never in a production build. */
  | { kind: 'mock' }
  /** Live mode without a usable setup. The app shows `reason` instead of starting. Never holds a value from the variables. */
  | { kind: 'invalid'; reason: string };

/**
 * Where the Live View gets its readings. Chosen by configuration, never by editing code.
 *  - demo: the synthetic demo provider. Everything it shows is labelled DEMO.
 *  - live: the live provider. It does not exist yet (Tesla adapter TASK-15, ingestion TASK-16), so the Live View
 *    says so instead of showing anything. It never falls back to demo data.
 *  - invalid: the setting is unusable; the Live View shows `reason`.
 */
export type TelemetryConfig =
  { kind: 'demo' } | { kind: 'live' } | { kind: 'invalid'; reason: string };

export interface AppConfig {
  /** True when the app shows synthetic, clearly labelled DEMO data only. */
  demoMode: boolean;
  auth: AuthConfig;
  telemetry: TelemetryConfig;
}

export interface ReadConfigOptions {
  /** True in a development build (`import.meta.env.DEV`). The mock sign-in is allowed only then. */
  isDev?: boolean;
}

/** A JWT payload as an object, or `null` when the text is not a JWT with a JSON payload. */
function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const parsed: unknown = JSON.parse(atob(padded));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * True when the "anon key" looks like a privileged key. The browser must only ever hold the public key
 * (SECURITY_MODEL.md section 5): a service-role JWT or a `sb_secret_` key in a `VITE_` variable would ship to
 * every visitor, so the app refuses to start with one.
 */
export function looksLikePrivilegedKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const payload = jwtPayload(key);
  return payload !== null && payload['role'] === 'service_role';
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** The Supabase project URL: https, or http on this machine for a local stack. `null` if unusable. */
export function parseSupabaseUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLocalHost(url.hostname)) return url;
  return null;
}

function readAuth(env: Record<string, string | undefined>, isDev: boolean): AuthConfig {
  if (env['VITE_AUTH_MODE'] === 'mock') {
    return isDev
      ? { kind: 'mock' }
      : {
          kind: 'invalid',
          reason:
            'VITE_AUTH_MODE=mock is refused in a production build. Use a real Supabase project.',
        };
  }

  const url = (env['VITE_SUPABASE_URL'] ?? '').trim();
  const anonKey = (env['VITE_SUPABASE_ANON_KEY'] ?? '').trim();
  if (
    url === '' ||
    anonKey === '' ||
    url.includes('YOUR_PROJECT_REF') ||
    anonKey === 'YOUR_VALUE_HERE'
  ) {
    return {
      kind: 'invalid',
      reason:
        'Sign-in is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or set VITE_DEMO_MODE=true.',
    };
  }
  const parsed = parseSupabaseUrl(url);
  if (parsed === null) {
    return {
      kind: 'invalid',
      reason: 'VITE_SUPABASE_URL must be an https URL (http is allowed only for localhost).',
    };
  }
  if (looksLikePrivilegedKey(anonKey)) {
    return {
      kind: 'invalid',
      reason:
        'VITE_SUPABASE_ANON_KEY holds a privileged key. Only the public (anon or publishable) key may be used in the browser.',
    };
  }
  return { kind: 'supabase', url: parsed.origin, anonKey };
}

/**
 * VITE_TELEMETRY_PROVIDER is demo or live. Unset means demo in demo mode and live otherwise, so a real
 * deployment never shows demo data by default. live together with demo mode is a contradiction and is refused.
 */
function readTelemetry(
  env: Record<string, string | undefined>,
  demoMode: boolean,
): TelemetryConfig {
  const value = (env['VITE_TELEMETRY_PROVIDER'] ?? '').trim().toLowerCase();
  if (value === '') return { kind: demoMode ? 'demo' : 'live' };
  if (value === 'demo') return { kind: 'demo' };
  if (value === 'live') {
    return demoMode
      ? {
          kind: 'invalid',
          reason:
            'VITE_TELEMETRY_PROVIDER=live needs VITE_DEMO_MODE=false. Demo mode shows demo data only.',
        }
      : { kind: 'live' };
  }
  return { kind: 'invalid', reason: 'VITE_TELEMETRY_PROVIDER must be demo or live.' };
}

export function readConfig(
  env: Record<string, string | undefined>,
  { isDev = false }: ReadConfigOptions = {},
): AppConfig {
  // Demo is the safe default: only an explicit "false" turns it off.
  const demoMode = env['VITE_DEMO_MODE'] !== 'false';
  return {
    demoMode,
    auth: demoMode ? { kind: 'none' } : readAuth(env, isDev),
    telemetry: readTelemetry(env, demoMode),
  };
}
