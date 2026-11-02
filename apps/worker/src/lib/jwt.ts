import * as jose from 'jose';

export interface VerifiedUser {
  readonly userId: string;
  readonly email?: string | undefined;
  /** Present only when this caller requires a revocable Supabase Auth session. */
  readonly sessionId?: string | undefined;
  readonly expiresAt?: number | undefined;
}

export interface JwtVerifyConfig {
  readonly supabaseUrl?: string | undefined;
  readonly issuer?: string | undefined;
  readonly jwksUrl?: string | undefined;
  /** Optional recipient constraint; the staging identity slice requires authenticated. */
  readonly audience?: string | undefined;
  readonly requireSessionId?: boolean | undefined;
  /** In-memory test JWKS or public key for unit testing without network. */
  readonly testKeySet?: jose.JWTVerifyGetKey | CryptoKey | Uint8Array | undefined;
}

const ALLOWED_ALGORITHMS = ['RS256', 'ES256', 'EdDSA'];

// Cache remote JWKS instances by URL with 10 minute TTL per D-009 / V8
interface CachedJwks {
  readonly jwks: jose.JWTVerifyGetKey;
  readonly createdMs: number;
}
const jwksCache = new Map<string, CachedJwks>();
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getRemoteJwks(url: string): jose.JWTVerifyGetKey {
  const now = Date.now();
  const cached = jwksCache.get(url);
  if (cached && now - cached.createdMs < JWKS_CACHE_TTL_MS) {
    return cached.jwks;
  }

  const jwks = jose.createRemoteJWKSet(new URL(url), {
    cooldownDuration: 30_000,
    cacheMaxAge: JWKS_CACHE_TTL_MS,
  });

  jwksCache.set(url, { jwks, createdMs: now });
  return jwks;
}

/**
 * Verifies Supabase Auth JWT according to D-009:
 * - Asymmetric signing only (RS256/ES256/EdDSA).
 * - Explicitly rejects HS256.
 * - Enforces valid `exp`, `iss`, `sub`, and `role === 'authenticated'`.
 */
export async function verifySupabaseJwt(
  token: string,
  config: JwtVerifyConfig,
): Promise<VerifiedUser> {
  // First, peek at the unverified header to ensure HS256 is explicitly rejected
  const protectedHeader = jose.decodeProtectedHeader(token);
  if (!protectedHeader.alg || protectedHeader.alg.toUpperCase() === 'HS256') {
    throw new Error('Symmetric algorithms (HS256) are strictly forbidden');
  }

  if (!ALLOWED_ALGORITHMS.includes(protectedHeader.alg)) {
    throw new Error(`Algorithm ${protectedHeader.alg} is not in the allowed list`);
  }

  const expectedIssuer =
    config.issuer ??
    (config.supabaseUrl ? `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1` : undefined);

  let keyOrJwks: jose.JWTVerifyGetKey | CryptoKey | Uint8Array;

  if (config.testKeySet) {
    keyOrJwks = config.testKeySet;
  } else {
    const jwksUrl =
      config.jwksUrl ??
      (config.supabaseUrl
        ? `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`
        : undefined);

    if (!jwksUrl) {
      throw new Error('Missing Supabase JWKS configuration');
    }
    keyOrJwks = getRemoteJwks(jwksUrl);
  }

  const verifyOptions: jose.JWTVerifyOptions = {
    algorithms: ALLOWED_ALGORITHMS,
    requiredClaims: ['exp'],
    ...(expectedIssuer ? { issuer: expectedIssuer } : {}),
    ...(config.audience !== undefined ? { audience: config.audience } : {}),
  };

  // Perform cryptographic verification
  let result: jose.JWTVerifyResult;
  if (typeof keyOrJwks === 'function') {
    result = await jose.jwtVerify(token, keyOrJwks, verifyOptions);
  } else {
    result = await jose.jwtVerify(token, keyOrJwks, verifyOptions);
  }

  const payload = result.payload;

  // JOSE checks audience membership, but a mixed array containing the expected string can pass.
  // Validate the complete claim shape whenever this caller requires an audience.
  if (config.audience !== undefined) {
    const audience: unknown = payload.aud;
    if (
      !(typeof audience === 'string' && audience.length > 0) &&
      !(
        Array.isArray(audience) &&
        audience.length > 0 &&
        audience.every((value: unknown) => typeof value === 'string' && value.length > 0)
      )
    ) {
      throw new Error('Invalid audience claim');
    }
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Missing sub claim in token');
  }

  if (payload['role'] !== 'authenticated') {
    throw new Error('Token role is not authenticated');
  }

  if (
    config.requireSessionId &&
    (typeof payload['session_id'] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        payload['session_id'],
      ))
  ) {
    throw new Error('Missing or invalid session claim');
  }

  return {
    userId: payload.sub,
    email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
    ...(config.requireSessionId
      ? { sessionId: payload['session_id'] as string, expiresAt: payload.exp }
      : {}),
  };
}
