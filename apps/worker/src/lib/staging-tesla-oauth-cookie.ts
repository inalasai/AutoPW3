import { UuidSchema } from '@autopw3/shared';
import { z } from 'zod';
import { base64UrlEncode } from '../providers/tesla/oauth';

export const TESLA_OAUTH_COOKIE = '__Host-autopw3-tesla-oauth';
export const TESLA_OAUTH_COOKIE_SECONDS = 600;
// Covers a ten-minute consent window plus bounded callback I/O before releasing ownership.
export const TESLA_OAUTH_LEASE_SECONDS = 720;

const encoder = new TextEncoder();
const purpose = 'AutoPW3/staging-tesla-oauth-browser/v1';
const attributes = '; Secure; HttpOnly; SameSite=Lax; Path=/';
const bindingSchema = z
  .object({
    version: z.literal(2),
    state: UuidSchema,
    sessionId: UuidSchema,
    householdId: UuidSchema,
    secret: z.string().regex(/^[0-9a-f]{64}$/),
    expiresAt: z.number().int().positive(),
    leaseKey: z.string().regex(/^staging:tesla:oauth:[0-9a-f]{64}$/),
    leaseOwner: UuidSchema,
  })
  .strict();

export type OAuthBrowserBinding = z.infer<typeof bindingSchema>;

/** A stable, opaque actor resource; no browser-supplied lock keys are trusted. */
export async function oauthBrowserLeaseKey(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${purpose}:${userId}`));
  return `staging:tesla:oauth:${hex(new Uint8Array(digest))}`;
}

/** HKDF separates cookie authentication from the existing AES token/state encryption key. */
async function signingKey(encryptionKey: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(encryptionKey),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(purpose),
      info: encoder.encode('cookie'),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

export async function createOAuthBrowserCookie(
  transaction: {
    state: string;
    sessionId: string;
    householdId: string;
    expiresAt: number;
    leaseKey: string;
    leaseOwner: string;
  },
  encryptionKey: Uint8Array,
  now = Date.now(),
): Promise<string> {
  const parsed = bindingSchema.safeParse({
    ...transaction,
    version: 2,
    secret: hex(crypto.getRandomValues(new Uint8Array(32))),
  });
  if (
    !parsed.success ||
    parsed.data.expiresAt <= now ||
    parsed.data.expiresAt > now + TESLA_OAUTH_COOKIE_SECONDS * 1000
  ) {
    throw new Error('Invalid OAuth browser transaction');
  }
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(parsed.data)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(encryptionKey),
    encoder.encode(payload),
  );
  const maxAge = Math.min(
    TESLA_OAUTH_COOKIE_SECONDS,
    Math.ceil((parsed.data.expiresAt - now) / 1000),
  );
  return `${TESLA_OAUTH_COOKIE}=${payload}.${base64UrlEncode(new Uint8Array(signature))}${attributes}; Max-Age=${maxAge}`;
}

/** Authenticate the complete transaction before callers consume state or perform privileged I/O. */
export async function readOAuthBrowserCookie(
  request: Request,
  encryptionKey: Uint8Array,
  now = Date.now(),
): Promise<OAuthBrowserBinding | null> {
  const matches = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${TESLA_OAUTH_COOKIE}=`));
  if (matches.length !== 1) return null;
  const value = matches[0]!.slice(TESLA_OAUTH_COOKIE.length + 1);
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const [payload, signature] = value.split('.') as [string, string];
  try {
    const signatureBytes = decode(signature);
    if (base64UrlEncode(signatureBytes) !== signature) return null;
    if (
      !(await crypto.subtle.verify(
        'HMAC',
        await signingKey(encryptionKey),
        signatureBytes,
        encoder.encode(payload),
      ))
    )
      return null;
    const parsed = bindingSchema.safeParse(JSON.parse(new TextDecoder().decode(decode(payload))));
    if (
      !parsed.success ||
      parsed.data.expiresAt <= now ||
      parsed.data.expiresAt > now + TESLA_OAUTH_COOKIE_SECONDS * 1000
    )
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
