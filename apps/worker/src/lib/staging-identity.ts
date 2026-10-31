import { UuidSchema } from '@autopw3/shared';
import { SupabaseIdentityRepository } from '../db/identity-repository';
import { AuthenticatedPostgrestClient, SupabasePostgrestError } from '../db/postgrest';
import type { Env } from '../env';
import { handleGetMe } from '../routes/identity';
import { stagingConfig } from './staging-config';
import { applyCorsHeaders } from './cors';
import { errorResponse } from './errors';
import { verifySupabaseJwt, type VerifiedUser } from './jwt';
import { SupabaseRateLimiter, determineRateLimit } from './rate-limiter';

const PREFLIGHT_HEADERS = ['authorization', 'content-type', 'idempotency-key', 'x-request-id'];

/** Return null for every request outside the approved slice, preserving the deployment guard. */
export async function handleStagingIdentityRequest(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response | null> {
  if (
    env.ENVIRONMENT !== 'staging' ||
    env.STAGING_IDENTITY_READ_ENABLED !== 'true' ||
    new URL(request.url).pathname !== '/api/v1/me' ||
    (request.method !== 'GET' && request.method !== 'OPTIONS')
  ) {
    return null;
  }

  let config: ReturnType<typeof stagingConfig>;
  try {
    config = stagingConfig(env);
  } catch {
    return errorResponse('PROVIDER_UNAVAILABLE', 'Staging identity is not configured', requestId);
  }
  const cors = { allowedOrigins: config.allowedOrigins.map((origin) => origin.toLowerCase()) };
  const respond = (response: Response) => applyCorsHeaders(response, request, cors);
  const origin = request.headers.get('origin');
  if (origin && !cors.allowedOrigins.includes(origin.toLowerCase())) {
    return errorResponse('FORBIDDEN', 'Origin not allowed by CORS policy', requestId);
  }

  if (request.method === 'OPTIONS') {
    const requestedHeaders = request.headers.get('access-control-request-headers');
    if (
      !origin ||
      request.headers.get('access-control-request-method') !== 'GET' ||
      (requestedHeaders !== null &&
        requestedHeaders
          .split(',')
          .some((header) => !PREFLIGHT_HEADERS.includes(header.trim().toLowerCase())))
    ) {
      return respond(errorResponse('FORBIDDEN', 'Preflight is not permitted', requestId));
    }
    return respond(
      new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET',
          'access-control-allow-headers': PREFLIGHT_HEADERS.join(', '),
          'cache-control': 'no-store',
          'x-request-id': requestId,
          vary: 'Access-Control-Request-Method, Access-Control-Request-Headers',
        },
      }),
    );
  }

  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token)
    return respond(errorResponse('UNAUTHENTICATED', 'A bearer token is required', requestId));
  let user: VerifiedUser;
  try {
    user = await verifySupabaseJwt(token, {
      supabaseUrl: config.supabaseUrl,
      audience: 'authenticated',
    });
    if (!UuidSchema.safeParse(user.userId).success) throw new Error('Invalid actor');
  } catch {
    return respond(
      errorResponse('UNAUTHENTICATED', 'Invalid or expired authorization token', requestId),
    );
  }

  try {
    // Privileged access is limited to the server-owned counter. It is never passed to user reads.
    const limiter = new SupabaseRateLimiter(config.supabaseUrl, config.serviceKey);
    const { limit, windowSeconds } = determineRateLimit('GET', '/me', true);
    const result = await limiter.check(`staging:getMe:${user.userId}`, limit, windowSeconds);
    if (!result.allowed) {
      return respond(
        errorResponse('RATE_LIMITED', 'Rate limit exceeded', requestId, undefined, {
          'retry-after': String(result.retryAfterSeconds ?? 60),
        }),
      );
    }
    const repo = new SupabaseIdentityRepository(
      new AuthenticatedPostgrestClient(config.supabaseUrl, config.publicKey, token),
      user.userId,
    );
    // A GET never participates in the legacy idempotency response cache, regardless of headers.
    return respond(await handleGetMe(user, repo, requestId, { requirePersistedProfile: true }));
  } catch (error) {
    if (error instanceof SupabasePostgrestError && error.status === 401) {
      return respond(errorResponse('UNAUTHENTICATED', 'Database authentication failed', requestId));
    }
    if (error instanceof SupabasePostgrestError && error.status === 403) {
      return respond(errorResponse('FORBIDDEN', 'Identity access denied', requestId));
    }
    return respond(
      errorResponse('PROVIDER_UNAVAILABLE', 'Staging identity is unavailable', requestId),
    );
  }
}
