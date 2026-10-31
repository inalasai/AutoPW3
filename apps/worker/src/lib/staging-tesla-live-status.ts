import { UuidSchema } from '@autopw3/shared';
import { AuthenticatedPostgrestClient, SupabasePostgrestError } from '../db/postgrest';
import { SupabaseSiteReadRepository, type StoredSite } from '../db/site-read-repository';
import type { Env } from '../env';
import {
  TeslaAuthError,
  TeslaClient,
  TeslaNetworkError,
  TeslaRateLimitError,
} from '../providers/tesla/client';
import { TeslaHttpError } from '../providers/tesla/http';
import { readTeslaLiveStatus, requireTeslaEnergySiteId } from '../providers/tesla/live-status';
import { requireTeslaFleetOrigin } from '../providers/tesla/region';
import { parseSecretKey } from '../services/tokens/encryption';
import { isTokenExpiredOrExpiring } from '../services/tokens/store';
import { SupabaseTokenStore } from '../services/tokens/supabase-store';
import { applyCorsHeaders } from './cors';
import { errorResponse, jsonResponse } from './errors';
import { verifySupabaseJwt, type VerifiedUser } from './jwt';
import { SupabaseRateLimiter } from './rate-limiter';
import { httpsOrigin, stagingConfig } from './staging-config';

const HEADERS = ['authorization', 'content-type', 'x-request-id'];

/** An isolated read; deliberately never invokes the legacy persistence/demo telemetry route. */
export async function handleStagingTeslaLiveStatusRequest(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match =
    /^\/api\/v1\/households\/([0-9a-f-]{36})\/sites\/([0-9a-f-]{36})\/provider\/tesla\/live-status$/.exec(
      url.pathname,
    );
  if (
    env.ENVIRONMENT !== 'staging' ||
    env.STAGING_TESLA_LIVE_STATUS_ENABLED !== 'true' ||
    !match ||
    (request.method !== 'GET' && request.method !== 'OPTIONS')
  )
    return null;
  let config: ReturnType<typeof stagingConfig>;
  let encryptionKey: Uint8Array;
  try {
    config = stagingConfig(env);
    const appOrigin = httpsOrigin(env.APP_BASE_URL ?? '');
    if (url.origin !== appOrigin || !config.allowedOrigins.includes(appOrigin))
      throw new Error('Invalid staging origin');
    encryptionKey = parseSecretKey(env.TOKEN_ENCRYPTION_KEY ?? '');
  } catch {
    return errorResponse(
      'PROVIDER_UNAVAILABLE',
      'Staging Tesla live status is not configured',
      requestId,
    );
  }
  const cors = { allowedOrigins: config.allowedOrigins.map((origin) => origin.toLowerCase()) };
  const respond = (response: Response) => {
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store');
    headers.set('referrer-policy', 'no-referrer');
    return applyCorsHeaders(
      new Response(response.body, { status: response.status, headers }),
      request,
      cors,
    );
  };
  const unavailable = (issue: string, message: string) =>
    respond(
      errorResponse('PROVIDER_UNAVAILABLE', message, requestId, [{ path: 'provider', issue }]),
    );
  const notFound = () =>
    respond(errorResponse('NOT_FOUND', 'Linked energy site not found', requestId));
  const origin = request.headers.get('origin');
  if (origin && !cors.allowedOrigins.includes(origin.toLowerCase())) {
    return respond(errorResponse('FORBIDDEN', 'Origin not allowed', requestId));
  }
  if (
    url.search ||
    !UuidSchema.safeParse(match[1]).success ||
    !UuidSchema.safeParse(match[2]).success
  ) {
    return respond(errorResponse('VALIDATION_FAILED', 'Invalid live-status request', requestId));
  }
  if (request.method === 'OPTIONS') {
    if (
      !origin ||
      request.headers.get('access-control-request-method') !== 'GET' ||
      (request.headers.get('access-control-request-headers') ?? '')
        .split(',')
        .filter(Boolean)
        .some((header) => !HEADERS.includes(header.trim().toLowerCase()))
    ) {
      return respond(errorResponse('FORBIDDEN', 'Preflight is not permitted', requestId));
    }
    return respond(
      new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET',
          'access-control-allow-headers': HEADERS.join(', '),
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
    UuidSchema.parse(user.userId);
  } catch {
    return respond(
      errorResponse('UNAUTHENTICATED', 'Invalid or expired authorization token', requestId),
    );
  }
  try {
    const limiter = new SupabaseRateLimiter(config.supabaseUrl, config.serviceKey);
    const limit = await limiter.check(`staging:tesla:live-status:${user.userId}`, 10, 60);
    if (!limit.allowed)
      return respond(
        errorResponse('RATE_LIMITED', 'Rate limit exceeded', requestId, undefined, {
          'retry-after': String(limit.retryAfterSeconds ?? 60),
        }),
      );
    const repo = new SupabaseSiteReadRepository(
      new AuthenticatedPostgrestClient(config.supabaseUrl, config.publicKey, token),
      user,
    );
    const householdId = match[1]!;
    const siteId = match[2]!;
    const site = await repo.getSite(siteId);
    if (!site || site.householdId !== householdId || site.connectionState === 'DISCONNECTED')
      return notFound();
    try {
      requireTeslaEnergySiteId(site.providerSiteId);
    } catch {
      return unavailable('tesla_site_id_invalid', 'Stored Tesla energy site identifier is invalid');
    }
    const tokens = await new SupabaseTokenStore(
      config.supabaseUrl,
      config.serviceKey,
      encryptionKey,
    ).getTokens(site.householdId);
    if (!tokens)
      return unavailable(
        'tesla_credentials_missing',
        'No active Tesla credentials for this household',
      );
    if (tokens.tokenType.toLowerCase() !== 'bearer')
      return unavailable('tesla_credentials_invalid', 'Tesla credentials are invalid');
    if (!tokens.scope.split(' ').includes('energy_device_data')) {
      return unavailable(
        'tesla_read_scope_missing',
        'Tesla energy-device read authorization is required',
      );
    }
    let baseUrl: string;
    try {
      baseUrl = requireTeslaFleetOrigin(tokens.regionBaseUrl);
    } catch {
      return unavailable('tesla_region_invalid', 'Stored Tesla region is not approved');
    }
    // No refresh or near-expiry provider call; reserve the bounded request window.
    if (isTokenExpiredOrExpiring(tokens.expiresAt, 30)) {
      return unavailable(
        'tesla_credentials_expired',
        'Tesla access token expired or expiring; reconnect Tesla',
      );
    }
    const stillAuthorized = (current: StoredSite | null) =>
      current &&
      current.householdId === householdId &&
      current.providerSiteId === site.providerSiteId &&
      current.connectionState !== 'DISCONNECTED';
    // RLS rechecks after privileged credential I/O and after provider I/O. No reusable grant.
    if (!stillAuthorized(await repo.getSite(siteId))) return notFound();
    const raw = await new TeslaClient().getLiveStatus(
      baseUrl,
      site.providerSiteId,
      tokens.accessToken,
    );
    const snapshot = readTeslaLiveStatus(siteId, raw);
    if (!stillAuthorized(await repo.getSite(siteId))) return notFound();
    return respond(jsonResponse(snapshot, 200, requestId));
  } catch (error) {
    if (error instanceof SupabasePostgrestError) {
      if (error.status === 401)
        return respond(
          errorResponse('UNAUTHENTICATED', 'Database authentication failed', requestId),
        );
      if (error.status === 403)
        return respond(errorResponse('FORBIDDEN', 'Site access denied', requestId));
      return unavailable('database_unavailable', 'Site authorization is unavailable');
    }
    if (error instanceof TeslaAuthError)
      return unavailable('tesla_unauthorized', 'Tesla access was rejected; reconnect Tesla');
    if (error instanceof TeslaRateLimitError)
      return respond(
        errorResponse('RATE_LIMITED', 'Tesla rate limit exceeded', requestId, undefined, {
          'retry-after': String(error.retryAfterSeconds),
        }),
      );
    if (error instanceof TeslaNetworkError)
      return unavailable('tesla_network_failure', 'Tesla live status could not be reached');
    if (error instanceof TeslaHttpError) {
      if (error.status === 403)
        return unavailable('tesla_forbidden', 'Tesla denied access to this energy site');
      if (error.status === 404)
        return unavailable('tesla_site_not_found', 'Tesla energy site is unavailable');
      if (error.status >= 500)
        return unavailable('tesla_service_unavailable', 'Tesla service is unavailable');
      if (error.kind === 'TIMEOUT')
        return unavailable('tesla_timeout', 'Tesla live-status request timed out');
      if (error.kind === 'INVALID_RESPONSE')
        return unavailable(
          'tesla_invalid_response',
          'Tesla measurements are unavailable or invalid',
        );
      return unavailable('tesla_http_failure', 'Tesla live status is unavailable');
    }
    return unavailable('live_status_unavailable', 'Staging Tesla live status is unavailable');
  }
}
