import { TeslaSiteLinkRequestSchema, UuidSchema, type TeslaSiteLinkRequest } from '@autopw3/shared';
import { AuthenticatedPostgrestClient, SupabasePostgrestError } from '../db/postgrest';
import { SupabaseSiteLinkRepository } from '../db/site-link-repository';
import { SupabaseRpcError } from '../db/supabase-rpc';
import { createPrivilegedRpcClient } from '../db/system-client';
import type { Env } from '../env';
import { TeslaClient, TeslaRateLimitError } from '../providers/tesla/client';
import { TeslaHttpError } from '../providers/tesla/http';
import { TeslaOAuthError, validateReadOnlyTeslaScopes } from '../providers/tesla/oauth';
import { requireTeslaFleetOrigin } from '../providers/tesla/region';
import {
  discoveryCredentials,
  TeslaDiscoveryReauthorizationRequired,
} from '../services/tokens/discovery-refresh';
import { parseSecretKey } from '../services/tokens/encryption';
import { isTokenExpiredOrExpiring } from '../services/tokens/store';
import { SupabaseTokenStore } from '../services/tokens/supabase-store';
import { applyCorsHeaders } from './cors';
import { errorResponse, jsonResponse } from './errors';
import { isValidIdempotencyKey } from './idempotency';
import { verifySupabaseJwt } from './jwt';
import { SupabaseRateLimiter } from './rate-limiter';
import { RequestBudget } from './request-budget';
import { httpsOrigin, stagingConfig } from './staging-config';

const HEADERS = ['authorization', 'content-type', 'idempotency-key', 'x-request-id'];

/** No legacy repository/provider injection: these two exact routes construct only durable adapters. */
export async function handleStagingTeslaSitesRequest(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  const discovery =
    /^\/api\/v1\/households\/([0-9a-f-]{36})\/provider\/tesla\/discovered-sites$/.exec(
      url.pathname,
    );
  const linking = /^\/api\/v1\/households\/([0-9a-f-]{36})\/sites$/.exec(url.pathname);
  const match = discovery ?? linking;
  const method = discovery ? 'GET' : 'POST';
  if (
    env.ENVIRONMENT !== 'staging' ||
    env.STAGING_TESLA_SITES_ENABLED !== 'true' ||
    !match ||
    (request.method !== method && request.method !== 'OPTIONS')
  )
    return null;
  const budget = new RequestBudget();
  const fetcher = budget.fetcher();
  try {
    return await budget.run(async () => {
      let config: ReturnType<typeof stagingConfig>;
      let key: Uint8Array;
      try {
        config = stagingConfig(env);
        const appOrigin = httpsOrigin(env.APP_BASE_URL ?? '');
        if (url.origin !== appOrigin || !config.allowedOrigins.includes(appOrigin))
          throw new Error('Invalid origin');
        key = parseSecretKey(env.TOKEN_ENCRYPTION_KEY ?? '');
      } catch {
        return errorResponse(
          'PROVIDER_UNAVAILABLE',
          'Staging Tesla sites are not configured',
          requestId,
        );
      }
      const respond = (response: Response) => {
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'no-store');
        headers.set('referrer-policy', 'no-referrer');
        return applyCorsHeaders(
          new Response(response.body, { status: response.status, headers }),
          request,
          { allowedOrigins: config.allowedOrigins },
        );
      };
      const fail = (code: Parameters<typeof errorResponse>[0], message: string) =>
        respond(errorResponse(code, message, requestId));
      const origin = request.headers.get('origin');
      if (origin && !config.allowedOrigins.includes(origin))
        return fail('FORBIDDEN', 'Origin not allowed');
      const householdId = match[1]!;
      if (url.search || !UuidSchema.safeParse(householdId).success)
        return fail('VALIDATION_FAILED', 'Invalid site request');
      if (request.method === 'OPTIONS') {
        if (
          !origin ||
          request.headers.get('access-control-request-method') !== method ||
          (request.headers.get('access-control-request-headers') ?? '')
            .split(',')
            .filter(Boolean)
            .some((h) => !HEADERS.includes(h.trim().toLowerCase()))
        )
          return fail('FORBIDDEN', 'Preflight is not permitted');
        return respond(
          new Response(null, {
            status: 204,
            headers: {
              'access-control-allow-methods': method,
              'access-control-allow-headers': HEADERS.join(', '),
              'x-request-id': requestId,
            },
          }),
        );
      }
      const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) return fail('UNAUTHENTICATED', 'A bearer token is required');
      let user: Awaited<ReturnType<typeof verifySupabaseJwt>>;
      try {
        user = await verifySupabaseJwt(token, {
          supabaseUrl: config.supabaseUrl,
          audience: 'authenticated',
          requireSessionId: true,
        });
        UuidSchema.parse(user.userId);
      } catch {
        return fail('UNAUTHENTICATED', 'Invalid or expired authorization token');
      }
      let chosen: TeslaSiteLinkRequest | undefined;
      const idempotencyKey = request.headers.get('idempotency-key');
      if (linking) {
        try {
          if (
            !idempotencyKey ||
            !isValidIdempotencyKey(idempotencyKey) ||
            request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
              'application/json'
          )
            throw new Error('Invalid body');
          chosen = TeslaSiteLinkRequestSchema.parse(JSON.parse(await boundedBody(request)));
        } catch {
          return fail(
            'VALIDATION_FAILED',
            'A numeric providerSiteId and valid Idempotency-Key are required',
          );
        }
      }
      try {
        const limit = await new SupabaseRateLimiter(
          config.supabaseUrl,
          config.serviceKey,
          fetcher,
        ).check(`staging:tesla:sites:${user.userId}`, 10, 60);
        if (!limit.allowed)
          return respond(
            errorResponse('RATE_LIMITED', 'Rate limit exceeded', requestId, undefined, {
              'retry-after': String(limit.retryAfterSeconds ?? 60),
            }),
          );
        const repository = new SupabaseSiteLinkRepository(
          new AuthenticatedPostgrestClient(config.supabaseUrl, config.publicKey, token, fetcher),
        );
        const store = new SupabaseTokenStore(
          config.supabaseUrl,
          config.serviceKey,
          key,
          1,
          fetcher,
        );
        const credentials = discovery
          ? await discoveryCredentials({
              householdId,
              repository,
              store,
              budget,
              fetcher,
              clientId: env.TESLA_CLIENT_ID,
              clientSecret: env.TESLA_CLIENT_SECRET,
            })
          : {
              ...(await repository.context(householdId)),
              tokens: await store.getTokens(householdId),
            };
        const { tokens } = credentials;
        const context = { credentialRevision: credentials.credentialRevision };
        if (
          !tokens ||
          tokens.tokenType.toLowerCase() !== 'bearer' ||
          isTokenExpiredOrExpiring(tokens.expiresAt, 30)
        )
          return fail('PROVIDER_UNAVAILABLE', 'Active unexpired Tesla credentials are required');
        validateReadOnlyTeslaScopes(tokens.scope);
        const region = requireTeslaFleetOrigin(tokens.regionBaseUrl);
        const products = await new TeslaClient(fetcher).listProducts(region, tokens.accessToken);
        if (discovery) {
          if (
            (await repository.context(householdId)).credentialRevision !==
            context.credentialRevision
          )
            return fail('CONFLICT', 'Tesla credentials changed; retry discovery');
          return respond(
            jsonResponse(
              {
                items: products.map((p) => ({ providerSiteId: p.energySiteId, name: p.siteName })),
              },
              200,
              requestId,
            ),
          );
        }
        const site = products.find((p) => p.energySiteId === chosen!.providerSiteId);
        if (!site) return fail('NOT_FOUND', 'Tesla energy site is not available to this household');
        const proof = UuidSchema.parse(
          await createPrivilegedRpcClient(config.supabaseUrl, config.serviceKey).call<string>(
            'worker_prepare_tesla_site_link',
            {
              p_household_id: householdId,
              p_user_id: user.userId,
              p_session_id: user.sessionId,
              p_session_expires_at: new Date(user.expiresAt! * 1000).toISOString(),
              p_credential_revision: context.credentialRevision,
              p_provider_site_id: site.energySiteId,
              p_name: site.siteName,
              p_idempotency_key: idempotencyKey,
            },
          ),
        );
        const result = await repository.link(
          householdId,
          site.energySiteId,
          proof,
          idempotencyKey!,
        );
        return respond(jsonResponse(result, result.created ? 201 : 200, requestId));
      } catch (error) {
        const recoveryState =
          error instanceof TeslaDiscoveryReauthorizationRequired ||
          (error instanceof SupabasePostgrestError &&
            error.tag === 'tesla_reauthorization_required')
            ? 'TESLA_REAUTHORIZATION_REQUIRED'
            : error instanceof SupabasePostgrestError && error.tag === 'refresh_recovery_required'
              ? 'TESLA_RECOVERY_REQUIRED'
              : null;
        if (discovery && recoveryState)
          return respond(
            errorResponse('CONFLICT', 'Tesla authorization requires recovery', requestId, [
              { path: 'provider.tesla', issue: recoveryState },
            ]),
          );
        if (error instanceof SupabasePostgrestError || error instanceof SupabaseRpcError) {
          if (error.status === 401)
            return fail('UNAUTHENTICATED', 'Database authentication failed');
          if (error.status === 403)
            return fail('FORBIDDEN', 'Current household administrator session required');
          if (error.status === 409)
            return fail('CONFLICT', 'Site link or idempotency key conflicts with existing data');
        }
        if (
          error instanceof TeslaRateLimitError ||
          (error instanceof TeslaHttpError && error.status === 429) ||
          (error instanceof TeslaOAuthError && error.statusCode === 429)
        )
          return respond(
            errorResponse('RATE_LIMITED', 'Tesla rate limit exceeded', requestId, undefined, {
              'retry-after': String('retryAfterSeconds' in error ? error.retryAfterSeconds : 60),
            }),
          );
        return fail('PROVIDER_UNAVAILABLE', 'Tesla site discovery or linking is unavailable');
      }
    });
  } catch {
    return errorResponse(
      'PROVIDER_UNAVAILABLE',
      'Tesla discovery request deadline exceeded',
      requestId,
    );
  } finally {
    budget.dispose();
  }
}

async function boundedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const decoder = new TextDecoder();
  let length = 0;
  let body = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return body + decoder.decode();
    length += chunk.value.byteLength;
    if (length > 512) {
      await reader.cancel();
      throw new Error('Body too large');
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
}
