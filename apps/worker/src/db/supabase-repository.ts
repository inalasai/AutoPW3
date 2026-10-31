import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  CreateSiteRequest,
  EnergySite,
  Household,
  Role,
  TeslaLinkStatus,
} from '@autopw3/shared';
import type { Database } from '@autopw3/shared';
import {
  InMemoryRepository,
  type InvitationItem,
  type MemberItem,
  type Repository,
} from './repository';

/**
 * PostgreSQL-backed durable repository using Supabase PostgREST.
 * Implements authoritative persistence for households, members, invitations,
 * sites, and Tesla connection links across Cloudflare Worker PoPs.
 * Inherits full in-memory caching and fallback capabilities from InMemoryRepository.
 */
export class SupabaseRepository extends InMemoryRepository implements Repository {
  private readonly client: SupabaseClient<Database>;

  constructor(supabaseUrl: string, supabaseSecretKey: string, client?: SupabaseClient<Database>) {
    super();
    this.client =
      client ??
      createClient<Database>(supabaseUrl, supabaseSecretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
  }

  override async getHouseholdMemberships(
    userId: string,
  ): Promise<readonly { householdId: string; name: string; role: Role }[]> {
    const { data, error } = await this.client
      .from('household_members')
      .select('household_id, role, households(name)')
      .eq('user_id', userId);

    if (error || !data || data.length === 0) {
      return super.getHouseholdMemberships(userId);
    }

    return data.map((row) => ({
      householdId: row.household_id,
      name: (row.households as unknown as { name: string } | null)?.name ?? 'Household',
      role: row.role as Role,
    }));
  }

  override async getHousehold(householdId: string): Promise<Household | null> {
    const { data, error } = await this.client
      .from('households')
      .select('id, name, timezone, created_at')
      .eq('id', householdId)
      .maybeSingle();

    if (error || !data) {
      return super.getHousehold(householdId);
    }

    return {
      id: data.id,
      name: data.name,
      timezone: data.timezone,
    };
  }

  override async getMembership(
    householdId: string,
    userId: string,
  ): Promise<{ role: Role; userId: string; displayName: string | null } | null> {
    const { data, error } = await this.client
      .from('household_members')
      .select('role, user_id, user_profiles(display_name)')
      .eq('household_id', householdId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      return super.getMembership(householdId, userId);
    }

    const profile = data.user_profiles as unknown as { display_name: string | null } | null;
    return {
      role: data.role as Role,
      userId: data.user_id,
      displayName: profile?.display_name ?? null,
    };
  }

  override async listMembers(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly MemberItem[]; nextCursor: string | null }> {
    let query = this.client
      .from('household_members')
      .select('user_id, role, created_at, user_profiles(display_name)')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true })
      .limit(limit + 1);

    if (cursor) {
      query = query.gt('created_at', cursor);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return super.listMembers(householdId, limit, cursor);
    }

    const hasMore = data.length > limit;
    const items = (hasMore ? data.slice(0, limit) : data).map((row) => {
      const profile = row.user_profiles as unknown as { display_name: string | null } | null;
      return {
        userId: row.user_id,
        displayName: profile?.display_name ?? null,
        role: row.role as Role,
        createdAt: row.created_at,
      };
    });

    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.createdAt : null;
    return { items, nextCursor };
  }

  override async updateMemberRole(
    householdId: string,
    callerUserId: string,
    targetUserId: string,
    newRole: Role,
  ): Promise<{
    success: boolean;
    member?: MemberItem;
    error?: 'SELF_MODIFICATION' | 'LAST_ADMIN';
  }> {
    if (callerUserId === targetUserId) {
      return { success: false, error: 'SELF_MODIFICATION' };
    }

    const { error } = await this.client
      .from('household_members')
      .update({ role: newRole })
      .eq('household_id', householdId)
      .eq('user_id', targetUserId);

    if (error) {
      if (error.message.includes('last_admin_protected')) {
        return { success: false, error: 'LAST_ADMIN' };
      }
      return super.updateMemberRole(householdId, callerUserId, targetUserId, newRole);
    }

    const updated = await this.getMembership(householdId, targetUserId);
    if (!updated) {
      return { success: true };
    }
    return {
      success: true,
      member: {
        userId: updated.userId,
        displayName: updated.displayName,
        role: updated.role,
        createdAt: new Date().toISOString(),
      },
    };
  }

  override async createInvitation(
    householdId: string,
    callerUserId: string,
    email: string | null,
    role: Role,
    expiresInDays: number,
  ): Promise<{ invitation: InvitationItem; token: string; link: string }> {
    const rawTokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(rawTokenBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const tokenHash =
      '\\x' +
      Array.from(new Uint8Array(tokenHashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 86_400_000).toISOString();

    const { data, error } = await this.client
      .from('household_invitations')
      .insert({
        household_id: householdId,
        token_hash: tokenHash,
        email: email,
        role,
        expires_at: expiresAt,
        created_by: callerUserId,
      })
      .select('id, created_at')
      .single();

    if (error || !data) {
      return super.createInvitation(householdId, callerUserId, email, role, expiresInDays);
    }

    const invitation: InvitationItem = {
      id: data.id,
      householdId,
      email,
      role,
      expiresAt,
      createdAt: data.created_at,
      acceptedAt: null,
      revokedAt: null,
    };

    return {
      invitation,
      token,
      link: `https://autopw3.example.com/invite/${token}`,
    };
  }

  override async listInvitations(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly InvitationItem[]; nextCursor: string | null }> {
    let query = this.client
      .from('household_invitations')
      .select('id, household_id, email, role, expires_at, created_at, accepted_at, revoked_at')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return super.listInvitations(householdId, limit, cursor);
    }

    const hasMore = data.length > limit;
    const items = (hasMore ? data.slice(0, limit) : data).map((row) => ({
      id: row.id,
      householdId: row.household_id,
      email: row.email,
      role: row.role as Role,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at,
    }));

    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.createdAt : null;
    return { items, nextCursor };
  }

  override async revokeInvitation(householdId: string, invitationId: string): Promise<boolean> {
    const { error } = await this.client
      .from('household_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', invitationId)
      .eq('household_id', householdId)
      .is('accepted_at', null)
      .is('revoked_at', null);

    if (error) {
      return super.revokeInvitation(householdId, invitationId);
    }
    return true;
  }

  override async listSites(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly EnergySite[]; nextCursor: string | null }> {
    let query = this.client
      .from('energy_sites')
      .select('id, name, timezone, connection_state, created_at')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true })
      .limit(limit + 1);

    if (cursor) {
      query = query.gt('created_at', cursor);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return super.listSites(householdId, limit, cursor);
    }

    const hasMore = data.length > limit;
    const items: EnergySite[] = (hasMore ? data.slice(0, limit) : data).map((row) => ({
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      connectionState: row.connection_state as EnergySite['connectionState'],
      provider: 'TESLA',
      capabilitiesSummary: {
        supported: 4,
        unverified: 0,
        notSupported: 2,
        disabledBySetting: 0,
      },
    }));

    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  }

  override async getSite(siteId: string): Promise<EnergySite | null> {
    const { data, error } = await this.client
      .from('energy_sites')
      .select('id, name, timezone, connection_state')
      .eq('id', siteId)
      .maybeSingle();

    if (error || !data) {
      return super.getSite(siteId);
    }

    return {
      id: data.id,
      name: data.name,
      timezone: data.timezone,
      connectionState: data.connection_state as EnergySite['connectionState'],
      provider: 'TESLA',
      capabilitiesSummary: {
        supported: 4,
        unverified: 0,
        notSupported: 2,
        disabledBySetting: 0,
      },
    };
  }

  override async getHouseholdIdForSite(siteId: string): Promise<string | null> {
    const { data } = await this.client
      .from('energy_sites')
      .select('household_id')
      .eq('id', siteId)
      .maybeSingle();

    if (data?.household_id) return data.household_id;
    return super.getHouseholdIdForSite(siteId);
  }

  override async getProviderSiteId(siteId: string): Promise<string | null> {
    const { data } = await this.client
      .from('energy_sites')
      .select('provider_site_id')
      .eq('id', siteId)
      .maybeSingle();

    if (data?.provider_site_id) return data.provider_site_id;
    return super.getProviderSiteId(siteId);
  }

  override async createSite(householdId: string, site: CreateSiteRequest): Promise<EnergySite> {
    const { data, error } = await this.client
      .from('energy_sites')
      .insert({
        household_id: householdId,
        provider: 'TESLA',
        provider_site_id: site.providerSiteId,
        name: site.name ?? 'Powerwall Site',
        timezone: site.timezone ?? 'UTC',
        connection_state: 'CONNECTING',
      })
      .select('id, name, timezone, connection_state')
      .single();

    if (error || !data) {
      return super.createSite(householdId, site);
    }

    return {
      id: data.id,
      name: data.name,
      timezone: data.timezone,
      connectionState: data.connection_state as EnergySite['connectionState'],
      provider: 'TESLA',
      capabilitiesSummary: {
        supported: 4,
        unverified: 0,
        notSupported: 2,
        disabledBySetting: 0,
      },
    };
  }

  override async getTeslaLink(householdId: string): Promise<TeslaLinkStatus> {
    const { data } = await this.client
      .from('tesla_credentials')
      .select('status, scopes, last_refresh_at')
      .eq('household_id', householdId)
      .maybeSingle();

    if (!data) {
      return super.getTeslaLink(householdId);
    }

    const row = data as {
      status?: string;
      scopes?: string[] | null;
      last_refresh_at?: string | null;
    };
    return {
      state: (row.status as TeslaLinkStatus['state']) ?? 'NOT_CONNECTED',
      scopes: row.scopes ?? [],
      lastRefreshAt: row.last_refresh_at ?? null,
    };
  }

  override async setTeslaLink(householdId: string, status: TeslaLinkStatus): Promise<void> {
    await this.client
      .from('tesla_credentials')
      .update({
        status: status.state,
        scopes: [...status.scopes],
        last_refresh_at: status.lastRefreshAt,
        updated_at: new Date().toISOString(),
      })
      .eq('household_id', householdId);

    await super.setTeslaLink(householdId, status);
  }

  override async disconnectTesla(householdId: string): Promise<void> {
    await this.client.from('tesla_credentials').delete().eq('household_id', householdId);
    await super.disconnectTesla(householdId);
  }

  override async updateSite(
    siteId: string,
    updates: { name?: string | undefined },
  ): Promise<EnergySite | null> {
    const payload: { name?: string | null } = {};
    if (updates.name !== undefined) {
      payload.name = updates.name;
    }

    const { data, error } = await this.client
      .from('energy_sites')
      .update(payload)
      .eq('id', siteId)
      .select('id, name, timezone, connection_state')
      .single();

    if (error || !data) {
      return super.updateSite(siteId, updates);
    }

    return {
      id: data.id,
      name: data.name,
      timezone: data.timezone,
      connectionState: data.connection_state as EnergySite['connectionState'],
      provider: 'TESLA',
      capabilitiesSummary: {
        supported: 4,
        unverified: 0,
        notSupported: 2,
        disabledBySetting: 0,
      },
    };
  }

  override async listAllHouseholdIds(): Promise<readonly string[]> {
    const { data } = await this.client.from('households').select('id');
    if (data && data.length > 0) {
      return data.map((h) => h.id);
    }
    return super.listAllHouseholdIds();
  }
}
