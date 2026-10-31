import {
  ACCESS_MIN_ROLE,
  pathParamsSchema,
  type AuditQuery,
  type CommandRequest,
  type ConnectTeslaRequest,
  type CreateRuleRequest,
  type CreateSiteRequest,
  type CreateTariffRequest,
  type DeleteAccountRequest,
  type DeleteHouseholdRequest,
  type EndTariffRequest,
  type PutPricePointsRequest,
  type Role,
  type UpdateHouseholdRequest,
  type UpdateHouseholdSettingsRequest,
  type UpdateRuleRequest,
  type UpdateSiteRequest,
} from '@autopw3/shared';
import { InMemoryRepository, type Repository } from '../db/repository';
import { SupabaseIdentityRepository, type IdentityRepository } from '../db/identity-repository';
import { AuthenticatedPostgrestClient } from '../db/postgrest';
import type { Env } from '../env';
import { applyCorsHeaders, handleCorsPreflight, parseCorsConfig } from './cors';
import { errorResponse } from './errors';
import {
  defaultIdempotencyStore,
  hashCanonicalBody,
  isValidIdempotencyKey,
  type IdempotencyStore,
} from './idempotency';
import { verifySupabaseJwt, type JwtVerifyConfig, type VerifiedUser } from './jwt';
import { defaultRateLimiter, determineRateLimit, type RateLimiter } from './rate-limiter';
import { matchRoute } from './router';

// Route handlers
import {
  handleAcceptInvitation,
  handleChangeMemberRole,
  handleCreateInvitation,
  handleGetHousehold,
  handleGetMe,
  handleGetSettings,
  handleListInvitations,
  handleListMembers,
  handleRevokeInvitation,
} from '../routes/identity';
import {
  handleGetCapabilities,
  handleGetDemoEnergy,
  handleGetDemoLive,
  handleGetSite,
  handleListSites,
} from '../routes/sites';
import {
  handleCreateTariff,
  handleDeleteTariff,
  handleEndTariff,
  handleGetTariff,
  handleListTariffs,
  handlePutPricePoints,
  handleValidateTariff,
} from '../routes/tariffs';
import {
  handleActivateRule,
  handleCreateCommand,
  handleCreateRule,
  handleDeleteRule,
  handleGetCommand,
  handleListCommands,
  handleListExecutions,
  handleListRules,
  handlePauseAutomation,
  handleResumeAutomation,
  handleUpdateRule,
} from '../routes/automation';
import {
  handleConnectTesla,
  handleCreateSite,
  handleDisconnectTesla,
  handleGetTeslaLink,
  handleListDiscoveredSites,
  handleTeslaCallback,
} from '../routes/tesla';
import {
  handleGetCosts,
  handleGetEnergy,
  handleGetLiveTelemetry,
  handleGetPower,
} from '../routes/telemetry';
import {
  handleDeleteHousehold,
  handleDeleteMe,
  handleExportHousehold,
  handleExportMe,
  handleLeaveHousehold,
  handleListAudit,
  handleRemoveMember,
  handleUpdateHousehold,
  handleUpdateSettings,
  handleUpdateSite,
} from '../routes/admin';
import type { CostsQuery, EnergyQuery, PowerQuery } from '@autopw3/shared';
import { MockTeslaClient } from '../providers/tesla/mock-adapter';
import { TeslaClient, type ITeslaClient } from '../providers/tesla/client';
import { InMemoryOAuthStateStore, type OAuthStateStore } from '../providers/tesla/oauth';
import { InMemoryTokenStore, type TokenStore } from '../services/tokens/store';

export interface AppDependencies {
  readonly repo?: Repository | undefined;
  readonly idempotencyStore?: IdempotencyStore | undefined;
  readonly rateLimiter?: RateLimiter | undefined;
  readonly jwtConfig?: JwtVerifyConfig | undefined;
  readonly teslaClient?: ITeslaClient | undefined;
  readonly tokenStore?: TokenStore | undefined;
  readonly oauthStateStore?: OAuthStateStore | undefined;
  readonly fetcher?: typeof fetch | undefined;
}

const defaultRepo = new InMemoryRepository();
const defaultOAuthStateStore = new InMemoryOAuthStateStore();
const defaultTeslaClient = new MockTeslaClient();

const DEPLOY_ENVIRONMENTS = new Set(['staging', 'production']);
const IDENTITY_ROUTES = new Set([
  'getMe',
  'getHousehold',
  'updateHousehold',
  'listMembers',
  'changeMemberRole',
  'createInvitation',
  'listInvitations',
  'revokeInvitation',
  'acceptInvitation',
  'getSettings',
  'removeMember',
  'updateSettings',
  'leaveHousehold',
]);

export async function handleApiRequest(
  request: Request,
  env: Env,
  deps: AppDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();
  const corsConfig = parseCorsConfig(env.ALLOWED_ORIGINS);
  const isDeployEnvironment = DEPLOY_ENVIRONMENTS.has(env.ENVIRONMENT);
  const isExplicitLocalMock =
    env.ENVIRONMENT === 'test' || (env.ENVIRONMENT === 'local' && env.LOCAL_MOCKS === 'true');

  // Production and staging are deliberately unavailable until durable PostgreSQL-backed adapters
  // for repository, tokens, OAuth state, idempotency and rate limiting are wired into the entry point.
  // Never serve any API response from process-local defaults in a deployment environment.
  if (
    url.pathname.startsWith('/api/v1/') &&
    (isDeployEnvironment || (!isExplicitLocalMock && !hasCompleteInjectedDependencies(deps)))
  ) {
    return applyCorsHeaders(
      errorResponse(
        'PROVIDER_UNAVAILABLE',
        'Application API is disabled until durable storage is configured',
        requestId,
      ),
      request,
      corsConfig,
    );
  }

  // 1. CORS Preflight
  const preflight = handleCorsPreflight(request, corsConfig, requestId);
  if (preflight) return preflight;

  // 2. Base Path Routing (SPA vs API)
  if (!url.pathname.startsWith('/api/v1/')) {
    if (url.pathname === '/api/v1/health') {
      // fallback
    } else if (url.pathname.startsWith('/api/')) {
      return applyCorsHeaders(
        errorResponse('NOT_FOUND', 'API endpoint not found', requestId),
        request,
        corsConfig,
      );
    } else {
      return env.ASSETS.fetch(request);
    }
  }

  const apiPath = url.pathname.replace(/^\/api\/v1/, '') || '/';

  // 3. Match Route Spec
  const matched = matchRoute(request.method, apiPath);
  if (!matched) {
    return applyCorsHeaders(
      errorResponse('NOT_FOUND', 'Endpoint not found', requestId),
      request,
      corsConfig,
    );
  }
  if (matched.methodNotAllowed) {
    return applyCorsHeaders(
      errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed for endpoint', requestId),
      request,
      corsConfig,
    );
  }

  const { routeName, spec, pathParams } = matched.match!;
  if (
    !deps.tokenStore &&
    !env.TOKEN_ENCRYPTION_KEY &&
    ['connectTesla', 'teslaCallback', 'listDiscoveredSites', 'disconnectTesla'].includes(routeName)
  ) {
    return applyCorsHeaders(
      errorResponse('PROVIDER_UNAVAILABLE', 'Token encryption is not configured', requestId),
      request,
      corsConfig,
    );
  }

  const repo = deps.repo ?? defaultRepo;
  const idempotencyStore = deps.idempotencyStore ?? defaultIdempotencyStore;
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
  const teslaClient = deps.teslaClient ?? resolveTeslaClient(env, deps.fetcher);
  const tokenStore =
    deps.tokenStore ??
    (env.TOKEN_ENCRYPTION_KEY ? new InMemoryTokenStore(env.TOKEN_ENCRYPTION_KEY) : undefined);
  const oauthStateStore = deps.oauthStateStore ?? defaultOAuthStateStore;

  // 4. Request Body Size Limit Check (64 KiB default, 1 MiB for dynamic price points)
  const isPricePointsRoute = apiPath.includes('/price-points');
  const maxBytes = isPricePointsRoute ? 1_048_576 : 65_536;

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(contentLength) && contentLength > maxBytes) {
      return applyCorsHeaders(
        errorResponse('PAYLOAD_TOO_LARGE', 'Request body exceeds maximum allowed size', requestId),
        request,
        corsConfig,
      );
    }
  }

  let rawBodyText = '';
  if (
    request.method === 'POST' ||
    request.method === 'PATCH' ||
    request.method === 'PUT' ||
    request.method === 'DELETE'
  ) {
    rawBodyText = await request.text();
    const byteLength = new TextEncoder().encode(rawBodyText).length;
    if (byteLength > maxBytes) {
      return applyCorsHeaders(
        errorResponse('PAYLOAD_TOO_LARGE', 'Request body exceeds maximum allowed size', requestId),
        request,
        corsConfig,
      );
    }
  }

  // 5. Authentication (JWT verification)
  let user: VerifiedUser | null = null;
  const authHeader = request.headers.get('authorization');

  if (spec.access !== 'public') {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return applyCorsHeaders(
        errorResponse('UNAUTHENTICATED', 'Missing or invalid authorization token', requestId),
        request,
        corsConfig,
      );
    }

    const token = authHeader.substring(7).trim();
    const jwtConfig: JwtVerifyConfig = deps.jwtConfig ?? {
      supabaseUrl: env.SUPABASE_URL,
      issuer: env.JWT_ISSUER,
      jwksUrl: env.JWT_JWKS_URL,
    };

    try {
      user = await verifySupabaseJwt(token, jwtConfig);
    } catch {
      return applyCorsHeaders(
        errorResponse('UNAUTHENTICATED', 'Invalid or expired authorization token', requestId),
        request,
        corsConfig,
      );
    }
  }

  // Construct one authenticated database client per verified request. It captures only this
  // request's bearer and is never stored in module state or passed to privileged handlers.
  const identityRepo: IdentityRepository =
    user && env.SUPABASE_URL && env.SUPABASE_ANON_KEY
      ? new SupabaseIdentityRepository(
          new AuthenticatedPostgrestClient(
            env.SUPABASE_URL,
            env.SUPABASE_ANON_KEY,
            authHeader!.substring(7).trim(),
            deps.fetcher,
          ),
          user.userId,
        )
      : (repo as Repository & IdentityRepository);

  // 6. Schema Validations: Path Parameters
  const pathValidation = pathParamsSchema(spec.path).safeParse(pathParams);
  if (!pathValidation.success) {
    return applyCorsHeaders(
      errorResponse(
        'VALIDATION_FAILED',
        'Invalid path parameter format',
        requestId,
        pathValidation.error.issues.map((i) => ({ path: i.path.join('.'), issue: i.code })),
      ),
      request,
      corsConfig,
    );
  }

  // 7. Schema Validations: Query Parameters
  let parsedQuery: Record<string, unknown> = {};
  if (spec.query) {
    const rawQuery: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) {
      rawQuery[k] = v;
    }
    const queryValidation = spec.query.safeParse(rawQuery);
    if (!queryValidation.success) {
      return applyCorsHeaders(
        errorResponse(
          'VALIDATION_FAILED',
          'Invalid query parameters',
          requestId,
          queryValidation.error.issues.map((i) => ({ path: i.path.join('.'), issue: i.code })),
        ),
        request,
        corsConfig,
      );
    }
    parsedQuery = queryValidation.data as Record<string, unknown>;
  }

  // 8. Schema Validations: Body
  let parsedBody: unknown = undefined;
  if (spec.body) {
    let json: unknown;
    try {
      json = rawBodyText.length > 0 ? JSON.parse(rawBodyText) : {};
    } catch {
      return applyCorsHeaders(
        errorResponse('VALIDATION_FAILED', 'Malformed JSON in request body', requestId, [
          { path: 'body', issue: 'invalid_json' },
        ]),
        request,
        corsConfig,
      );
    }

    const bodyValidation = spec.body.safeParse(json);
    if (!bodyValidation.success) {
      return applyCorsHeaders(
        errorResponse(
          'VALIDATION_FAILED',
          'Invalid request body',
          requestId,
          bodyValidation.error.issues.map((i) => ({ path: i.path.join('.'), issue: i.code })),
        ),
        request,
        corsConfig,
      );
    }
    parsedBody = bodyValidation.data;
  }

  // 9. Idempotency Key Handling
  const idempotencyKey = request.headers.get('idempotency-key');
  if (spec.idempotencyKeyRequired && (!idempotencyKey || !isValidIdempotencyKey(idempotencyKey))) {
    return applyCorsHeaders(
      errorResponse(
        'VALIDATION_FAILED',
        'Missing or invalid Idempotency-Key header (must be 8-128 chars [A-Za-z0-9_-])',
        requestId,
        [{ path: 'idempotency-key', issue: 'invalid_header' }],
      ),
      request,
      corsConfig,
    );
  }

  let bodyHash = '';
  const idempotencyScope = user?.userId ?? 'anonymous';
  if (idempotencyKey) {
    bodyHash = await hashCanonicalBody(rawBodyText);
    const existing = await idempotencyStore.get(idempotencyScope, idempotencyKey);
    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        return applyCorsHeaders(
          errorResponse(
            'CONFLICT',
            'Idempotency key re-used with different request body',
            requestId,
          ),
          request,
          corsConfig,
        );
      }

      let replayBody: unknown;
      try {
        replayBody = JSON.parse(existing.body);
      } catch {
        replayBody = existing.body;
      }

      // Special case: D-036 invitation token redacted on replay
      if (
        routeName === 'createInvitation' &&
        typeof replayBody === 'object' &&
        replayBody !== null
      ) {
        replayBody = {
          ...(replayBody as Record<string, unknown>),
          token: null,
          link: null,
        };
      }

      const replayResponse = new Response(JSON.stringify(replayBody), {
        status: existing.status,
        headers: {
          ...existing.headers,
          'idempotent-replay': 'true',
          'x-request-id': requestId,
        },
      });
      return applyCorsHeaders(replayResponse, request, corsConfig);
    }
  }

  // 10. Rate Limiting Check
  const rateLimitKey = user ? user.userId : (request.headers.get('cf-connecting-ip') ?? 'anon');
  const { limit, windowSeconds } = determineRateLimit(request.method, apiPath, Boolean(user));
  const rateLimitRes = await rateLimiter.check(rateLimitKey, limit, windowSeconds);
  if (!rateLimitRes.allowed) {
    return applyCorsHeaders(
      errorResponse('RATE_LIMITED', 'Rate limit exceeded', requestId, undefined, {
        'retry-after': String(rateLimitRes.retryAfterSeconds ?? 60),
      }),
      request,
      corsConfig,
    );
  }

  // 11. Authoritative Membership & Role Check
  let userRole: Role = 'READ_ONLY';
  if (spec.access !== 'public' && spec.access !== 'any') {
    let targetHouseholdId: string | null = null;
    if (pathParams['hid']) {
      targetHouseholdId = pathParams['hid'];
    } else if (pathParams['siteId']) {
      targetHouseholdId = await repo.getHouseholdIdForSite(pathParams['siteId']);
      if (!targetHouseholdId) {
        return applyCorsHeaders(
          errorResponse('NOT_FOUND', 'Energy site not found', requestId),
          request,
          corsConfig,
        );
      }
    } else if (pathParams['tariffId']) {
      targetHouseholdId = await repo.getHouseholdIdForTariff(pathParams['tariffId']);
      if (!targetHouseholdId) {
        return applyCorsHeaders(
          errorResponse('NOT_FOUND', 'Tariff not found', requestId),
          request,
          corsConfig,
        );
      }
    } else if (pathParams['ruleId']) {
      targetHouseholdId = await repo.getHouseholdIdForRule(pathParams['ruleId']);
      if (!targetHouseholdId) {
        return applyCorsHeaders(
          errorResponse('NOT_FOUND', 'Automation rule not found', requestId),
          request,
          corsConfig,
        );
      }
    } else if (pathParams['commandId']) {
      targetHouseholdId = await repo.getHouseholdIdForCommand(pathParams['commandId']);
      if (!targetHouseholdId) {
        return applyCorsHeaders(
          errorResponse('NOT_FOUND', 'Command not found', requestId),
          request,
          corsConfig,
        );
      }
    }

    if (!targetHouseholdId) {
      return applyCorsHeaders(
        errorResponse('NOT_FOUND', 'Resource not found', requestId),
        request,
        corsConfig,
      );
    }

    const authorizationRepo = IDENTITY_ROUTES.has(routeName) ? identityRepo : repo;
    const membership = await authorizationRepo.getMembership(targetHouseholdId, user!.userId);
    if (!membership) {
      // Cross-household access returns 404 to avoid leaking existence
      return applyCorsHeaders(
        errorResponse('NOT_FOUND', 'Resource not found', requestId),
        request,
        corsConfig,
      );
    }

    userRole = membership.role;
    const minRole = ACCESS_MIN_ROLE[spec.access];

    if (minRole === 'ADMIN' && userRole !== 'ADMIN') {
      return applyCorsHeaders(
        errorResponse('FORBIDDEN', 'Insufficient permissions: ADMIN role required', requestId),
        request,
        corsConfig,
      );
    }

    if (minRole === 'READ_WRITE' && userRole === 'READ_ONLY') {
      return applyCorsHeaders(
        errorResponse('FORBIDDEN', 'Insufficient permissions: READ_WRITE role required', requestId),
        request,
        corsConfig,
      );
    }
  }

  // 12. Dispatch to Typed Route Handler
  let handlerResponse: Response;

  switch (routeName) {
    case 'health': {
      handlerResponse = new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': requestId,
          'cache-control': 'no-store',
        },
      });
      break;
    }
    case 'getMe': {
      handlerResponse = await handleGetMe(user!, identityRepo, requestId);
      break;
    }
    case 'getHousehold': {
      handlerResponse = await handleGetHousehold(pathParams['hid']!, identityRepo, requestId);
      break;
    }
    case 'listMembers': {
      handlerResponse = await handleListMembers(
        pathParams['hid']!,
        parsedQuery as { limit?: number; cursor?: string },
        identityRepo,
        requestId,
      );
      break;
    }
    case 'changeMemberRole': {
      handlerResponse = await handleChangeMemberRole(
        pathParams['hid']!,
        pathParams['userId']!,
        parsedBody as { role: Role },
        user!,
        identityRepo,
        requestId,
      );
      break;
    }
    case 'createInvitation': {
      handlerResponse = await handleCreateInvitation(
        pathParams['hid']!,
        parsedBody as { email?: string; role?: Role; expiresInDays?: number },
        user!,
        identityRepo,
        {
          appBaseUrl: env.APP_BASE_URL,
          allowedOrigins: env.ALLOWED_ORIGINS,
          environment: env.ENVIRONMENT,
        },
        requestId,
      );
      break;
    }
    case 'listInvitations': {
      handlerResponse = await handleListInvitations(
        pathParams['hid']!,
        parsedQuery as { limit?: number; cursor?: string },
        identityRepo,
        requestId,
      );
      break;
    }
    case 'revokeInvitation': {
      handlerResponse = await handleRevokeInvitation(
        pathParams['hid']!,
        pathParams['id']!,
        identityRepo,
        requestId,
      );
      break;
    }
    case 'acceptInvitation': {
      handlerResponse = await handleAcceptInvitation(
        parsedBody as { token: string },
        user!,
        identityRepo,
        requestId,
      );
      break;
    }
    case 'getSettings': {
      handlerResponse = await handleGetSettings(pathParams['hid']!, identityRepo, requestId);
      break;
    }
    case 'listSites': {
      handlerResponse = await handleListSites(
        pathParams['hid']!,
        parsedQuery as { limit?: number; cursor?: string },
        repo,
        requestId,
      );
      break;
    }
    case 'getSite': {
      handlerResponse = await handleGetSite(pathParams['siteId']!, repo, requestId);
      break;
    }
    case 'connectTesla': {
      handlerResponse = await handleConnectTesla(
        pathParams['hid']!,
        parsedBody as ConnectTeslaRequest,
        user!.userId,
        env,
        oauthStateStore,
        requestId,
      );
      break;
    }
    case 'teslaCallback': {
      handlerResponse = await handleTeslaCallback(
        parsedQuery as { code: string; state: string },
        env,
        oauthStateStore,
        tokenStore!,
        repo,
        teslaClient,
        requestId,
        deps.fetcher,
      );
      break;
    }
    case 'getTeslaLink': {
      handlerResponse = await handleGetTeslaLink(pathParams['hid']!, repo, requestId);
      break;
    }
    case 'listDiscoveredSites': {
      handlerResponse = await handleListDiscoveredSites(
        pathParams['hid']!,
        tokenStore!,
        teslaClient,
        requestId,
      );
      break;
    }
    case 'createSite': {
      handlerResponse = await handleCreateSite(
        pathParams['hid']!,
        parsedBody as CreateSiteRequest,
        repo,
        requestId,
      );
      break;
    }
    case 'disconnectTesla': {
      handlerResponse = await handleDisconnectTesla(
        pathParams['hid']!,
        repo,
        tokenStore!,
        requestId,
      );
      break;
    }
    case 'getCapabilities': {
      handlerResponse = await handleGetCapabilities(pathParams['siteId']!, repo, requestId);
      break;
    }
    case 'getLive': {
      handlerResponse = await handleGetLiveTelemetry(
        pathParams['siteId']!,
        repo,
        requestId,
        tokenStore,
        teslaClient,
      );
      break;
    }
    case 'getPower': {
      handlerResponse = await handleGetPower(
        pathParams['siteId']!,
        parsedQuery as unknown as PowerQuery,
        repo,
        requestId,
      );
      break;
    }
    case 'getEnergy': {
      handlerResponse = await handleGetEnergy(
        pathParams['siteId']!,
        parsedQuery as unknown as EnergyQuery,
        repo,
        requestId,
      );
      break;
    }
    case 'getCosts': {
      handlerResponse = await handleGetCosts(
        pathParams['siteId']!,
        parsedQuery as unknown as CostsQuery,
        repo,
        requestId,
      );
      break;
    }
    case 'getDemoLive': {
      handlerResponse = await handleGetDemoLive(pathParams['hid']!, repo, requestId);
      break;
    }
    case 'getDemoEnergy': {
      handlerResponse = await handleGetDemoEnergy(
        pathParams['hid']!,
        parsedQuery as { from: string; to: string; resolution: 'interval' | 'hourly' | 'daily' },
        repo,
        requestId,
      );
      break;
    }
    case 'listTariffs': {
      handlerResponse = await handleListTariffs(
        pathParams['hid']!,
        parsedQuery as { direction?: string; asOf?: string; limit?: number; cursor?: string },
        repo,
        requestId,
      );
      break;
    }
    case 'getTariff': {
      handlerResponse = await handleGetTariff(pathParams['tariffId']!, repo, requestId);
      break;
    }
    case 'createTariff': {
      handlerResponse = await handleCreateTariff(
        pathParams['hid']!,
        parsedBody as CreateTariffRequest,
        repo,
        requestId,
      );
      break;
    }
    case 'validateTariff': {
      handlerResponse = await handleValidateTariff(pathParams['tariffId']!, repo, requestId);
      break;
    }
    case 'endTariff': {
      handlerResponse = await handleEndTariff(
        pathParams['tariffId']!,
        parsedBody as EndTariffRequest,
        repo,
        requestId,
      );
      break;
    }
    case 'deleteTariff': {
      handlerResponse = await handleDeleteTariff(pathParams['tariffId']!, repo, requestId);
      break;
    }
    case 'putPricePoints': {
      handlerResponse = await handlePutPricePoints(
        pathParams['tariffId']!,
        parsedBody as PutPricePointsRequest,
        repo,
        requestId,
      );
      break;
    }
    case 'listRules': {
      handlerResponse = await handleListRules(
        pathParams['siteId']!,
        parsedQuery as { limit?: number; cursor?: string },
        repo,
        requestId,
      );
      break;
    }
    case 'createRule': {
      handlerResponse = await handleCreateRule(
        pathParams['siteId']!,
        parsedBody as CreateRuleRequest,
        repo,
        requestId,
      );
      break;
    }
    case 'updateRule': {
      handlerResponse = await handleUpdateRule(
        pathParams['ruleId']!,
        parsedBody as UpdateRuleRequest,
        repo,
        requestId,
      );
      break;
    }
    case 'activateRule': {
      handlerResponse = await handleActivateRule(pathParams['ruleId']!, userRole, repo, requestId);
      break;
    }
    case 'deleteRule': {
      handlerResponse = await handleDeleteRule(pathParams['ruleId']!, repo, requestId);
      break;
    }
    case 'listExecutions': {
      handlerResponse = await handleListExecutions(
        pathParams['siteId']!,
        parsedQuery as { limit?: number; cursor?: string },
        repo,
        requestId,
      );
      break;
    }
    case 'createCommand': {
      handlerResponse = await handleCreateCommand(
        pathParams['siteId']!,
        parsedBody as CommandRequest,
        idempotencyKey ?? crypto.randomUUID(),
        user?.userId ?? null,
        repo,
        requestId,
        tokenStore,
        teslaClient,
      );
      break;
    }
    case 'listCommands': {
      handlerResponse = await handleListCommands(
        pathParams['siteId']!,
        parsedQuery as { limit?: number; cursor?: string },
        repo,
        requestId,
      );
      break;
    }
    case 'getCommand': {
      handlerResponse = await handleGetCommand(pathParams['commandId']!, repo, requestId);
      break;
    }
    case 'pauseAutomation': {
      handlerResponse = await handlePauseAutomation(pathParams['hid']!, repo, requestId);
      break;
    }
    case 'resumeAutomation': {
      handlerResponse = await handleResumeAutomation(pathParams['hid']!, repo, requestId);
      break;
    }
    case 'removeMember': {
      handlerResponse = await handleRemoveMember(
        pathParams['hid']!,
        pathParams['userId']!,
        user!,
        identityRepo,
        requestId,
        true,
      );
      break;
    }
    case 'updateSettings': {
      handlerResponse = await handleUpdateSettings(
        pathParams['hid']!,
        parsedBody as UpdateHouseholdSettingsRequest,
        user!,
        identityRepo,
        requestId,
        true,
      );
      break;
    }
    case 'updateHousehold': {
      handlerResponse = await handleUpdateHousehold(
        pathParams['hid']!,
        parsedBody as UpdateHouseholdRequest,
        user!,
        identityRepo,
        requestId,
        true,
      );
      break;
    }
    case 'updateSite': {
      handlerResponse = await handleUpdateSite(
        pathParams['siteId']!,
        parsedBody as UpdateSiteRequest,
        user!,
        repo,
        requestId,
      );
      break;
    }
    case 'listAudit': {
      handlerResponse = await handleListAudit(
        pathParams['hid']!,
        parsedQuery as AuditQuery,
        repo,
        requestId,
      );
      break;
    }
    case 'exportHousehold': {
      handlerResponse = await handleExportHousehold(pathParams['hid']!, user!, repo, requestId);
      break;
    }
    case 'deleteHousehold': {
      handlerResponse = await handleDeleteHousehold(
        pathParams['hid']!,
        parsedBody as DeleteHouseholdRequest,
        user!,
        repo,
        requestId,
      );
      break;
    }
    case 'exportMe': {
      handlerResponse = await handleExportMe(user!, repo, requestId);
      break;
    }
    case 'deleteMe': {
      handlerResponse = await handleDeleteMe(
        parsedBody as DeleteAccountRequest,
        user!,
        repo,
        requestId,
      );
      break;
    }
    case 'leaveHousehold': {
      handlerResponse = await handleLeaveHousehold(
        pathParams['householdId']!,
        user!,
        identityRepo,
        requestId,
        true,
      );
      break;
    }
    default: {
      handlerResponse = errorResponse(
        'NOT_IMPLEMENTED',
        'Endpoint not implemented in this phase',
        requestId,
      );
      break;
    }
  }

  // 13. Idempotent Response Caching (only on 2xx creating responses)
  if (idempotencyKey && handlerResponse.status >= 200 && handlerResponse.status < 300) {
    const responseClone = handlerResponse.clone();
    const responseBodyText = await responseClone.text();
    const responseHeaders: Record<string, string> = {};
    for (const [k, v] of handlerResponse.headers.entries()) {
      responseHeaders[k] = v;
    }

    await idempotencyStore.set({
      key: idempotencyKey,
      scope: idempotencyScope,
      bodyHash,
      status: handlerResponse.status,
      headers: responseHeaders,
      body: responseBodyText,
      createdAt: Date.now(),
    });
  }

  return applyCorsHeaders(handlerResponse, request, corsConfig);
}

function hasCompleteInjectedDependencies(deps: AppDependencies): boolean {
  return Boolean(
    deps.repo &&
    deps.idempotencyStore &&
    deps.rateLimiter &&
    deps.jwtConfig &&
    deps.tokenStore &&
    deps.oauthStateStore,
  );
}

function resolveTeslaClient(env: Env, fetcher?: typeof fetch): ITeslaClient {
  if (env.PROVIDER_MODE === 'mock' && !DEPLOY_ENVIRONMENTS.has(env.ENVIRONMENT)) {
    return defaultTeslaClient;
  }
  if (env.PROVIDER_MODE === 'mock' && env.ENVIRONMENT === 'staging') {
    return defaultTeslaClient;
  }
  if (
    env.PROVIDER_MODE === 'live' &&
    env.TESLA_CLIENT_ID &&
    env.TESLA_CLIENT_SECRET &&
    env.TOKEN_ENCRYPTION_KEY
  ) {
    return new TeslaClient(fetcher);
  }
  // Do not silently substitute a mock provider in a deployment environment.
  if (DEPLOY_ENVIRONMENTS.has(env.ENVIRONMENT)) {
    throw new Error('Tesla provider configuration is unavailable');
  }
  return defaultTeslaClient;
}
