import type {
  Household,
  HouseholdSettingsView,
  Role,
  UpdateHouseholdSettingsRequest,
} from '@autopw3/shared';
import type { InvitationItem, MemberItem } from './repository';
import { SupabasePostgrestError } from './postgrest';
import type { AuthenticatedPostgrestClient } from './postgrest';

/** The first durable repository slice. Methods are intentionally request-actor scoped. */
export interface IdentityRepository {
  getProfile(
    userId: string,
  ): Promise<{ userId: string; displayName: string | null; locale: string | null } | null>;
  updateProfile(
    userId: string,
    updates: { displayName?: string | null; locale?: string | null },
  ): Promise<{ userId: string; displayName: string | null; locale: string | null } | null>;
  getHouseholdMemberships(
    userId: string,
  ): Promise<readonly { householdId: string; name: string; role: Role }[]>;
  getHousehold(householdId: string): Promise<Household | null>;
  updateHousehold(
    householdId: string,
    updates: { name?: string | undefined; timezone?: string | undefined },
  ): Promise<Household | null>;
  getMembership(
    householdId: string,
    userId: string,
  ): Promise<{ role: Role; userId: string; displayName: string | null } | null>;
  listMembers(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly MemberItem[]; nextCursor: string | null }>;
  updateMemberRole(
    householdId: string,
    callerUserId: string,
    targetUserId: string,
    newRole: Role,
  ): Promise<{ success: boolean; member?: MemberItem; error?: 'SELF_MODIFICATION' | 'LAST_ADMIN' }>;
  createInvitation(
    householdId: string,
    callerUserId: string,
    email: string | null,
    role: Role,
    expiresInDays: number,
  ): Promise<{ invitation: InvitationItem; token: string }>;
  listInvitations(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly InvitationItem[]; nextCursor: string | null }>;
  revokeInvitation(householdId: string, invitationId: string): Promise<boolean>;
  acceptInvitation(
    userId: string,
    userEmail: string | undefined,
    token: string,
  ): Promise<{
    success: boolean;
    householdId?: string;
    role?: Role;
    error?: 'INVALID_TOKEN' | 'EXPIRED' | 'EMAIL_MISMATCH' | 'ALREADY_MEMBER';
  }>;
  getSettings(householdId: string): Promise<HouseholdSettingsView | null>;
  updateSettings(
    householdId: string,
    updates: UpdateHouseholdSettingsRequest,
  ): Promise<HouseholdSettingsView | null>;
  removeMember(
    householdId: string,
    callerUserId: string,
    targetUserId: string,
  ): Promise<{ success: boolean; error?: 'SELF_MODIFICATION' | 'LAST_ADMIN' | 'NOT_FOUND' }>;
  leaveHousehold(
    householdId: string,
    userId: string,
  ): Promise<{ success: boolean; error?: 'LAST_ADMIN' | 'NOT_FOUND' }>;
}

type DbRow = Record<string, unknown>;

const role = (value: unknown): Role => {
  if (value === 'ADMIN' || value === 'READ_WRITE' || value === 'READ_ONLY') return value;
  throw new Error('Database returned an invalid role');
};

const bounded = (limit: number) => Math.min(200, Math.max(1, Math.floor(limit)));

const row = (value: unknown): DbRow | null =>
  Array.isArray(value)
    ? ((value[0] as DbRow | undefined) ?? null)
    : value && typeof value === 'object'
      ? (value as DbRow)
      : null;

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export class SupabaseIdentityRepository implements IdentityRepository {
  constructor(
    private readonly db: AuthenticatedPostgrestClient,
    private readonly actorUserId: string,
  ) {}

  private assertActor(userId: string): void {
    if (userId !== this.actorUserId) throw new SupabasePostgrestError('actor_scope', 403, '42501');
  }

  async getProfile(userId: string) {
    this.assertActor(userId);
    return this.profileById(this.actorUserId);
  }

  private async profileById(userId: string) {
    const p = new URLSearchParams({
      select: 'user_id,display_name,locale',
      user_id: `eq.${userId}`,
      limit: '1',
    });
    const result = row(await this.db.select<DbRow[]>(`user_profiles`, p));
    return result
      ? {
          userId: String(result.user_id),
          displayName: (result.display_name as string | null) ?? null,
          locale: (result.locale as string | null) ?? null,
        }
      : null;
  }

  async updateProfile(
    userId: string,
    updates: { displayName?: string | null; locale?: string | null },
  ) {
    this.assertActor(userId);
    const body: DbRow = {};
    if ('displayName' in updates) body['display_name'] = updates.displayName;
    if ('locale' in updates) body['locale'] = updates.locale;
    if (!Object.keys(body).length) throw new Error('Profile update must include a field');
    const p = new URLSearchParams({
      user_id: `eq.${this.actorUserId}`,
      select: 'user_id,display_name,locale',
    });
    const result = row(await this.db.patch<DbRow[]>(`user_profiles`, p, body));
    return result
      ? {
          userId: String(result.user_id),
          displayName: (result.display_name as string | null) ?? null,
          locale: (result.locale as string | null) ?? null,
        }
      : null;
  }

  async getHouseholdMemberships(userId: string) {
    this.assertActor(userId);
    const memberships: { householdId: string; name: string; role: Role }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const p = new URLSearchParams({
        select: 'household_id,role,households!inner(name)',
        user_id: `eq.${this.actorUserId}`,
        order: 'household_id.asc',
        limit: '201',
      });
      if (cursor) p.set('household_id', `gt.${cursor}`);
      const rows = await this.db.select<DbRow[]>('household_members', p);
      const batch = rows.slice(0, 200);
      memberships.push(
        ...batch.map((r) => ({
          householdId: String(r.household_id),
          name: String(row(r.households)?.name ?? ''),
          role: role(r.role),
        })),
      );
      if (rows.length <= 200) return memberships;
      cursor = String(batch[batch.length - 1]!.household_id);
    }
    throw new Error('Household membership listing exceeded the bounded page limit');
  }

  async getHousehold(householdId: string): Promise<Household | null> {
    const p = new URLSearchParams({
      select: 'id,name,timezone',
      id: `eq.${householdId}`,
      limit: '1',
    });
    const r = row(await this.db.select<DbRow[]>('households', p));
    return r ? { id: String(r.id), name: String(r.name), timezone: String(r.timezone) } : null;
  }

  async updateHousehold(
    householdId: string,
    updates: { name?: string | undefined; timezone?: string | undefined },
  ): Promise<Household | null> {
    if (updates.name === undefined && updates.timezone === undefined) {
      throw new Error('Household update must include a supported field');
    }
    const result = row(
      await this.db.rpc<DbRow[]>('update_household', {
        p_household_id: householdId,
        p_name: updates.name ?? null,
        p_timezone: updates.timezone ?? null,
      }),
    );
    return result
      ? { id: String(result.id), name: String(result.name), timezone: String(result.timezone) }
      : null;
  }

  async getMembership(householdId: string, userId: string) {
    const p = new URLSearchParams({
      select: 'user_id,role,created_at',
      household_id: `eq.${householdId}`,
      user_id: `eq.${userId}`,
      limit: '1',
    });
    const r = row(await this.db.select<DbRow[]>('household_members', p));
    if (!r) return null;
    const profile = await this.profileById(userId);
    return {
      role: role(r.role),
      userId: String(r.user_id),
      displayName: profile?.displayName ?? null,
      createdAt: String(r.created_at),
    };
  }

  async listMembers(householdId: string, limit: number, cursor?: string) {
    const n = bounded(limit);
    if (cursor && !isUuid(cursor)) throw new Error('Member cursor is invalid');
    const p = new URLSearchParams({
      select: 'user_id,role,created_at',
      household_id: `eq.${householdId}`,
      order: 'user_id.asc',
      limit: String(n + 1),
    });
    if (cursor) p.set('user_id', `gt.${cursor}`);
    const rows = await this.db.select<DbRow[]>('household_members', p);
    const members = rows.slice(0, n);
    const userIds = members.map((r) => String(r.user_id));
    const profiles = new Map<string, string | null>();
    if (userIds.length > 0) {
      const profileParams = new URLSearchParams({
        select: 'user_id,display_name',
        user_id: `in.(${userIds.join(',')})`,
        limit: String(n),
      });
      for (const profile of await this.db.select<DbRow[]>('user_profiles', profileParams)) {
        profiles.set(String(profile.user_id), (profile.display_name as string | null) ?? null);
      }
    }
    const page = members.map((r) => ({
      userId: String(r.user_id),
      role: role(r.role),
      createdAt: String(r.created_at),
      displayName: profiles.get(String(r.user_id)) ?? null,
    }));
    return {
      items: page,
      nextCursor: rows.length > n ? (page[page.length - 1]?.userId ?? null) : null,
    };
  }

  async updateMemberRole(
    householdId: string,
    callerUserId: string,
    targetUserId: string,
    newRole: Role,
  ) {
    this.assertActor(callerUserId);
    try {
      await this.db.rpc('change_member_role', {
        p_household_id: householdId,
        p_user_id: targetUserId,
        p_role: newRole,
      });
    } catch (error) {
      if (error instanceof SupabasePostgrestError && error.tag === 'self_change_not_allowed')
        return { success: false as const, error: 'SELF_MODIFICATION' as const };
      if (error instanceof SupabasePostgrestError && error.tag === 'last_admin_protected')
        return { success: false as const, error: 'LAST_ADMIN' as const };
      if (error instanceof SupabasePostgrestError && error.code === 'P0002')
        return { success: false as const };
      throw error;
    }
    const member = await this.getMembership(householdId, targetUserId);
    if (!member) return { success: false as const };
    return { success: true as const, member };
  }

  async createInvitation(
    householdId: string,
    callerUserId: string,
    email: string | null,
    inviteRole: Role,
    expiresInDays: number,
  ) {
    this.assertActor(callerUserId);
    const result = await this.db.rpc<DbRow[]>('create_invitation', {
      p_household_id: householdId,
      p_email: email,
      p_role: inviteRole,
      p_expires_in: `${expiresInDays * 24} hours`,
    });
    const created = row(result);
    if (!created) throw new Error('Invitation creation returned no result');
    const id = String(created.invitation_id);
    const token = String(created.invitation_token);
    const invitation: InvitationItem = {
      id,
      householdId,
      email,
      role: inviteRole,
      expiresAt: String(created.invitation_expires_at),
      createdAt: new Date().toISOString(),
      acceptedAt: null,
      revokedAt: null,
    };
    return { invitation, token };
  }

  async listInvitations(householdId: string, limit: number, cursor?: string) {
    const n = bounded(limit);
    if (cursor && !isUuid(cursor)) throw new Error('Invitation cursor is invalid');
    const p = new URLSearchParams({
      select: 'id,household_id,email,role,expires_at,accepted_at,revoked_at,created_at',
      household_id: `eq.${householdId}`,
      order: 'id.asc',
      limit: String(n + 1),
    });
    if (cursor) p.set('id', `gt.${cursor}`);
    const rows = await this.db.select<DbRow[]>('household_invitations', p);
    const items = rows.slice(0, n).map((r) => ({
      id: String(r.id),
      householdId: String(r.household_id),
      email: (r.email as string | null) ?? null,
      role: role(r.role),
      expiresAt: String(r.expires_at),
      createdAt: String(r.created_at),
      acceptedAt: (r.accepted_at as string | null) ?? null,
      revokedAt: (r.revoked_at as string | null) ?? null,
    }));
    return { items, nextCursor: rows.length > n ? (items[items.length - 1]?.id ?? null) : null };
  }

  async revokeInvitation(_householdId: string, invitationId: string): Promise<boolean> {
    try {
      await this.db.rpc('revoke_invitation', { p_invitation_id: invitationId });
      return true;
    } catch (error) {
      if (
        error instanceof SupabasePostgrestError &&
        (error.status === 404 || error.tag === 'invalid_invitation')
      )
        return false;
      throw error;
    }
  }

  async acceptInvitation(userId: string, _userEmail: string | undefined, token: string) {
    this.assertActor(userId);
    try {
      const householdId = await this.db.rpc<string>('accept_invitation', { p_token: token });
      const membership = await this.getMembership(householdId, this.actorUserId);
      return membership
        ? { success: true as const, householdId, role: membership.role }
        : { success: false as const, error: 'INVALID_TOKEN' as const };
    } catch (error) {
      if (error instanceof SupabasePostgrestError && error.tag === 'invalid_invitation')
        return { success: false as const, error: 'INVALID_TOKEN' as const };
      if (error instanceof SupabasePostgrestError && error.tag === 'already_member')
        return { success: false as const, error: 'ALREADY_MEMBER' as const };
      throw error;
    }
  }

  async getSettings(householdId: string): Promise<HouseholdSettingsView | null> {
    const p = new URLSearchParams({
      select: 'monthly_spend_cap_usd,stale_after_seconds,automation_paused,controls_enabled',
      household_id: `eq.${householdId}`,
      limit: '1',
    });
    const r = row(await this.db.select<DbRow[]>('household_settings', p));
    return r
      ? {
          staleAfterSeconds: Number(r.stale_after_seconds),
          automationPaused: Boolean(r.automation_paused),
          controlsEnabled: Boolean(r.controls_enabled),
          budget: { spentUsd: null, capUsd: String(r.monthly_spend_cap_usd), state: 'UNKNOWN' },
        }
      : null;
  }

  async updateSettings(
    householdId: string,
    updates: UpdateHouseholdSettingsRequest,
  ): Promise<HouseholdSettingsView | null> {
    const fields: Record<string, string> = {
      monthlySpendCapUsd: 'monthly_spend_cap_usd',
      liveBackgroundIntervalMinutes: 'live_background_interval_minutes',
      liveOnDemandMinIntervalSeconds: 'live_on_demand_min_interval_seconds',
      onDemandMonthlyAllowance: 'on_demand_monthly_allowance',
      rawRetentionDays: 'raw_retention_days',
      staleAfterSeconds: 'stale_after_seconds',
      controlsEnabled: 'controls_enabled',
    };
    const body: DbRow = {};
    for (const [key, value] of Object.entries(updates)) if (fields[key]) body[fields[key]!] = value;
    if (!Object.keys(body).length)
      throw new Error('Settings update must include a supported field');
    const p = new URLSearchParams({
      household_id: `eq.${householdId}`,
      select: 'monthly_spend_cap_usd,stale_after_seconds,automation_paused,controls_enabled',
    });
    const r = row(await this.db.patch<DbRow[]>('household_settings', p, body));
    if (!r) return null;
    return {
      staleAfterSeconds: Number(r.stale_after_seconds),
      automationPaused: Boolean(r.automation_paused),
      controlsEnabled: Boolean(r.controls_enabled),
      budget: { spentUsd: null, capUsd: String(r.monthly_spend_cap_usd), state: 'UNKNOWN' },
    };
  }

  async removeMember(householdId: string, callerUserId: string, targetUserId: string) {
    this.assertActor(callerUserId);
    try {
      await this.db.rpc('remove_member', { p_household_id: householdId, p_user_id: targetUserId });
      return { success: true as const };
    } catch (error) {
      if (error instanceof SupabasePostgrestError && error.tag === 'last_admin_protected') {
        if (callerUserId === targetUserId)
          return { success: false as const, error: 'SELF_MODIFICATION' as const };
        return { success: false as const, error: 'LAST_ADMIN' as const };
      }
      if (error instanceof SupabasePostgrestError && error.tag === 'self_change_not_allowed')
        return { success: false as const, error: 'SELF_MODIFICATION' as const };
      if (error instanceof SupabasePostgrestError && error.code === 'P0002')
        return { success: false as const, error: 'NOT_FOUND' as const };
      throw error;
    }
  }

  async leaveHousehold(householdId: string, userId: string) {
    this.assertActor(userId);
    try {
      await this.db.rpc('leave_household', { p_household_id: householdId });
      return { success: true as const };
    } catch (error) {
      if (error instanceof SupabasePostgrestError && error.tag === 'last_admin_protected')
        return { success: false as const, error: 'LAST_ADMIN' as const };
      if (
        error instanceof SupabasePostgrestError &&
        (error.code === '42501' || error.code === 'P0002')
      )
        return { success: false as const, error: 'NOT_FOUND' as const };
      throw error;
    }
  }
}
