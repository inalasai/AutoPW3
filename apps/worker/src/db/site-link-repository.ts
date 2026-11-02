import { TeslaSiteLinkResponseSchema, UuidSchema } from '@autopw3/shared';
import { z } from 'zod';
import { SupabasePostgrestError } from './postgrest';
import type { AuthenticatedPostgrestClient } from './postgrest';

const contextSchema = z.object({ credentialRevision: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const refreshContextSchema = contextSchema.extend({ needsRefresh: z.boolean() }).strict();
const refreshAttemptSchema = z
  .object({ attemptId: UuidSchema, state: z.enum(['SENT', 'READY']) })
  .strict();
const refreshResultSchema = contextSchema.extend({ outcome: z.enum(['TOKEN', 'REAUTH']) }).strict();

/** A separate domain slice: actual user JWT, auth.uid(), live session and database ADMIN checks. */
export class SupabaseSiteLinkRepository {
  constructor(private readonly db: AuthenticatedPostgrestClient) {}

  async discoveryContext(householdId: string) {
    return refreshContextSchema.parse(
      await this.db.rpc<unknown>('tesla_discovery_refresh_context', {
        p_household_id: householdId,
      }),
    );
  }

  async beginRefresh(householdId: string, revision: string, owner: string, deadline: number) {
    return refreshAttemptSchema.parse(
      await this.db.rpc<unknown>('begin_tesla_discovery_refresh', {
        p_household_id: householdId,
        p_revision: revision,
        p_owner: owner,
        p_deadline: new Date(deadline).toISOString(),
      }),
    );
  }

  async finishRefresh(householdId: string, attemptId: string, owner: string) {
    return refreshResultSchema.parse(
      await this.db.rpc<unknown>('finish_tesla_discovery_refresh', {
        p_household_id: householdId,
        p_attempt_id: attemptId,
        p_owner: owner,
      }),
    );
  }

  async context(householdId: string) {
    UuidSchema.parse(householdId);
    return contextSchema.parse(
      await this.db.rpc<unknown>('tesla_site_link_context', { p_household_id: householdId }),
    );
  }

  async link(householdId: string, providerSiteId: string, proofId: string, key: string) {
    UuidSchema.parse(householdId);
    UuidSchema.parse(proofId);
    const result = TeslaSiteLinkResponseSchema.parse(
      await this.db.rpc<unknown>('link_discovered_tesla_site', {
        p_household_id: householdId,
        p_proof_id: proofId,
        p_idempotency_key: key,
      }),
    );
    if (result.site.householdId !== householdId || result.site.providerSiteId !== providerSiteId)
      throw new SupabasePostgrestError('site_link_scope', 502, null);
    return result;
  }
}
