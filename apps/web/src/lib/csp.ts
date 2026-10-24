/**
 * The page's Content-Security-Policy is a static file (`public/_headers`) with `connect-src 'self'`. Signing in
 * needs the browser to reach the Supabase project, so the build adds that one origin to `connect-src`
 * (SECURITY_MODEL.md section 8). This module is the pure part; `vite.config.ts` applies it to `dist/_headers`.
 */

/** An origin: scheme, host and optional port, nothing else. Rejects anything that could alter other directives. */
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

const CONNECT_SRC_SELF = "connect-src 'self'";

/**
 * Returns the headers text with `origin` added to `connect-src`. With no origin (demo mode) the text is returned
 * unchanged. Throws if the origin is malformed or the policy has no plain `connect-src 'self'` to extend, so a
 * broken policy fails the build instead of shipping.
 */
export function withConnectSrc(headers: string, origin: string | null): string {
  if (origin === null) return headers;
  if (!ORIGIN.test(origin)) {
    throw new Error('CSP: the Supabase origin is not a plain http(s) origin.');
  }
  if (headers.includes(`${CONNECT_SRC_SELF} ${origin}`)) return headers;
  if (!headers.includes(`${CONNECT_SRC_SELF};`)) {
    throw new Error(`CSP: public/_headers has no "${CONNECT_SRC_SELF};" directive to extend.`);
  }
  return headers.replace(`${CONNECT_SRC_SELF};`, `${CONNECT_SRC_SELF} ${origin};`);
}
