import * as jose from 'jose';

export interface VerifiedUser {
  readonly userId: string;
  readonly email?: string | undefined;
}

export interface JwtVerifyConfig {
  readonly supabaseUrl?: string | undefined;
  readonly issuer?: string | undefined;
  readonly jwksUrl?: string | undefined;
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
    ...(expectedIssuer ? { issuer: expectedIssuer } : {}),
  };

  // Perform cryptographic verification
  let result: jose.JWTVerifyResult;
  if (typeof keyOrJwks === 'function') {
    result = await jose.jwtVerify(token, keyOrJwks, verifyOptions);
  } else {
    result = await jose.jwtVerify(token, keyOrJwks, verifyOptions);
  }

  const payload = result.payload;

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Missing sub claim in token');
  }

  if (payload['role'] !== 'authenticated') {
    throw new Error('Token role is not authenticated');
  }

  return {
    userId: payload.sub,
    email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
  };
}
