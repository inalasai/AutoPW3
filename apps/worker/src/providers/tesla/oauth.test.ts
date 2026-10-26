import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  generateCodeChallenge,
  generateCodeVerifier,
  InMemoryOAuthStateStore,
  refreshAccessToken,
  TESLA_AUTH_URL,
  TeslaOAuthError,
} from './oauth';

describe('Tesla OAuth 2.0 Integration', () => {
  const clientId = 'tesla-client-id-123';
  const clientSecret = 'tesla-client-secret-456';
  const redirectUri = 'https://app.autopw3.com/provider/tesla/callback';

  describe('PKCE Code Verifier & Challenge', () => {
    it('generates high-entropy base64url code verifier of requested length', () => {
      const verifier = generateCodeVerifier(64);
      expect(verifier.length).toBe(64);
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('computes deterministic S256 code challenge from verifier', async () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = await generateCodeChallenge(verifier);
      expect(challenge).toBeTruthy();
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);

      // Same verifier yields identical challenge
      const challenge2 = await generateCodeChallenge(verifier);
      expect(challenge).toBe(challenge2);
    });
  });

  describe('OAuth State Store (CSRF Protection)', () => {
    it('stores and consumes single-use state', async () => {
      const store = new InMemoryOAuthStateStore();
      const state = 'state-abc-123';
      await store.saveState({
        state,
        userId: 'user-1',
        householdId: 'hh-1',
        codeVerifier: 'verifier-1',
        expiresAt: Date.now() + 60_000,
      });

      // First consumption succeeds
      const payload1 = await store.consumeState(state);
      expect(payload1).not.toBeNull();
      expect(payload1?.userId).toBe('user-1');
      expect(payload1?.householdId).toBe('hh-1');

      // Second consumption returns null (single-use protection)
      const payload2 = await store.consumeState(state);
      expect(payload2).toBeNull();
    });

    it('rejects expired state', async () => {
      const store = new InMemoryOAuthStateStore();
      const state = 'expired-state';
      await store.saveState({
        state,
        userId: 'user-1',
        householdId: 'hh-1',
        codeVerifier: 'verifier-1',
        expiresAt: Date.now() - 1000, // in the past
      });

      const payload = await store.consumeState(state);
      expect(payload).toBeNull();
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('constructs standard Tesla authorization URL with PKCE parameters', async () => {
      const state = 'state-uuid-999';
      const codeVerifier = generateCodeVerifier(64);

      const { url, codeChallenge } = await buildAuthorizeUrl({
        clientId,
        redirectUri,
        state,
        codeVerifier,
      });

      expect(url.startsWith(TESLA_AUTH_URL)).toBe(true);
      const parsed = new URL(url);
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('client_id')).toBe(clientId);
      expect(parsed.searchParams.get('redirect_uri')).toBe(redirectUri);
      expect(parsed.searchParams.get('state')).toBe(state);
      expect(parsed.searchParams.get('code_challenge')).toBe(codeChallenge);
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('scope')).toContain('energy_device_data');
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('exchanges code for tokens successfully against mock fetch', async () => {
      const mockFetch: typeof fetch = async (_url, init) => {
        expect(init?.method).toBe('POST');
        const bodyStr = String(init?.body);
        expect(bodyStr).toContain('grant_type=authorization_code');
        expect(bodyStr).toContain('code=auth-code-123');

        return new Response(
          JSON.stringify({
            access_token: 'tesla-mock-access-token',
            refresh_token: 'tesla-mock-refresh-token',
            expires_in: 28800,
            token_type: 'Bearer',
            scope: 'openid offline_access energy_device_data',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };

      const result = await exchangeAuthorizationCode(
        {
          clientId,
          clientSecret,
          redirectUri,
          code: 'auth-code-123',
          codeVerifier: 'test-verifier',
        },
        mockFetch,
      );

      expect(result.access_token).toBe('tesla-mock-access-token');
      expect(result.refresh_token).toBe('tesla-mock-refresh-token');
      expect(result.expires_in).toBe(28800);
    });

    it('maps Tesla OAuth errors to typed TeslaOAuthError', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'The code is invalid or has expired',
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      };

      await expect(
        exchangeAuthorizationCode(
          {
            clientId,
            clientSecret,
            redirectUri,
            code: 'invalid-code',
            codeVerifier: 'verifier',
          },
          mockFetch,
        ),
      ).rejects.toThrow(TeslaOAuthError);
    });
  });

  describe('refreshAccessToken', () => {
    it('refreshes token successfully and returns rotated credentials', async () => {
      const mockFetch: typeof fetch = async (_url, init) => {
        const bodyStr = String(init?.body);
        expect(bodyStr).toContain('grant_type=refresh_token');
        expect(bodyStr).toContain('refresh_token=old-refresh-token');

        return new Response(
          JSON.stringify({
            access_token: 'new-access-token-789',
            refresh_token: 'new-refresh-token-rotated-101',
            expires_in: 28800,
            token_type: 'Bearer',
            scope: 'openid offline_access energy_device_data',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };

      const result = await refreshAccessToken(
        {
          clientId,
          clientSecret,
          refreshToken: 'old-refresh-token',
        },
        mockFetch,
      );

      expect(result.access_token).toBe('new-access-token-789');
      expect(result.refresh_token).toBe('new-refresh-token-rotated-101');
    });

    it('throws TeslaOAuthError when refresh token is rejected (e.g. login_required)', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            error: 'login_required',
            error_description: 'Refresh token expired or password reset',
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      };

      await expect(
        refreshAccessToken(
          {
            clientId,
            clientSecret,
            refreshToken: 'expired-refresh-token',
          },
          mockFetch,
        ),
      ).rejects.toThrow(TeslaOAuthError);
    });
  });
});
