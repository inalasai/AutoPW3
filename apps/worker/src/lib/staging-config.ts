import { decodeJwt } from 'jose';
import type { Env } from '../env';

export function httpsOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.hostname === 'localhost' ||
    /(^|\.)(example\.(com|org|net)|invalid|test)$/.test(url.hostname) ||
    /your_|placeholder/i.test(value)
  ) {
    throw new Error('Invalid staging origin');
  }
  return url.origin;
}

/** Key classification only; the Supabase gateway authenticates the configured credentials. */
function configuredKey(value: string | undefined, role: 'anon' | 'service_role'): string {
  if (!value || value !== value.trim()) throw new Error('Missing staging credential');
  if (role === 'anon' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return value;
  // The existing privileged RPC transport sends its key as a bearer JWT. Opaque sb_secret_
  // keys need different transport headers; reject them here rather than claim that support.
  if (decodeJwt(value)['role'] !== role) throw new Error('Invalid staging credential type');
  return value;
}

export function stagingConfig(env: Env) {
  if (!env.SUPABASE_URL || !env.ALLOWED_ORIGINS || env.LOCAL_MOCKS === 'true') {
    throw new Error('Missing staging configuration');
  }
  const supabaseUrl = httpsOrigin(env.SUPABASE_URL);
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((origin) => httpsOrigin(origin.trim()));
  // User identity and database origin must belong to the same project; no test/JWKS overrides here.
  if (
    (env.JWT_ISSUER && env.JWT_ISSUER !== `${supabaseUrl}/auth/v1`) ||
    (env.JWT_JWKS_URL && env.JWT_JWKS_URL !== `${supabaseUrl}/auth/v1/.well-known/jwks.json`)
  ) {
    throw new Error('Mismatched staging authentication configuration');
  }
  const publicKey = configuredKey(env.SUPABASE_ANON_KEY, 'anon');
  const serviceKey = configuredKey(env.SUPABASE_SECRET_KEY, 'service_role');
  if (publicKey === serviceKey) throw new Error('Staging credentials must be separate');
  return { supabaseUrl, publicKey, serviceKey, allowedOrigins };
}
