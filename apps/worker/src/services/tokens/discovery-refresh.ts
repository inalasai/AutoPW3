import { SupabasePostgrestError } from '../../db/postgrest';
import type { SupabaseSiteLinkRepository } from '../../db/site-link-repository';
import type { RequestBudget } from '../../lib/request-budget';
import {
  refreshAccessToken,
  TeslaOAuthError,
  validateReadOnlyTeslaScopes,
} from '../../providers/tesla/oauth';
import { requireTeslaFleetOrigin } from '../../providers/tesla/region';
import type { SupabaseTokenStore } from './supabase-store';
import { isTokenExpiredOrExpiring, type DecryptedTokens } from './store';

interface DiscoveryCredentialsOptions {
  householdId: string;
  repository: SupabaseSiteLinkRepository;
  store: SupabaseTokenStore;
  budget: RequestBudget;
  fetcher: typeof fetch;
  clientId: string | undefined;
  clientSecret: string | undefined;
}

/** Fixed provider recovery state; never carries an upstream error, credential or actor identifier. */
export class TeslaDiscoveryReauthorizationRequired extends Error {
  constructor() {
    super('Tesla reauthorization required');
    this.name = 'TeslaDiscoveryReauthorizationRequired';
  }
}

function validate(tokens: DecryptedTokens | null): asserts tokens is DecryptedTokens {
  if (!tokens || tokens.tokenType.toLowerCase() !== 'bearer')
    throw new Error('Tesla credentials unavailable');
  validateReadOnlyTeslaScopes(tokens.scope);
  requireTeslaFleetOrigin(tokens.regionBaseUrl);
}

/** Only discovery calls this. SENT is a durable no-reexchange barrier, not a retryable lease. */
export async function discoveryCredentials(options: DiscoveryCredentialsOptions) {
  const { householdId, repository, store, budget } = options;
  const preflight = await budget.run(() => repository.discoveryContext(householdId));
  let committedRevision = preflight.credentialRevision;
  if (preflight.needsRefresh) {
    if (!options.clientId || !options.clientSecret)
      throw new Error('Tesla refresh is not configured');
    const owner = crypto.randomUUID();
    // A lost begin response must never cause an exchange: the durable SENT barrier may exist.
    const attempt = await budget.run(() =>
      repository.beginRefresh(householdId, preflight.credentialRevision, owner, budget.deadline),
    );
    try {
      if (attempt.state === 'SENT') {
        const tokens = await budget.run(() => store.getTokens(householdId));
        validate(tokens);
        const current = await budget.run(() => repository.discoveryContext(householdId));
        if (current.credentialRevision !== preflight.credentialRevision)
          throw new SupabasePostgrestError('refresh_revision', 409, null);
        let rotated: DecryptedTokens | null;
        try {
          const result = await budget.run(() =>
            refreshAccessToken(
              {
                clientId: options.clientId!,
                clientSecret: options.clientSecret!,
                refreshToken: tokens.refreshToken,
              },
              options.fetcher,
            ),
          );
          validateReadOnlyTeslaScopes(result.scope);
          rotated = {
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            expiresAt: Math.floor(Date.now() / 1000) + result.expires_in,
            tokenType: result.token_type,
            scope: result.scope,
            regionBaseUrl: tokens.regionBaseUrl,
          };
        } catch (error) {
          if (!(error instanceof TeslaOAuthError) || error.error !== 'login_required') throw error;
          rotated = null;
        }
        try {
          await budget.run(() =>
            store.stageDiscoveryRefresh(householdId, attempt.attemptId, owner, rotated),
          );
        } catch {
          // Reconcile staging through authenticated finish only. Never repeat the token POST.
          budget.check();
        }
      }
      let result: Awaited<ReturnType<SupabaseSiteLinkRepository['finishRefresh']>>;
      try {
        result = await budget.run(() =>
          repository.finishRefresh(householdId, attempt.attemptId, owner),
        );
      } catch (error) {
        if (error instanceof SupabasePostgrestError && [401, 403, 409].includes(error.status))
          throw error;
        // Exact idempotent database replay, never another external token exchange.
        result = await budget.run(() =>
          repository.finishRefresh(householdId, attempt.attemptId, owner),
        );
      }
      if (result.outcome !== 'TOKEN') throw new TeslaDiscoveryReauthorizationRequired();
      committedRevision = result.credentialRevision;
    } finally {
      await store.releaseDiscoveryRefresh(householdId, owner).catch(() => undefined);
    }
  }
  const tokens = await budget.run(() => store.getTokens(householdId));
  validate(tokens);
  if (isTokenExpiredOrExpiring(tokens.expiresAt, 30))
    throw new Error('Tesla credentials unavailable');
  const context = await budget.run(() => repository.context(householdId));
  if (context.credentialRevision !== committedRevision)
    throw new SupabasePostgrestError('refresh_revision', 409, null);
  return { tokens, credentialRevision: context.credentialRevision };
}
