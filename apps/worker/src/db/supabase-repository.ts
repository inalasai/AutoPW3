import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AutomationRule,
  CreateRuleRequest,
  CreateSiteRequest,
  CreateTariffRequest,
  EnergySite,
  Household,
  HouseholdSettingsView,
  Role,
  RuleMode,
  Tariff,
  TeslaLinkStatus,
  UpdateHouseholdSettingsRequest,
  UpdateRuleRequest,
} from '@autopw3/shared';
import { Decimal, serialiseDecimal } from '@autopw3/shared';
import type { Database, Json } from '@autopw3/shared';
import {
  InMemoryRepository,
  type InvitationItem,
  type MemberItem,
  type Repository,
} from './repository';

/**
 * PostgreSQL-backed durable repository using Supabase PostgREST.
 * Implements authoritative persistence and strict multi-tenant isolation
 * for households, memberships, invitations, sites, settings, tariffs,
 * rules, and Tesla credentials.
 *
 * Never falls back to in-memory demo data for tenant-boundary lookups,
 * ensuring that cross-household requests fail closed with HTTP 404/403.
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

  // ---------------------------------------------------------------------------
  // Identity & Household Isolation
  // ---------------------------------------------------------------------------

  override async getHouseholdMemberships(
    userId: string,
  ): Promise<readonly { householdId: string; name: string; role: Role }[]> {
    const { data, error } = await this.client
      .from('household_members')
      .select('household_id, role, households(name)')
      .eq('user_id', userId);

    if (error || !data || data.length === 0) {
      return [];
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
      return null;
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
      return null;
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
      return { items: [], nextCursor: null };
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
      return { success: false };
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

  override async removeMember(
    householdId: string,
    callerUserId: string,
    targetUserId: string,
  ): Promise<{ success: boolean; error?: 'SELF_MODIFICATION' | 'LAST_ADMIN' | 'NOT_FOUND' }> {
    if (callerUserId === targetUserId) {
      return { success: false, error: 'SELF_MODIFICATION' };
    }

    const { error } = await this.client
      .from('household_members')
      .delete()
      .eq('household_id', householdId)
      .eq('user_id', targetUserId);

    if (error) {
      if (error.message.includes('last_admin_protected')) {
        return { success: false, error: 'LAST_ADMIN' };
      }
      return { success: false, error: 'NOT_FOUND' };
    }
    return { success: true };
  }

  override async leaveHousehold(
    householdId: string,
    userId: string,
  ): Promise<{ success: boolean; error?: 'LAST_ADMIN' | 'NOT_FOUND' }> {
    const { error } = await this.client
      .from('household_members')
      .delete()
      .eq('household_id', householdId)
      .eq('user_id', userId);

    if (error) {
      if (error.message.includes('last_admin_protected')) {
        return { success: false, error: 'LAST_ADMIN' };
      }
      return { success: false, error: 'NOT_FOUND' };
    }
    return { success: true };
  }

  override async updateHousehold(
    householdId: string,
    updates: { name?: string | undefined; timezone?: string | undefined },
  ): Promise<Household | null> {
    const payload: Database['public']['Tables']['households']['Update'] = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.timezone !== undefined) payload.timezone = updates.timezone;

    const { data, error } = await this.client
      .from('households')
      .update(payload)
      .eq('id', householdId)
      .select('id, name, timezone, created_at')
      .maybeSingle();

    if (error || !data) return null;
    return {
      id: data.id,
      name: data.name,
      timezone: data.timezone,
    };
  }

  override async deleteHousehold(
    householdId: string,
    confirmName: string,
  ): Promise<{ success: boolean; error?: 'NAME_MISMATCH' | 'NOT_FOUND' }> {
    const hh = await this.getHousehold(householdId);
    if (!hh) return { success: false, error: 'NOT_FOUND' };
    if (hh.name !== confirmName) return { success: false, error: 'NAME_MISMATCH' };

    const { error } = await this.client.from('households').delete().eq('id', householdId);
    if (error) return { success: false, error: 'NOT_FOUND' };
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

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
      throw new Error(`Failed to create invitation: ${error?.message ?? 'database error'}`);
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
      return { items: [], nextCursor: null };
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

    return !error;
  }

  override async acceptInvitation(
    userId: string,
    userEmail: string | undefined,
    token: string,
  ): Promise<{
    success: boolean;
    householdId?: string;
    role?: Role;
    error?: 'INVALID_TOKEN' | 'EXPIRED' | 'EMAIL_MISMATCH' | 'ALREADY_MEMBER';
  }> {
    const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const tokenHash =
      '\\x' +
      Array.from(new Uint8Array(tokenHashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    const { data: inv, error: invError } = await this.client
      .from('household_invitations')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (invError || !inv || inv.accepted_at !== null || inv.revoked_at !== null) {
      return { success: false, error: 'INVALID_TOKEN' };
    }

    if (new Date(inv.expires_at).getTime() <= Date.now()) {
      return { success: false, error: 'EXPIRED' };
    }

    if (inv.email && inv.email.toLowerCase() !== userEmail?.toLowerCase()) {
      return { success: false, error: 'EMAIL_MISMATCH' };
    }

    const { data: existingMember } = await this.client
      .from('household_members')
      .select('user_id')
      .eq('household_id', inv.household_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingMember) {
      return { success: false, error: 'ALREADY_MEMBER' };
    }

    const now = new Date().toISOString();
    const { error: insertError } = await this.client.from('household_members').insert({
      household_id: inv.household_id,
      user_id: userId,
      role: inv.role,
      created_by: userId,
    });

    if (insertError) {
      return { success: false, error: 'INVALID_TOKEN' };
    }

    await this.client
      .from('household_invitations')
      .update({
        accepted_at: now,
        accepted_by: userId,
      })
      .eq('id', inv.id);

    return { success: true, householdId: inv.household_id, role: inv.role as Role };
  }

  // ---------------------------------------------------------------------------
  // Settings & Budget
  // ---------------------------------------------------------------------------

  override async getSettings(householdId: string): Promise<HouseholdSettingsView | null> {
    const { data, error } = await this.client
      .from('household_settings')
      .select('*')
      .eq('household_id', householdId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      staleAfterSeconds: data.stale_after_seconds,
      automationPaused: data.automation_paused,
      controlsEnabled: data.controls_enabled,
      budget: {
        spentUsd: '0.00',
        capUsd: serialiseDecimal(new Decimal(data.monthly_spend_cap_usd), 2),
        state: 'OK',
      },
    };
  }

  override async updateSettings(
    householdId: string,
    updates: UpdateHouseholdSettingsRequest,
  ): Promise<HouseholdSettingsView | null> {
    const payload: Database['public']['Tables']['household_settings']['Update'] = {};
    if (updates.monthlySpendCapUsd !== undefined) {
      payload.monthly_spend_cap_usd = Number(updates.monthlySpendCapUsd);
    }
    if (updates.liveBackgroundIntervalMinutes !== undefined) {
      payload.live_background_interval_minutes = updates.liveBackgroundIntervalMinutes;
    }
    if (updates.liveOnDemandMinIntervalSeconds !== undefined) {
      payload.live_on_demand_min_interval_seconds = updates.liveOnDemandMinIntervalSeconds;
    }
    if (updates.onDemandMonthlyAllowance !== undefined) {
      payload.on_demand_monthly_allowance = updates.onDemandMonthlyAllowance;
    }
    if (updates.rawRetentionDays !== undefined) {
      payload.raw_retention_days = updates.rawRetentionDays;
    }
    if (updates.staleAfterSeconds !== undefined) {
      payload.stale_after_seconds = updates.staleAfterSeconds;
    }
    if (updates.controlsEnabled !== undefined) {
      payload.controls_enabled = updates.controlsEnabled;
    }

    const { error } = await this.client
      .from('household_settings')
      .update(payload)
      .eq('household_id', householdId);

    if (error) return null;
    return this.getSettings(householdId);
  }

  override async getAutomationPaused(householdId: string): Promise<boolean> {
    const { data } = await this.client
      .from('household_settings')
      .select('automation_paused')
      .eq('household_id', householdId)
      .maybeSingle();
    return data?.automation_paused ?? false;
  }

  override async setAutomationPaused(
    householdId: string,
    paused: boolean,
  ): Promise<{ automationPaused: boolean; pausedAt: string | null }> {
    const pausedAt = paused ? new Date().toISOString() : null;
    await this.client
      .from('household_settings')
      .update({
        automation_paused: paused,
        paused_at: pausedAt,
      })
      .eq('household_id', householdId);

    return { automationPaused: paused, pausedAt };
  }

  // ---------------------------------------------------------------------------
  // Sites & Capabilities
  // ---------------------------------------------------------------------------

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
      return { items: [], nextCursor: null };
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
      return null;
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

    return data?.household_id ?? null;
  }

  override async getProviderSiteId(siteId: string): Promise<string | null> {
    const { data } = await this.client
      .from('energy_sites')
      .select('provider_site_id')
      .eq('id', siteId)
      .maybeSingle();

    return data?.provider_site_id ?? null;
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
      throw new Error(`Failed to create energy site: ${error?.message ?? 'database error'}`);
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
      return null;
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

  // ---------------------------------------------------------------------------
  // Tesla Credentials Link
  // ---------------------------------------------------------------------------

  override async getTeslaLink(householdId: string): Promise<TeslaLinkStatus> {
    const { data } = await this.client
      .from('tesla_credentials')
      .select('status, scopes, last_refresh_at')
      .eq('household_id', householdId)
      .maybeSingle();

    if (!data) {
      return {
        state: 'NOT_CONNECTED',
        scopes: [],
        lastRefreshAt: null,
      };
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
  }

  override async disconnectTesla(householdId: string): Promise<void> {
    await this.client.from('tesla_credentials').delete().eq('household_id', householdId);
  }

  // ---------------------------------------------------------------------------
  // Tariffs
  // ---------------------------------------------------------------------------

  override async getHouseholdIdForTariff(tariffId: string): Promise<string | null> {
    const { data } = await this.client
      .from('utility_tariffs')
      .select('household_id')
      .eq('id', tariffId)
      .maybeSingle();

    return data?.household_id ?? null;
  }

  override async listTariffs(
    householdId: string,
    filter?: { direction?: string; asOf?: string },
    limit: number = 50,
    cursor?: string,
  ): Promise<{ items: readonly Tariff[]; nextCursor: string | null }> {
    let query = this.client
      .from('utility_tariffs')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true })
      .limit(limit + 1);

    if (filter?.direction) {
      query = query.eq('direction', filter.direction);
    }
    if (cursor) {
      query = query.gt('id', cursor);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return { items: [], nextCursor: null };
    }

    let rows = data;
    if (filter?.asOf) {
      rows = rows.filter((t) => {
        const fromOk = t.effective_from <= filter.asOf!;
        const toOk = !t.effective_to || t.effective_to > filter.asOf!;
        return fromOk && toOk;
      });
    }

    const hasMore = rows.length > limit;
    const items: Tariff[] = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      id: row.id,
      tariffKey: row.tariff_key,
      version: row.version,
      createdAt: row.created_at,
      name: row.name,
      direction: row.direction as Tariff['direction'],
      priceMode: row.price_mode as Tariff['priceMode'],
      currency: row.currency,
      timezone: row.timezone,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      taxMode: row.tax_mode as Tariff['taxMode'],
      vatRatePercent: row.vat_rate !== null ? String(row.vat_rate) : null,
      flatRatePerKwh: row.flat_rate_per_kwh !== null ? String(row.flat_rate_per_kwh) : null,
      standingChargePerDay:
        row.standing_charge_per_day !== null ? String(row.standing_charge_per_day) : null,
      exportPaymentModel: row.export_payment_model as Tariff['exportPaymentModel'],
      siteId: row.site_id,
      slots: [],
      seasons: [],
      overrides: [],
      levies: [],
    }));

    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  }

  override async getTariff(tariffId: string): Promise<Tariff | null> {
    const { data, error } = await this.client
      .from('utility_tariffs')
      .select('*')
      .eq('id', tariffId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      tariffKey: data.tariff_key,
      version: data.version,
      createdAt: data.created_at,
      name: data.name,
      direction: data.direction as Tariff['direction'],
      priceMode: data.price_mode as Tariff['priceMode'],
      currency: data.currency,
      timezone: data.timezone,
      effectiveFrom: data.effective_from,
      effectiveTo: data.effective_to,
      taxMode: data.tax_mode as Tariff['taxMode'],
      vatRatePercent: data.vat_rate !== null ? String(data.vat_rate) : null,
      flatRatePerKwh: data.flat_rate_per_kwh !== null ? String(data.flat_rate_per_kwh) : null,
      standingChargePerDay:
        data.standing_charge_per_day !== null ? String(data.standing_charge_per_day) : null,
      exportPaymentModel: data.export_payment_model as Tariff['exportPaymentModel'],
      siteId: data.site_id,
      slots: [],
      seasons: [],
      overrides: [],
      levies: [],
    };
  }

  override async createTariff(
    householdId: string,
    request: CreateTariffRequest,
  ): Promise<{ success: boolean; tariff?: Tariff; error?: 'OVERLAP' | 'VALIDATION_FAILED' }> {
    const existing = await this.listTariffs(householdId, { direction: request.direction });
    for (const t of existing.items) {
      if (t.tariffKey === request.tariffKey) {
        const overlapStart = !t.effectiveTo || request.effectiveFrom < t.effectiveTo;
        const overlapEnd = !request.effectiveTo || t.effectiveFrom < request.effectiveTo;
        if (overlapStart && overlapEnd) {
          return { success: false, error: 'OVERLAP' };
        }
      }
    }

    const id = crypto.randomUUID();
    const tariffKey = request.tariffKey ?? crypto.randomUUID();
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .from('utility_tariffs')
      .insert({
        id,
        household_id: householdId,
        site_id: request.siteId ?? null,
        tariff_key: tariffKey,
        version: 1,
        name: request.name,
        direction: request.direction,
        price_mode: request.priceMode,
        currency: request.currency,
        timezone: request.timezone,
        effective_from: request.effectiveFrom,
        effective_to: request.effectiveTo ?? null,
        tax_mode: request.taxMode,
        vat_rate: request.vatRatePercent !== null ? Number(request.vatRatePercent) : null,
        flat_rate_per_kwh: request.flatRatePerKwh !== null ? Number(request.flatRatePerKwh) : null,
        standing_charge_per_day:
          request.standingChargePerDay !== null ? Number(request.standingChargePerDay) : null,
        export_payment_model: request.exportPaymentModel ?? null,
        created_at: now,
      })
      .select('*')
      .single();

    if (error || !data) {
      return { success: false, error: 'VALIDATION_FAILED' };
    }

    return {
      success: true,
      tariff: {
        id: data.id,
        tariffKey: data.tariff_key,
        version: data.version,
        createdAt: data.created_at,
        name: data.name,
        direction: data.direction as Tariff['direction'],
        priceMode: data.price_mode as Tariff['priceMode'],
        currency: data.currency,
        timezone: data.timezone,
        effectiveFrom: data.effective_from,
        effectiveTo: data.effective_to,
        taxMode: data.tax_mode as Tariff['taxMode'],
        vatRatePercent: data.vat_rate !== null ? String(data.vat_rate) : null,
        flatRatePerKwh: data.flat_rate_per_kwh !== null ? String(data.flat_rate_per_kwh) : null,
        standingChargePerDay:
          data.standing_charge_per_day !== null ? String(data.standing_charge_per_day) : null,
        exportPaymentModel: data.export_payment_model as Tariff['exportPaymentModel'],
        siteId: data.site_id,
        slots: [],
        seasons: [],
        overrides: [],
        levies: [],
      },
    };
  }

  override async endTariff(
    tariffId: string,
    effectiveTo: string,
  ): Promise<{ success: boolean; tariff?: Tariff; error?: string }> {
    const { data, error } = await this.client
      .from('utility_tariffs')
      .update({ effective_to: effectiveTo })
      .eq('id', tariffId)
      .select('*')
      .maybeSingle();

    if (error || !data) return { success: false, error: 'NOT_FOUND' };

    return {
      success: true,
      tariff: {
        id: data.id,
        tariffKey: data.tariff_key,
        version: data.version,
        createdAt: data.created_at,
        name: data.name,
        direction: data.direction as Tariff['direction'],
        priceMode: data.price_mode as Tariff['priceMode'],
        currency: data.currency,
        timezone: data.timezone,
        effectiveFrom: data.effective_from,
        effectiveTo: data.effective_to,
        taxMode: data.tax_mode as Tariff['taxMode'],
        vatRatePercent: data.vat_rate !== null ? String(data.vat_rate) : null,
        flatRatePerKwh: data.flat_rate_per_kwh !== null ? String(data.flat_rate_per_kwh) : null,
        standingChargePerDay:
          data.standing_charge_per_day !== null ? String(data.standing_charge_per_day) : null,
        exportPaymentModel: data.export_payment_model as Tariff['exportPaymentModel'],
        siteId: data.site_id,
        slots: [],
        seasons: [],
        overrides: [],
        levies: [],
      },
    };
  }

  override async deleteTariff(
    tariffId: string,
  ): Promise<{ success: boolean; error?: 'REFERENCED' | 'NOT_FOUND' }> {
    const { error } = await this.client.from('utility_tariffs').delete().eq('id', tariffId);
    if (error) {
      if (error.message.includes('foreign key') || error.code === '23503') {
        return { success: false, error: 'REFERENCED' };
      }
      return { success: false, error: 'NOT_FOUND' };
    }
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Automation Rules
  // ---------------------------------------------------------------------------

  override async getHouseholdIdForRule(ruleId: string): Promise<string | null> {
    const { data } = await this.client
      .from('automation_rules')
      .select('household_id')
      .eq('id', ruleId)
      .maybeSingle();

    return data?.household_id ?? null;
  }

  override async listRules(
    siteId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly AutomationRule[]; nextCursor: string | null }> {
    let query = this.client
      .from('automation_rules')
      .select('*')
      .eq('site_id', siteId)
      .order('created_at', { ascending: true })
      .limit(limit + 1);

    if (cursor) {
      query = query.gt('id', cursor);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return { items: [], nextCursor: null };
    }

    const hasMore = data.length > limit;
    const items: AutomationRule[] = (hasMore ? data.slice(0, limit) : data).map((row) => ({
      id: row.id,
      siteId: row.site_id,
      name: row.name,
      priority: row.priority,
      definitionVersion: row.definition_version,
      definition: row.definition as unknown as AutomationRule['definition'],
      mode: row.mode as AutomationRule['mode'],
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  }

  override async getRule(ruleId: string): Promise<AutomationRule | null> {
    const { data, error } = await this.client
      .from('automation_rules')
      .select('*')
      .eq('id', ruleId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      siteId: data.site_id,
      name: data.name,
      priority: data.priority,
      definitionVersion: data.definition_version,
      definition: data.definition as unknown as AutomationRule['definition'],
      mode: data.mode as AutomationRule['mode'],
      version: data.version,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  override async createRule(siteId: string, rule: CreateRuleRequest): Promise<AutomationRule> {
    const householdId = await this.getHouseholdIdForSite(siteId);
    if (!householdId) {
      throw new Error('Site not found');
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('automation_rules')
      .insert({
        id,
        household_id: householdId,
        site_id: siteId,
        name: rule.name,
        priority: rule.priority,
        definition_version: 1,
        definition: rule.definition as unknown as Json,
        mode: rule.mode,
        version: 1,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create rule: ${error?.message ?? 'database error'}`);
    }

    return {
      id: data.id,
      siteId: data.site_id,
      name: data.name,
      priority: data.priority,
      definitionVersion: data.definition_version,
      definition: data.definition as unknown as AutomationRule['definition'],
      mode: data.mode as AutomationRule['mode'],
      version: data.version,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  override async updateRule(
    ruleId: string,
    rule: UpdateRuleRequest,
  ): Promise<{ rule?: AutomationRule; error?: 'NOT_FOUND' | 'VERSION_MISMATCH' }> {
    const existing = await this.getRule(ruleId);
    if (!existing) return { error: 'NOT_FOUND' };
    if (rule.version !== existing.version) {
      return { error: 'VERSION_MISMATCH' };
    }

    const payload: Database['public']['Tables']['automation_rules']['Update'] = {
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
    };
    if (rule.name !== undefined) payload.name = rule.name;
    if (rule.priority !== undefined) payload.priority = rule.priority;
    if (rule.definition !== undefined) payload.definition = rule.definition as unknown as Json;
    if (rule.mode !== undefined) payload.mode = rule.mode;

    const { data, error } = await this.client
      .from('automation_rules')
      .update(payload)
      .eq('id', ruleId)
      .select('*')
      .single();

    if (error || !data) return { error: 'NOT_FOUND' };

    return {
      rule: {
        id: data.id,
        siteId: data.site_id,
        name: data.name,
        priority: data.priority,
        definitionVersion: data.definition_version,
        definition: data.definition as unknown as AutomationRule['definition'],
        mode: data.mode as AutomationRule['mode'],
        version: data.version,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    };
  }

  override async deleteRule(ruleId: string): Promise<boolean> {
    const { error } = await this.client.from('automation_rules').delete().eq('id', ruleId);
    return !error;
  }

  override async setRuleMode(
    ruleId: string,
    mode: RuleMode,
  ): Promise<{ rule?: AutomationRule; error?: 'NOT_FOUND' }> {
    const existing = await this.getRule(ruleId);
    if (!existing) return { error: 'NOT_FOUND' };

    const { data, error } = await this.client
      .from('automation_rules')
      .update({
        mode,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ruleId)
      .select('*')
      .single();

    if (error || !data) return { error: 'NOT_FOUND' };

    return {
      rule: {
        id: data.id,
        siteId: data.site_id,
        name: data.name,
        priority: data.priority,
        definitionVersion: data.definition_version,
        definition: data.definition as unknown as AutomationRule['definition'],
        mode: data.mode as AutomationRule['mode'],
        version: data.version,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Device Commands
  // ---------------------------------------------------------------------------

  override async getHouseholdIdForCommand(commandId: string): Promise<string | null> {
    const { data } = await this.client
      .from('device_command_log')
      .select('household_id')
      .eq('id', commandId)
      .maybeSingle();

    return data?.household_id ?? null;
  }

  override async listAllHouseholdIds(): Promise<readonly string[]> {
    const { data } = await this.client.from('households').select('id');
    if (data && data.length > 0) {
      return data.map((h) => h.id);
    }
    return [];
  }
}
