import { UuidSchema } from '@autopw3/shared';
import { z } from 'zod';
import { SupabaseIdentityRepository } from '../db/identity-repository';
import { AuthenticatedPostgrestClient, SupabasePostgrestError } from '../db/postgrest';
import type { Env } from '../env';
import { TeslaClient } from '../providers/tesla/client';
import { requireTeslaFleetOrigin } from '../providers/tesla/region';
import { completeTeslaAuthorization, handleConnectTesla } from '../routes/tesla';
import { parseSecretKey } from '../services/tokens/encryption';
import { SupabaseOAuthStateStore, SupabaseTokenStore } from '../services/tokens/supabase-store';
import { applyCorsHeaders } from './cors';
import { errorResponse } from './errors';
import { verifySupabaseJwt } from './jwt';
import { SupabaseRateLimiter } from './rate-limiter';
import { httpsOrigin, stagingConfig } from './staging-config';

const CALLBACK = '/api/v1/provider/tesla/callback';
const HEADERS = ['authorization', 'content-type', 'x-request-id'];
const connectBody = z.object({ enableControls: z.literal(false).optional() }).strict();

function oauthConfig(env: Env) {
  const database = stagingConfig(env);
  const appOrigin = httpsOrigin(env.APP_BASE_URL ?? '');
  if (
    !database.allowedOrigins.includes(appOrigin) ||
    env.TESLA_REDIRECT_URI !== `${appOrigin}${CALLBACK}` ||
    !env.TESLA_CLIENT_ID?.trim() ||
    !env.TESLA_CLIENT_SECRET?.trim() ||
    /YOUR_VALUE|placeholder/i.test(`${env.TESLA_CLIENT_ID} ${env.TESLA_CLIENT_SECRET}`)
  )
    throw new Error('Invalid staging OAuth configuration');
  requireTeslaFleetOrigin(env.TESLA_FLEET_API_BASE_URL ?? '');
  const encryptionKey = parseSecretKey(env.TOKEN_ENCRYPTION_KEY ?? '');
  return { ...database, appOrigin, encryptionKey };
}

class OAuthRateLimitError extends Error {}

/** No legacy dependency injection, mutable actor clients or process-local storage in this slice. */
export async function handleStagingTeslaOAuthRequest(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/api\/v1\/households\/([0-9a-f-]{36})\/provider\/tesla\/connect$/.exec(
    url.pathname,
  );
  const isConnect = !!match && (request.method === 'POST' || request.method === 'OPTIONS');
  const isCallback = url.pathname === CALLBACK && request.method === 'GET';
  if (
    env.ENVIRONMENT !== 'staging' ||
    env.STAGING_TESLA_OAUTH_ENABLED !== 'true' ||
    (!isConnect && !isCallback)
  )
    return null;
  let config: ReturnType<typeof oauthConfig>;
  try {
    config = oauthConfig(env);
    if (url.origin !== config.appOrigin) throw new Error('Wrong callback origin');
  } catch {
    return errorResponse(
      'PROVIDER_UNAVAILABLE',
      'Staging Tesla OAuth is not configured',
      requestId,
    );
  }
  const cors = { allowedOrigins: config.allowedOrigins.map((origin) => origin.toLowerCase()) };
  const respond = (response: Response) => {
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store');
    headers.set('referrer-policy', 'no-referrer');
    const secured = new Response(response.body, { status: response.status, headers });
    return isConnect ? applyCorsHeaders(secured, request, cors) : secured;
  };
  // Callback is a top-level navigation from Tesla, authenticated by single-use state + PKCE.
  const origin = request.headers.get('origin');
  if (isConnect && origin && !cors.allowedOrigins.includes(origin.toLowerCase())) {
    return respond(errorResponse('FORBIDDEN', 'Origin not allowed', requestId));
  }
  if (isConnect && request.method === 'OPTIONS') {
    if (
      !origin ||
      url.search ||
      request.headers.get('access-control-request-method') !== 'POST' ||
      (request.headers.get('access-control-request-headers') ?? '')
        .split(',')
        .filter(Boolean)
        .some((value) => !HEADERS.includes(value.trim().toLowerCase()))
    ) {
      return respond(errorResponse('FORBIDDEN', 'Preflight is not permitted', requestId));
    }
    return respond(
      new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': HEADERS.join(', '),
          'x-request-id': requestId,
          vary: 'Access-Control-Request-Method, Access-Control-Request-Headers',
        },
      }),
    );
  }
  try {
    const states = new SupabaseOAuthStateStore(
      config.supabaseUrl,
      config.serviceKey,
      config.encryptionKey,
    );
    const limiter = new SupabaseRateLimiter(config.supabaseUrl, config.serviceKey);
    const rateLimit = async (key: string) => {
      if (!(await limiter.check(key, 10, 60)).allowed) throw new OAuthRateLimitError();
    };
    if (isConnect) {
      const householdId = match![1]!;
      if (!UuidSchema.safeParse(householdId).success || url.search) {
        return respond(errorResponse('VALIDATION_FAILED', 'Invalid connect request', requestId));
      }
      const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token)
        return respond(errorResponse('UNAUTHENTICATED', 'A bearer token is required', requestId));
      let userId: string;
      try {
        const user = await verifySupabaseJwt(token, {
          supabaseUrl: config.supabaseUrl,
          audience: 'authenticated',
        });
        userId = UuidSchema.parse(user.userId);
      } catch {
        return respond(
          errorResponse('UNAUTHENTICATED', 'Invalid or expired authorization token', requestId),
        );
      }
      await rateLimit(`staging:tesla:connect:${userId}`);
      const repo = new SupabaseIdentityRepository(
        new AuthenticatedPostgrestClient(config.supabaseUrl, config.publicKey, token),
        userId,
      );
      if ((await repo.getMembership(householdId, userId))?.role !== 'ADMIN') {
        return respond(
          errorResponse(
            'FORBIDDEN',
            'Tesla connection requires a household administrator',
            requestId,
          ),
        );
      }
      let body: z.infer<typeof connectBody>;
      try {
        body = connectBody.parse(JSON.parse(await boundedConnectBody(request)));
      } catch {
        return respond(
          errorResponse(
            'VALIDATION_FAILED',
            'Only read-only Tesla authorization is supported',
            requestId,
          ),
        );
      }
      return respond(await handleConnectTesla(householdId, body, userId, env, states, requestId));
    }
    const params = url.searchParams;
    const allowed = ['state', 'code', 'error', 'error_description'];
    if (
      url.search.length > 8192 ||
      [...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1) ||
      !UuidSchema.safeParse(params.get('state')).success ||
      params.has('code') === params.has('error') ||
      (params.has('code') && !params.get('code')?.length)
    ) {
      return respond(errorResponse('VALIDATION_FAILED', 'Invalid Tesla callback', requestId));
    }
    const tokens = new SupabaseTokenStore(
      config.supabaseUrl,
      config.serviceKey,
      config.encryptionKey,
    );
    return respond(
      await completeTeslaAuthorization(
        {
          state: params.get('state')!,
          ...(params.has('code')
            ? { code: params.get('code')! }
            : { error: 'authorization_denied' }),
        },
        env,
        states,
        {
          authorize: async (state) => {
            if (!(await tokens.isOAuthAdministrator(state.householdId, state.userId))) return false;
            await rateLimit(`staging:tesla:callback:${state.userId}`);
            return true;
          },
          persist: (state, credentials) =>
            tokens.saveTokensForOAuth(state.householdId, state.userId, credentials),
        },
        new TeslaClient(),
        requestId,
      ),
    );
  } catch (error) {
    if (error instanceof OAuthRateLimitError)
      return respond(
        errorResponse('RATE_LIMITED', 'Rate limit exceeded', requestId, undefined, {
          'retry-after': '60',
        }),
      );
    if (error instanceof SupabasePostgrestError && (error.status === 401 || error.status === 403)) {
      return respond(
        errorResponse(
          error.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
          'Database authorization failed',
          requestId,
        ),
      );
    }
    return respond(
      errorResponse('PROVIDER_UNAVAILABLE', 'Staging Tesla authorization unavailable', requestId),
    );
  }
}

async function boundedConnectBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const decoder = new TextDecoder();
  let text = '';
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    length += chunk.value.byteLength;
    if (length > 1024) {
      await reader.cancel();
      throw new Error('Body too large');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}
