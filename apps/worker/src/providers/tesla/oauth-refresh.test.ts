import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshAccessToken, TeslaOAuthError, TESLA_TOKEN_URL } from './oauth';

const options = {
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
  refreshToken: 'fixture-refresh',
};
const valid = {
  access_token: 'fixture-new-access',
  refresh_token: 'fixture-new-refresh',
  expires_in: 3600,
  token_type: 'Bearer',
  scope: 'openid offline_access energy_device_data',
};
afterEach(() => vi.restoreAllMocks());

describe('bounded refresh transport and response validation', () => {
  it.each([
    { ...valid, refresh_token: '' },
    { ...valid, expires_in: 0 },
    { ...valid, expires_in: 1.5 },
    { ...valid, expires_in: 32 * 86400 },
    { ...valid, token_type: 'Other' },
    { ...valid, scope: undefined },
    { ...valid, access_token: 'x'.repeat(32769) },
  ])('rejects malformed rotated credentials without retaining provider data', async (payload) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload));
    const error = await refreshAccessToken(options, fetcher).catch((error) => error as unknown);
    expect(error).toBeInstanceOf(TeslaOAuthError);
    expect(String(error) + JSON.stringify(error)).not.toContain('fixture-new');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses JWT scp and rejects contradictory response scope', async () => {
    const jwt = `${btoa('{}')}.${btoa(JSON.stringify({ scp: ['openid', 'offline_access', 'energy_device_data'] }))}.fixture`;
    const result = await refreshAccessToken(options, async () =>
      Response.json({ ...valid, access_token: jwt, scope: undefined }),
    );
    expect(result.scope).toBe(valid.scope);
    await expect(
      refreshAccessToken(options, async () =>
        Response.json({ ...valid, access_token: jwt, scope: 'energy_cmds' }),
      ),
    ).rejects.toBeInstanceOf(TeslaOAuthError);
  });
  it('extracts only the fixed login_required classification from a rejected refresh', async () => {
    const error = await refreshAccessToken(options, async () =>
      Response.json(
        { error: 'login_required', error_description: options.refreshToken },
        { status: 401 },
      ),
    ).catch((error) => error as TeslaOAuthError);
    expect(error).toMatchObject({
      error: 'login_required',
      statusCode: 401,
      errorDescription: undefined,
    });
    expect(JSON.stringify(error)).not.toContain(options.refreshToken);
  });
  it.each([301, 302, 303, 307, 308, 429, 500, 503])(
    'rejects HTTP %s without a redirected request or retry',
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        expect(String(input)).toBe(TESLA_TOKEN_URL);
        expect(init?.redirect).toBe('manual');
        return new Response('fixture-private-provider-body', {
          status,
          headers: { location: 'https://never.invalid' },
        });
      });
      const error = await refreshAccessToken(options, fetcher).catch((error) => error as unknown);
      expect(error).toBeInstanceOf(TeslaOAuthError);
      expect(JSON.stringify(error)).not.toContain('fixture-private-provider-body');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('bounds a stalled response body and a transport that ignores abort', async () => {
    for (const bodyOnly of [false, true]) {
      const controller = new AbortController();
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
      const fetcher = vi.fn<typeof fetch>(async () =>
        bodyOnly
          ? new Response(new ReadableStream({ start() {} }))
          : new Promise<Response>(() => undefined),
      );
      const result = refreshAccessToken(options, fetcher);
      const assertion = expect(result).rejects.toBeInstanceOf(TeslaOAuthError);
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      await assertion;
      expect(timeout).toHaveBeenCalledWith(10_000);
      expect(fetcher).toHaveBeenCalledTimes(1);
      timeout.mockRestore();
    }
  });
  it('rejects oversized and non-JSON bodies', async () => {
    for (const body of ['private-non-json', 'x'.repeat(65537)])
      await expect(
        refreshAccessToken(options, async () => new Response(body)),
      ).rejects.toBeInstanceOf(TeslaOAuthError);
  });
});
