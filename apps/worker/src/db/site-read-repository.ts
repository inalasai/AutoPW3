import {
  IanaTimezoneSchema,
  PAGINATION,
  SiteConnectionStateSchema,
  TEXT_LIMITS,
  UuidSchema,
} from '@autopw3/shared';
import { z } from 'zod';
import type { VerifiedUser } from '../lib/jwt';
import { SupabasePostgrestError } from './postgrest';
import type { AuthenticatedPostgrestClient } from './postgrest';

/** Internal persisted metadata, not the public EnergySite DTO or a capability assessment. */
export interface StoredSite {
  readonly id: string;
  readonly householdId: string;
  readonly provider: 'TESLA';
  readonly providerSiteId: string;
  readonly name: string | null;
  readonly timezone: string;
  readonly connectionState: z.infer<typeof SiteConnectionStateSchema>;
}

/** Only the reads needed to reconcile discovery and authorize a subsequent site-specific read. */
export interface SiteReadRepository {
  listSites(
    householdId: string,
    limit?: number,
    cursor?: string,
  ): Promise<{
    items: readonly StoredSite[];
    nextCursor: string | null;
  }>;
  getSite(siteId: string): Promise<StoredSite | null>;
}

const SITE_COLUMNS = 'id,household_id,provider,provider_site_id,name,timezone,connection_state';
const siteRowSchema = z.strictObject({
  id: UuidSchema,
  household_id: UuidSchema,
  provider: z.literal('TESLA'),
  provider_site_id: z.string().min(1).max(TEXT_LIMITS.providerSiteId),
  name: z.string().min(1).max(TEXT_LIMITS.name).nullable(),
  timezone: IanaTimezoneSchema,
  connection_state: SiteConnectionStateSchema,
});
const membershipRowSchema = z.strictObject({ household_id: UuidSchema, user_id: UuidSchema });
const cursorSchema = z.strictObject({
  version: z.literal(1),
  householdId: UuidSchema,
  afterId: UuidSchema,
});

const invalidInput = () => new SupabasePostgrestError('site_read_input', 400, '22023');
const invalidResponse = () => new SupabasePostgrestError('site_read_response', 502, null);

function uuid(value: string): string {
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) throw invalidInput();
  return parsed.data.toLowerCase();
}

function decodeCursor(cursor: string | undefined, householdId: string): string | undefined {
  if (cursor === undefined) return undefined;
  if (cursor.length > PAGINATION.maxCursorLength || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw invalidInput();
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))),
    );
    if (!parsed.success || parsed.data.householdId.toLowerCase() !== householdId)
      throw invalidInput();
    return parsed.data.afterId.toLowerCase();
  } catch {
    throw invalidInput();
  }
}

function encodeCursor(householdId: string, afterId: string): string {
  return btoa(JSON.stringify({ version: 1, householdId, afterId }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function storedSites(value: unknown, maximum: number): StoredSite[] {
  if (!Array.isArray(value) || value.length > maximum) throw invalidResponse();
  return value.map((row: unknown) => {
    const parsed = siteRowSchema.safeParse(row);
    if (!parsed.success) throw invalidResponse();
    const r = parsed.data;
    return {
      id: r.id.toLowerCase(),
      householdId: r.household_id.toLowerCase(),
      provider: r.provider,
      providerSiteId: r.provider_site_id,
      name: r.name,
      timezone: r.timezone,
      connectionState: r.connection_state,
    };
  });
}

/** Construct per request after JWT verification, using that request's authenticated transport. */
export class SupabaseSiteReadRepository implements SiteReadRepository {
  private readonly actorUserId: string;

  constructor(
    private readonly db: AuthenticatedPostgrestClient,
    user: VerifiedUser,
  ) {
    this.actorUserId = uuid(user.userId);
  }

  private async isMember(householdId: string): Promise<boolean> {
    const rows = await this.db.select<unknown>(
      'household_members',
      new URLSearchParams({
        select: 'household_id,user_id',
        household_id: `eq.${householdId}`,
        user_id: `eq.${this.actorUserId}`,
        limit: '1',
      }),
    );
    if (!Array.isArray(rows) || rows.length > 1) throw invalidResponse();
    if (rows.length === 0) return false;
    const parsed = membershipRowSchema.safeParse(rows[0]);
    if (
      !parsed.success ||
      parsed.data.household_id.toLowerCase() !== householdId ||
      parsed.data.user_id.toLowerCase() !== this.actorUserId
    )
      throw invalidResponse();
    return true;
  }

  async listSites(householdId: string, limit: number = PAGINATION.defaultLimit, cursor?: string) {
    const household = uuid(householdId);
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGINATION.maxLimit) throw invalidInput();
    const afterId = decodeCursor(cursor, household);
    if (!(await this.isMember(household))) {
      // An unrelated household and a nonexistent household have the same outcome.
      throw new SupabasePostgrestError('site_read_scope', 404, null);
    }
    const params = new URLSearchParams({
      select: SITE_COLUMNS,
      household_id: `eq.${household}`,
      provider: 'eq.TESLA',
      order: 'id.asc',
      limit: String(limit + 1),
    });
    if (afterId) params.set('id', `gt.${afterId}`);
    // RLS remains authoritative on this query, including membership changes after the precheck.
    const sites = storedSites(await this.db.select<unknown>('energy_sites', params), limit + 1);
    let previousId = afterId;
    for (const site of sites) {
      if (site.householdId !== household || (previousId && site.id <= previousId))
        throw invalidResponse();
      previousId = site.id;
    }
    const hasMore = sites.length > limit;
    const items = sites.slice(0, limit);
    return {
      items,
      nextCursor: hasMore ? encodeCursor(household, items[items.length - 1]!.id) : null,
    };
  }

  async getSite(siteId: string): Promise<StoredSite | null> {
    const id = uuid(siteId);
    const sites = storedSites(
      await this.db.select<unknown>(
        'energy_sites',
        new URLSearchParams({
          select: SITE_COLUMNS,
          id: `eq.${id}`,
          provider: 'eq.TESLA',
          limit: '1',
        }),
      ),
      1,
    );
    const site = sites[0];
    if (!site) return null; // RLS hides foreign sites in exactly the same way as missing sites.
    if (site.id !== id) throw invalidResponse();
    return (await this.isMember(site.householdId)) ? site : null;
  }
}
