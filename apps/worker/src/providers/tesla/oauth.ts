import { z } from 'zod';
import { decodeJwt } from 'jose';
import { teslaJson } from './http';
import { requireTeslaFleetOrigin } from './region';

/**
 * Tesla Fleet API OAuth 2.0 Client Module
 *
 * Implements authorization code grant with PKCE (S256), state binding,
 * token exchange, single-use refresh token rotation, and error mapping per S3/S16.
 */

export const TESLA_AUTH_URL = 'https://auth.tesla.com/oauth2/v3/authorize';
export const TESLA_TOKEN_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token';
export const DEFAULT_ENERGY_SCOPES = ['openid', 'offline_access', 'energy_device_data'];

export interface OAuthStatePayload {
  readonly state: string;
  readonly userId: string;
  readonly householdId: string;
  readonly codeVerifier: string;
  readonly expiresAt: number; // Unix timestamp ms
}

export interface TeslaTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number; // in seconds
  readonly token_type: string;
  readonly scope: string;
  readonly id_token?: string | undefined;
}

export class TeslaOAuthError extends Error {
  readonly error: string;
  readonly errorDescription: string | undefined;
  readonly statusCode: number;

  constructor(error: string, errorDescription?: string, statusCode = 400) {
    super(`Tesla OAuth Error: ${error}${errorDescription ? ` - ${errorDescription}` : ''}`);
    this.name = 'TeslaOAuthError';
    this.error = error;
    this.errorDescription = errorDescription;
    this.statusCode = statusCode;
  }
}

/**
 * Base64URL encoding helper (RFC 4648).
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generates a high-entropy cryptographic PKCE code verifier (43-128 chars).
 */
export function generateCodeVerifier(length = 64): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(length));
  return base64UrlEncode(randomBytes).substring(0, length);
}

/**
 * Computes S256 PKCE code challenge from a verifier.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * In-memory or persisted store for pending OAuth states to prevent CSRF.
 */
export interface OAuthStateStore {
  saveState(payload: OAuthStatePayload): Promise<void>;
  consumeState(state: string): Promise<OAuthStatePayload | null>;
}

export class InMemoryOAuthStateStore implements OAuthStateStore {
  private readonly states = new Map<string, OAuthStatePayload>();

  async saveState(payload: OAuthStatePayload): Promise<void> {
    this.states.set(payload.state, payload);
  }

  async consumeState(state: string): Promise<OAuthStatePayload | null> {
    const payload = this.states.get(state);
    if (!payload) {
      return null;
    }
    // Single-use: remove immediately upon retrieval
    this.states.delete(state);

    if (Date.now() > payload.expiresAt) {
      // Expired state
      return null;
    }

    return payload;
  }
}

/**
 * Builds the Tesla OAuth authorization redirect URL.
 */
export async function buildAuthorizeUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly scopes?: readonly string[] | undefined;
}): Promise<{ url: string; codeChallenge: string }> {
  const scopes = options.scopes ?? DEFAULT_ENERGY_SCOPES;
  const codeChallenge = await generateCodeChallenge(options.codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: scopes.join(' '),
    state: options.state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    require_requested_scopes: 'true',
    prompt_missing_scopes: 'true',
  });

  return {
    url: `${TESLA_AUTH_URL}?${params.toString()}`,
    codeChallenge,
  };
}

/**
 * Exchanges an authorization code for Tesla access and refresh tokens.
 */
export async function exchangeAuthorizationCode(
  options: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly audience: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<TeslaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: options.clientId,
    client_secret: options.clientSecret,
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
  });

  body.set('audience', requireTeslaFleetOrigin(options.audience));
  try {
    const json = await teslaJson(
      TESLA_TOKEN_URL,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: body.toString(),
      },
      fetcher,
    );
    const parsed = z
      .object({
        access_token: z.string().min(1).max(32768),
        refresh_token: z.string().min(1).max(32768),
        expires_in: z
          .number()
          .int()
          .positive()
          .max(31 * 86400),
        token_type: z.literal('Bearer'),
        scope: z.string().min(1).max(2048).optional(),
      })
      .parse(json);
    // Tesla documents access_token.scp as the granted-scope authority. Tokens originate
    // directly from its fixed TLS token endpoint; this decode never authenticates an app actor.
    let tokenScopes: string | undefined;
    if (parsed.access_token.split('.').length === 3) {
      const claim = decodeJwt(parsed.access_token)['scp'];
      tokenScopes =
        typeof claim === 'string'
          ? claim
          : Array.isArray(claim) &&
              claim.length > 0 &&
              claim.every((value) => typeof value === 'string' && !value.includes(' '))
            ? claim.join(' ')
            : undefined;
      if (!tokenScopes) throw new Error('Missing granted scopes');
    }
    const scope = tokenScopes ?? parsed.scope;
    if (!scope) throw new Error('Missing granted scopes');
    if (
      parsed.scope &&
      tokenScopes &&
      [...new Set(parsed.scope.split(' '))].sort().join(' ') !==
        [...new Set(tokenScopes.split(' '))].sort().join(' ')
    ) {
      throw new Error('Inconsistent granted scopes');
    }
    return { ...parsed, scope };
  } catch {
    throw new TeslaOAuthError('authorization_exchange_failed', undefined, 502);
  }
}

export function validateReadOnlyTeslaScopes(scope: string): void {
  const scopes = scope.split(' ');
  if (
    scopes.some((value) => !DEFAULT_ENERGY_SCOPES.includes(value)) ||
    DEFAULT_ENERGY_SCOPES.some((value) => !scopes.includes(value))
  )
    throw new TeslaOAuthError('invalid_granted_scopes');
}

/**
 * Refreshes an access token using a single-use refresh token.
 * S3 Note: The refresh token rotates on each exchange.
 */
export async function refreshAccessToken(
  options: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly refreshToken: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<TeslaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: options.clientId,
    client_secret: options.clientSecret,
    refresh_token: options.refreshToken,
  });

  let res: Response;
  try {
    res = await fetcher(TESLA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new TeslaOAuthError(
      'network_error',
      `Failed to contact Tesla token refresh endpoint: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const error = String(json['error'] ?? 'token_refresh_failed');
    const description =
      typeof json['error_description'] === 'string' ? json['error_description'] : undefined;
    throw new TeslaOAuthError(error, description, res.status);
  }

  return json as unknown as TeslaTokenResponse;
}
