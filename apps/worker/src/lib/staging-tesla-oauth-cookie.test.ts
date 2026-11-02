import { describe, expect, it } from 'vitest';
import { base64UrlEncode } from '../providers/tesla/oauth';
import {
  createOAuthBrowserCookie,
  oauthBrowserLeaseKey,
  readOAuthBrowserCookie,
  TESLA_OAUTH_COOKIE,
} from './staging-tesla-oauth-cookie';

const APP = 'https://stage.autopw3.app';
const now = 1_800_000_000_000;

async function fixture() {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const transaction = {
    state: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    householdId: crypto.randomUUID(),
    expiresAt: now + 600_000,
    leaseKey: await oauthBrowserLeaseKey(crypto.randomUUID()),
    leaseOwner: crypto.randomUUID(),
  };
  const header = await createOAuthBrowserCookie(transaction, key, now);
  const cookie = header.split(';')[0]!;
  const request = (value = cookie) => new Request(APP, { headers: { cookie: value } });
  return { key, transaction, header, cookie, request };
}

describe('staging OAuth browser cookie', () => {
  it('authenticates a 256-bit secret and transaction with host-only browser protections', async () => {
    const { key, transaction, header, request } = await fixture();
    expect(header).toContain(`${TESLA_OAUTH_COOKIE}=`);
    expect(header).toContain('; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600');
    expect(header.toLowerCase()).not.toContain('domain=');
    const binding = await readOAuthBrowserCookie(request(), key, now);
    expect(binding).toMatchObject(transaction);
    expect(binding?.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates different secrets even for the same transaction', async () => {
    const { key, transaction, request } = await fixture();
    const a = await readOAuthBrowserCookie(request(), key, now);
    const b = await readOAuthBrowserCookie(
      request((await createOAuthBrowserCookie(transaction, key, now)).split(';')[0]),
      key,
      now,
    );
    expect(a?.secret).not.toBe(b?.secret);
  });

  it('rejects missing, malformed, duplicate and differently keyed cookies', async () => {
    const { key, cookie, request } = await fixture();
    for (const value of ['', `${TESLA_OAUTH_COOKIE}=invalid`, `${cookie}; ${cookie}`]) {
      expect(await readOAuthBrowserCookie(request(value), key, now)).toBeNull();
    }
    expect(
      await readOAuthBrowserCookie(request(), crypto.getRandomValues(new Uint8Array(32)), now),
    ).toBeNull();
  });

  it.each(['state', 'sessionId', 'householdId', 'secret', 'expiresAt', 'leaseKey', 'leaseOwner'])(
    'rejects authenticated-payload tampering of %s',
    async (field) => {
      const { key, cookie, request } = await fixture();
      const [payload, signature] = cookie.slice(TESLA_OAUTH_COOKIE.length + 1).split('.');
      const binding = JSON.parse(atob(payload!.replace(/-/g, '+').replace(/_/g, '/'))) as Record<
        string,
        unknown
      >;
      binding[field] = field === 'expiresAt' ? now + 599_000 : 'changed';
      const changed = base64UrlEncode(new TextEncoder().encode(JSON.stringify(binding)));
      expect(
        await readOAuthBrowserCookie(
          request(`${TESLA_OAUTH_COOKIE}=${changed}.${signature}`),
          key,
          now,
        ),
      ).toBeNull();
    },
  );

  it('rejects expiry and cannot extend the ten-minute lifetime', async () => {
    const { key, transaction, request } = await fixture();
    expect(await readOAuthBrowserCookie(request(), key, now + 600_000)).toBeNull();
    await expect(
      createOAuthBrowserCookie({ ...transaction, expiresAt: now + 600_001 }, key, now),
    ).rejects.toThrow('Invalid OAuth browser transaction');
  });
});
