import { UuidSchema } from '@autopw3/shared';
import { z } from 'zod';
import { SupabaseIdentityRepository } from '../db/identity-repository';
import { AuthenticatedPostgrestClient, SupabasePostgrestError } from '../db/postgrest';
import { createPrivilegedRpcClient } from '../db/system-client';
import type { Env } from '../env';
import { TeslaClient } from '../providers/tesla/client';
import type { OAuthStateStore } from '../providers/tesla/oauth';
import { requireTeslaFleetOrigin } from '../providers/tesla/region';
import { completeTeslaAuthorization, handleConnectTesla } from '../routes/tesla';
import { parseSecretKey } from '../services/tokens/encryption';
import { SupabaseOAuthStateStore, SupabaseTokenStore } from '../services/tokens/supabase-store';
import { applyCorsHeaders } from './cors';
import { errorResponse } from './errors';
import { verifySupabaseJwt } from './jwt';
import { SupabaseRateLimiter } from './rate-limiter';
import { httpsOrigin, stagingConfig } from './staging-config';
import {
  createOAuthBrowserCookie,
  oauthBrowserLeaseKey,
  readOAuthBrowserCookie,
  TESLA_OAUTH_COOKIE_SECONDS,
} from './staging-tesla-oauth-cookie';

const CALLBACK = '/api/v1/provider/tesla/callback';
const HEADERS = ['authorization', 'content-type', 'x-request-id'];
const connectBody = z
  .object({ enableControls: z.literal(false).optional(), restart: z.boolean().optional() })
  .strict();
const completionBody = z.union([
  z.object({ state: UuidSchema, code: z.string().min(1).max(4096) }).strict(),
  z.object({ state: UuidSchema, error: z.literal('authorization_denied') }).strict(),
]);

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
  const isCallback =
    url.pathname === CALLBACK && (request.method === 'GET' || request.method === 'POST');
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
  const respond = (response: Response, cookie?: string) => {
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store');
    headers.set('referrer-policy', 'no-referrer');
    // Fixed-name cookie deletion cannot be conditional on the browser's current value.
    // No callback (including a successful one) may delete a newer transaction's cookie.
    if (cookie) headers.set('set-cookie', cookie);
    const secured = new Response(response.body, { status: response.status, headers });
    return isConnect ? applyCorsHeaders(secured, request, cors) : secured;
  };
  // GET is only a navigation bridge. Authenticated POST performs the actual completion.
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
    const leases = createPrivilegedRpcClient(config.supabaseUrl, config.serviceKey);
    const release = async (key: string, owner: string) => {
      // A lost cleanup response leaves a bounded lease, never a reusable authorization grant.
      await leases
        .call<boolean>('worker_release_lock', { p_key: key, p_owner: owner })
        .catch(() => undefined);
    };
    const releaseTransaction = async (householdId: string, key: string, owner: string) => {
      await release(`staging:tesla:oauth:household:${householdId}`, owner);
      await release(key, owner);
    };
    const authenticatedSession = async () => {
      const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) return null;
      try {
        const user = await verifySupabaseJwt(token, {
          supabaseUrl: config.supabaseUrl,
          audience: 'authenticated',
          requireSessionId: true,
        });
        return {
          token,
          userId: UuidSchema.parse(user.userId),
          sessionId: UuidSchema.parse(user.sessionId),
          expiresAt: user.expiresAt!,
        };
      } catch {
        return null;
      }
    };
    const rateLimit = async (key: string) => {
      if (!(await limiter.check(key, 10, 60)).allowed) throw new OAuthRateLimitError();
    };
    if (isConnect) {
      const householdId = match![1]!;
      if (!UuidSchema.safeParse(householdId).success || url.search) {
        return respond(errorResponse('VALIDATION_FAILED', 'Invalid connect request', requestId));
      }
      const session = await authenticatedSession();
      if (!session) {
        return respond(
          errorResponse('UNAUTHENTICATED', 'Invalid or expired authorization token', requestId),
        );
      }
      const { token, userId, sessionId } = session;
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
      const leaseKey = await oauthBrowserLeaseKey(userId);
      const leaseOwner = crypto.randomUUID();
      const expiresAt = Date.now() + TESLA_OAUTH_COOKIE_SECONDS * 1000;
      // Also serializes simultaneous initial requests that have not received a cookie yet.
      if (
        (await leases.call<boolean>('worker_begin_tesla_oauth', {
          p_household_id: householdId,
          p_user_id: userId,
          p_session_id: sessionId,
          p_session_expires_at: new Date(session.expiresAt * 1000).toISOString(),
          p_owner: leaseOwner,
          p_restart: body.restart ?? false,
        })) !== true
      ) {
        return respond(
          errorResponse('CONFLICT', 'A Tesla connection is already pending', requestId),
        );
      }
      let cookie: string | undefined;
      let issued = false;
      try {
        const correlatedStates: OAuthStateStore = {
          saveState: async (payload) => {
            const bounded = { ...payload, expiresAt: Math.min(payload.expiresAt, expiresAt) };
            const pending = await createOAuthBrowserCookie(
              {
                state: bounded.state,
                sessionId,
                householdId,
                expiresAt: bounded.expiresAt,
                leaseKey,
                leaseOwner,
              },
              config.encryptionKey,
            );
            await states.saveState(bounded);
            cookie = pending;
          },
          consumeState: (state) => states.consumeState(state),
        };
        const response = await handleConnectTesla(
          householdId,
          body,
          userId,
          env,
          correlatedStates,
          requestId,
        );
        if (response.status !== 200 || !cookie) throw new Error('OAuth initiation failed');
        issued = true;
        return respond(response, cookie);
      } finally {
        if (!issued) await releaseTransaction(householdId, leaseKey, leaseOwner);
      }
    }
    let completion: z.infer<typeof completionBody>;
    try {
      if (request.method === 'GET') {
        const params = url.searchParams;
        const allowed = ['state', 'code', 'error', 'error_description', 'issuer'];
        if (
          url.search.length > 8192 ||
          [...params.keys()].some(
            (key) => !allowed.includes(key) || params.getAll(key).length !== 1,
          ) ||
          params.has('code') === params.has('error') ||
          (params.has('issuer') && params.get('issuer') !== 'https://auth.tesla.com/oauth2/v3')
        )
          throw new Error('Invalid callback');
        completion = completionBody.parse({
          state: params.get('state'),
          ...(params.has('code')
            ? { code: params.get('code') }
            : { error: 'authorization_denied' }),
        });
      } else {
        if (
          url.search ||
          origin !== config.appOrigin ||
          !request.headers.get('content-type')?.startsWith('application/json')
        )
          throw new Error('Invalid completion');
        completion = completionBody.parse(JSON.parse(await boundedConnectBody(request, 8192)));
      }
    } catch {
      return respond(errorResponse('VALIDATION_FAILED', 'Invalid Tesla callback', requestId));
    }
    const binding = await readOAuthBrowserCookie(request, config.encryptionKey);
    if (!binding || binding.state !== completion.state) {
      return respond(
        errorResponse(
          'VALIDATION_FAILED',
          'Invalid or expired Tesla browser correlation',
          requestId,
        ),
      );
    }
    if (request.method === 'GET') {
      // Codes stay in the fragment, never in the completion page's HTTP URL or storage.
      // Supabase also detects code/error URL parameters. Do not let it parse Tesla's callback.
      const fragment = new URLSearchParams({
        tesla_state: completion.state,
        ...('code' in completion
          ? { tesla_code: completion.code }
          : { tesla_error: completion.error }),
      }).toString();
      return respond(
        new Response(null, {
          status: 303,
          headers: { location: `${config.appOrigin}/auth/tesla/callback#${fragment}` },
        }),
      );
    }
    const session = await authenticatedSession();
    if (
      !session ||
      session.sessionId !== binding.sessionId ||
      (await oauthBrowserLeaseKey(session.userId)) !== binding.leaseKey
    ) {
      return respond(
        errorResponse('UNAUTHENTICATED', 'The initiating session is required', requestId),
      );
    }
    const sessionArguments = {
      p_household_id: binding.householdId,
      p_user_id: session.userId,
      p_session_id: session.sessionId,
      p_session_expires_at: new Date(session.expiresAt * 1000).toISOString(),
      p_owner: binding.leaseOwner,
    };
    const authorized = () =>
      leases.call<boolean>('worker_validate_tesla_oauth_session', sessionArguments);
    // Check the live Auth session and current ADMIN authority before consuming anything.
    if ((await authorized()) !== true)
      return respond(
        errorResponse('FORBIDDEN', 'Tesla authorization is no longer valid', requestId),
      );
    let consumed = false;
    const correlatedStates: OAuthStateStore = {
      saveState: (payload) => states.saveState(payload),
      consumeState: async (state) => {
        const payload = await states.consumeState(state);
        if (!payload) return null;
        consumed = true;
        if (
          payload.expiresAt !== binding.expiresAt ||
          payload.householdId !== binding.householdId ||
          payload.userId !== session.userId ||
          (await oauthBrowserLeaseKey(payload.userId)) !== binding.leaseKey
        )
          return null;
        return payload;
      },
    };
    const tokens = new SupabaseTokenStore(
      config.supabaseUrl,
      config.serviceKey,
      config.encryptionKey,
    );
    try {
      const response = await completeTeslaAuthorization(
        completion,
        env,
        correlatedStates,
        {
          authorize: async (state) => {
            if ((await authorized()) !== true) return false;
            await rateLimit(`staging:tesla:callback:${state.userId}`);
            return true;
          },
          persist: (state, credentials) =>
            tokens.saveTokensForFencedOAuth(state.householdId, state.userId, credentials, {
              sessionId: session.sessionId,
              sessionExpiresAt: session.expiresAt,
              leaseOwner: binding.leaseOwner,
            }),
        },
        new TeslaClient(),
        requestId,
      );
      return respond(response.status === 302 ? Response.json({ connected: true }) : response);
    } finally {
      // A replay loser must not release ownership while the successful callback is still running.
      if (consumed)
        await releaseTransaction(binding.householdId, binding.leaseKey, binding.leaseOwner);
    }
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

async function boundedConnectBody(request: Request, maxBytes = 1024): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const decoder = new TextDecoder();
  let text = '';
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    length += chunk.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('Body too large');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}
