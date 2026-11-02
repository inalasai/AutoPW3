import type { DiscoveredSitesResponse, TeslaSiteLinkResponse } from '@autopw3/shared';

/** Metadata only. The Supabase adapter keeps the session and bearer credential private. */
export interface TeslaSiteActor {
  userId: string;
  householdId: string;
}

export interface TeslaSiteClient {
  connect?(actor: TeslaSiteActor, signal?: AbortSignal): Promise<{ authorizeUrl: string }>;
  discover(actor: TeslaSiteActor, signal?: AbortSignal): Promise<DiscoveredSitesResponse>;
  link(
    actor: TeslaSiteActor,
    providerSiteId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<TeslaSiteLinkResponse>;
}

/** Bound by AuthProvider to the current account and household, never a caller-selected tenant. */
export interface TeslaSiteActions {
  connect?(signal?: AbortSignal): Promise<{ authorizeUrl: string }>;
  discover(signal?: AbortSignal): Promise<DiscoveredSitesResponse>;
  link(
    providerSiteId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<TeslaSiteLinkResponse>;
}

export type TeslaSiteFailureKind =
  | 'expired_session'
  | 'forbidden'
  | 'conflict'
  | 'reauthorization_required'
  | 'recovery_required'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'invalid_request'
  | 'cancelled';

/** Fixed categories only; no API/provider response, exception message, or credentials. */
export class TeslaSiteFailure extends Error {
  constructor(readonly kind: TeslaSiteFailureKind) {
    super(kind);
    this.name = 'TeslaSiteFailure';
  }
}
