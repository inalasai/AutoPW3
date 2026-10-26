import type {
  AutomationRule,
  CreateRuleRequest,
  CreateTariffRequest,
  EnergySite,
  Household,
  HouseholdSettingsView,
  Role,
  Tariff,
  UpdateRuleRequest,
} from '@autopw3/shared';

export interface MemberItem {
  readonly userId: string;
  readonly displayName: string | null;
  readonly role: Role;
  readonly createdAt: string;
}

export interface InvitationItem {
  readonly id: string;
  readonly householdId: string;
  readonly email: string | null;
  readonly role: Role;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
  readonly revokedAt: string | null;
}

export interface SiteCapabilityItem {
  readonly capability:
    | 'storm_mode'
    | 'backup_reserve'
    | 'operational_mode'
    | 'grid_charging'
    | 'export_rule'
    | 'island_mode';
  readonly status: 'SUPPORTED' | 'UNVERIFIED' | 'NOT_SUPPORTED' | 'DISABLED_BY_SETTING';
  readonly reason: string | null;
}

export interface CommandItem {
  readonly id: string;
  readonly siteId: string;
  readonly kind: string;
  readonly state: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN';
  readonly createdAt: string;
}

export interface Repository {
  getHouseholdMemberships(
    userId: string,
  ): Promise<readonly { householdId: string; name: string; role: Role }[]>;
  getHousehold(householdId: string): Promise<Household | null>;
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
  ): Promise<{ invitation: InvitationItem; token: string; link: string }>;
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
  listSites(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly EnergySite[]; nextCursor: string | null }>;
  getSite(siteId: string): Promise<EnergySite | null>;
  getHouseholdIdForSite(siteId: string): Promise<string | null>;
  getSiteCapabilities(siteId: string): Promise<readonly SiteCapabilityItem[]>;
  listTariffs(
    householdId: string,
    filter?: { direction?: string; asOf?: string },
    limit?: number,
    cursor?: string,
  ): Promise<{ items: readonly Tariff[]; nextCursor: string | null }>;
  getTariff(tariffId: string): Promise<Tariff | null>;
  getHouseholdIdForTariff(tariffId: string): Promise<string | null>;
  createTariff(
    householdId: string,
    tariff: CreateTariffRequest,
  ): Promise<{ success: boolean; tariff?: Tariff; error?: 'OVERLAP' | 'VALIDATION_FAILED' }>;
  endTariff(
    tariffId: string,
    effectiveTo: string,
  ): Promise<{ success: boolean; tariff?: Tariff; error?: string }>;
  deleteTariff(tariffId: string): Promise<{ success: boolean; error?: 'REFERENCED' | 'NOT_FOUND' }>;
  putPricePoints(
    tariffId: string,
    points: readonly { intervalStart: string; ratePerKwh: string; intervalEnd?: string }[],
  ): Promise<{ count: number }>;
  listRules(
    siteId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly AutomationRule[]; nextCursor: string | null }>;
  getHouseholdIdForRule(ruleId: string): Promise<string | null>;
  createRule(siteId: string, rule: CreateRuleRequest): Promise<AutomationRule>;
  updateRule(
    ruleId: string,
    rule: UpdateRuleRequest,
  ): Promise<{ rule?: AutomationRule; error?: 'NOT_FOUND' | 'VERSION_MISMATCH' }>;
  listCommands(
    siteId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly CommandItem[]; nextCursor: string | null }>;
}

export class InMemoryRepository implements Repository {
  private readonly households = new Map<string, Household>();
  private readonly members = new Map<string, Map<string, MemberItem>>();
  private readonly invitations = new Map<string, InvitationItem & { tokenHash: string }>();
  private readonly sites = new Map<string, EnergySite>();
  private readonly siteHouseholdMap = new Map<string, string>();
  private readonly tariffs = new Map<string, Tariff>();
  private readonly tariffHouseholdMap = new Map<string, string>();
  private readonly rules = new Map<string, AutomationRule>();
  private readonly ruleSiteMap = new Map<string, string>();
  private readonly commands = new Map<string, CommandItem>();

  constructor() {
    this.seedDefaultData();
  }

  private seedDefaultData(): void {
    const hid = '11111111-1111-4111-8111-111111111111';
    const sid = '22222222-2222-4222-8222-222222222222';
    const adminId = '44444444-4444-4444-8444-444444444444';
    const rwId = '55555555-5555-4555-8555-555555555555';
    const roId = '66666666-6666-4666-8666-666666666666';

    // Household
    this.households.set(hid, {
      id: hid,
      name: 'Demo Household',
      timezone: 'Europe/Dublin',
    });

    // Members map
    const householdMembers = new Map<string, MemberItem>();
    householdMembers.set(adminId, {
      userId: adminId,
      displayName: 'Alice Admin',
      role: 'ADMIN',
      createdAt: '2026-01-01T00:00:00Z',
    });
    householdMembers.set(rwId, {
      userId: rwId,
      displayName: 'Bob Member',
      role: 'READ_WRITE',
      createdAt: '2026-01-02T00:00:00Z',
    });
    householdMembers.set(roId, {
      userId: roId,
      displayName: 'Charlie Viewer',
      role: 'READ_ONLY',
      createdAt: '2026-01-03T00:00:00Z',
    });
    this.members.set(hid, householdMembers);

    // Site
    this.sites.set(sid, {
      id: sid,
      name: 'Demo Site',
      timezone: 'Europe/Dublin',
      provider: 'TESLA',
      connectionState: 'LIVE',
      capabilitiesSummary: {
        supported: 4,
        unverified: 1,
        notSupported: 1,
        disabledBySetting: 0,
      },
    });
    this.siteHouseholdMap.set(sid, hid);

    // Initial Tariff
    const tid = '88888888-8888-4888-8888-888888888888';
    const tkey = '99999999-9999-4999-8999-999999999999';
    this.tariffs.set(tid, {
      id: tid,
      tariffKey: tkey,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      name: 'Default Import Flat',
      direction: 'IMPORT',
      priceMode: 'FLAT',
      currency: 'EUR',
      timezone: 'Europe/Dublin',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      taxMode: 'NONE',
      vatRatePercent: null,
      flatRatePerKwh: '0.250000',
      standingChargePerDay: '0.500000',
      exportPaymentModel: null,
      siteId: null,
      slots: [],
      seasons: [],
      overrides: [],
      levies: [],
    });
    this.tariffHouseholdMap.set(tid, hid);

    // Rule
    const r1Id = '33333333-3333-4333-8333-333333333333';
    this.rules.set(r1Id, {
      id: r1Id,
      siteId: sid,
      name: 'Charge Before Storm',
      priority: 100,
      definitionVersion: 1,
      definition: {
        conditions: [
          {
            type: 'BATTERY_SOC',
            comparator: 'LT',
            valuePercent: 50,
          },
        ],
        actions: [
          {
            kind: 'SET_BACKUP_RESERVE',
            params: { backupReservePercent: 100 },
          },
        ],
      },
      mode: 'DRY_RUN',
      version: 1,
      createdAt: '2026-01-05T00:00:00Z',
      updatedAt: '2026-01-05T00:00:00Z',
    });
    this.ruleSiteMap.set(r1Id, sid);
  }

  async getHouseholdMemberships(
    userId: string,
  ): Promise<readonly { householdId: string; name: string; role: Role }[]> {
    const result: { householdId: string; name: string; role: Role }[] = [];
    for (const [hid, membersMap] of this.members.entries()) {
      const member = membersMap.get(userId);
      if (member) {
        const hh = this.households.get(hid);
        if (hh) {
          result.push({
            householdId: hid,
            name: hh.name,
            role: member.role,
          });
        }
      }
    }
    return result;
  }

  async getHousehold(householdId: string): Promise<Household | null> {
    return this.households.get(householdId) ?? null;
  }

  async getMembership(
    householdId: string,
    userId: string,
  ): Promise<{ role: Role; userId: string; displayName: string | null } | null> {
    const hhMembers = this.members.get(householdId);
    if (!hhMembers) return null;
    const member = hhMembers.get(userId);
    if (!member) return null;
    return { role: member.role, userId: member.userId, displayName: member.displayName };
  }

  async listMembers(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly MemberItem[]; nextCursor: string | null }> {
    const hhMembers = this.members.get(householdId);
    if (!hhMembers) return { items: [], nextCursor: null };
    let all = Array.from(hhMembers.values());
    if (cursor) {
      const idx = all.findIndex((m) => m.userId === cursor);
      if (idx >= 0) all = all.slice(idx + 1);
    }
    const page = all.slice(0, limit);
    const nextCursor =
      page.length === limit && all.length > limit ? page[page.length - 1]!.userId : null;
    return { items: page, nextCursor };
  }

  async updateMemberRole(
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
    const hhMembers = this.members.get(householdId);
    if (!hhMembers) return { success: false };
    const target = hhMembers.get(targetUserId);
    if (!target) return { success: false };

    // Check if target is last active ADMIN
    if (target.role === 'ADMIN' && newRole !== 'ADMIN') {
      const adminCount = Array.from(hhMembers.values()).filter((m) => m.role === 'ADMIN').length;
      if (adminCount <= 1) {
        return { success: false, error: 'LAST_ADMIN' };
      }
    }

    const updated: MemberItem = { ...target, role: newRole };
    hhMembers.set(targetUserId, updated);
    return { success: true, member: updated };
  }

  async createInvitation(
    householdId: string,
    _callerUserId: string,
    email: string | null,
    role: Role,
    expiresInDays: number,
  ): Promise<{ invitation: InvitationItem; token: string; link: string }> {
    const id = crypto.randomUUID();
    const rawToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const tokenHash = await this.hashToken(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const invitation: InvitationItem & { tokenHash: string } = {
      id,
      householdId,
      email,
      role,
      expiresAt,
      createdAt: now.toISOString(),
      acceptedAt: null,
      revokedAt: null,
      tokenHash,
    };
    this.invitations.set(id, invitation);

    const link = `https://autopw3.local/invite?token=${rawToken}`;
    return {
      invitation: {
        id: invitation.id,
        householdId: invitation.householdId,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        acceptedAt: invitation.acceptedAt,
        revokedAt: invitation.revokedAt,
      },
      token: rawToken,
      link,
    };
  }

  async listInvitations(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly InvitationItem[]; nextCursor: string | null }> {
    let all = Array.from(this.invitations.values()).filter(
      (inv) => inv.householdId === householdId,
    );
    if (cursor) {
      const idx = all.findIndex((i) => i.id === cursor);
      if (idx >= 0) all = all.slice(idx + 1);
    }
    const page = all.slice(0, limit).map((i) => ({
      id: i.id,
      householdId: i.householdId,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      acceptedAt: i.acceptedAt,
      revokedAt: i.revokedAt,
    }));
    const nextCursor =
      page.length === limit && all.length > limit ? page[page.length - 1]!.id : null;
    return { items: page, nextCursor };
  }

  async revokeInvitation(householdId: string, invitationId: string): Promise<boolean> {
    const inv = this.invitations.get(invitationId);
    if (!inv || inv.householdId !== householdId) return false;
    this.invitations.set(invitationId, {
      ...inv,
      revokedAt: new Date().toISOString(),
    });
    return true;
  }

  async acceptInvitation(
    userId: string,
    userEmail: string | undefined,
    token: string,
  ): Promise<{
    success: boolean;
    householdId?: string;
    role?: Role;
    error?: 'INVALID_TOKEN' | 'EXPIRED' | 'EMAIL_MISMATCH' | 'ALREADY_MEMBER';
  }> {
    const tokenHash = await this.hashToken(token);
    const inv = Array.from(this.invitations.values()).find((i) => i.tokenHash === tokenHash);

    if (!inv || inv.revokedAt !== null || inv.acceptedAt !== null) {
      return { success: false, error: 'INVALID_TOKEN' };
    }

    if (new Date(inv.expiresAt).getTime() < Date.now()) {
      return { success: false, error: 'EXPIRED' };
    }

    if (inv.email && inv.email.toLowerCase() !== userEmail?.toLowerCase()) {
      return { success: false, error: 'EMAIL_MISMATCH' };
    }

    // Check if already a member
    let hhMembers = this.members.get(inv.householdId);
    if (!hhMembers) {
      hhMembers = new Map();
      this.members.set(inv.householdId, hhMembers);
    }
    if (hhMembers.has(userId)) {
      return { success: false, error: 'ALREADY_MEMBER' };
    }

    // Add membership
    hhMembers.set(userId, {
      userId,
      displayName: userEmail ?? 'New Member',
      role: inv.role,
      createdAt: new Date().toISOString(),
    });

    // Mark invitation accepted
    this.invitations.set(inv.id, {
      ...inv,
      acceptedAt: new Date().toISOString(),
    });

    return { success: true, householdId: inv.householdId, role: inv.role };
  }

  async getSettings(householdId: string): Promise<HouseholdSettingsView | null> {
    if (!this.households.has(householdId)) return null;
    return {
      staleAfterSeconds: 300,
      automationPaused: false,
      controlsEnabled: true,
      budget: {
        spentUsd: '0.00',
        capUsd: '9.00',
        state: 'OK',
      },
    };
  }

  async listSites(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly EnergySite[]; nextCursor: string | null }> {
    const validSiteIds = Array.from(this.siteHouseholdMap.entries())
      .filter(([, hid]) => hid === householdId)
      .map(([sid]) => sid);

    let all = validSiteIds.map((sid) => this.sites.get(sid)!).filter(Boolean);
    if (cursor) {
      const idx = all.findIndex((s) => s.id === cursor);
      if (idx >= 0) all = all.slice(idx + 1);
    }
    const page = all.slice(0, limit);
    const nextCursor =
      page.length === limit && all.length > limit ? page[page.length - 1]!.id : null;
    return { items: page, nextCursor };
  }

  async getSite(siteId: string): Promise<EnergySite | null> {
    return this.sites.get(siteId) ?? null;
  }

  async getHouseholdIdForSite(siteId: string): Promise<string | null> {
    return this.siteHouseholdMap.get(siteId) ?? null;
  }

  async getSiteCapabilities(_siteId: string): Promise<readonly SiteCapabilityItem[]> {
    return [
      { capability: 'storm_mode', status: 'SUPPORTED', reason: null },
      { capability: 'backup_reserve', status: 'SUPPORTED', reason: null },
      { capability: 'operational_mode', status: 'SUPPORTED', reason: null },
      { capability: 'grid_charging', status: 'SUPPORTED', reason: null },
      { capability: 'export_rule', status: 'UNVERIFIED', reason: 'Awaiting hardware verification' },
      { capability: 'island_mode', status: 'NOT_SUPPORTED', reason: 'Restricted by safety model' },
    ];
  }

  async listTariffs(
    householdId: string,
    filter?: { direction?: string; asOf?: string },
    limit: number = 50,
    cursor?: string,
  ): Promise<{ items: readonly Tariff[]; nextCursor: string | null }> {
    const validTariffIds = Array.from(this.tariffHouseholdMap.entries())
      .filter(([, hid]) => hid === householdId)
      .map(([tid]) => tid);

    let all = validTariffIds.map((tid) => this.tariffs.get(tid)!).filter(Boolean);
    if (filter?.direction) {
      all = all.filter((t) => t.direction === filter.direction);
    }
    if (filter?.asOf) {
      all = all.filter((t) => {
        const fromOk = t.effectiveFrom <= filter.asOf!;
        const toOk = !t.effectiveTo || t.effectiveTo > filter.asOf!;
        return fromOk && toOk;
      });
    }
    if (cursor) {
      const idx = all.findIndex((t) => t.id === cursor);
      if (idx >= 0) all = all.slice(idx + 1);
    }
    const page = all.slice(0, limit);
    const nextCursor =
      page.length === limit && all.length > limit ? page[page.length - 1]!.id : null;
    return { items: page, nextCursor };
  }

  async getTariff(tariffId: string): Promise<Tariff | null> {
    return this.tariffs.get(tariffId) ?? null;
  }

  async getHouseholdIdForTariff(tariffId: string): Promise<string | null> {
    return this.tariffHouseholdMap.get(tariffId) ?? null;
  }

  async createTariff(
    householdId: string,
    request: CreateTariffRequest,
  ): Promise<{ success: boolean; tariff?: Tariff; error?: 'OVERLAP' | 'VALIDATION_FAILED' }> {
    const existing = Array.from(this.tariffs.values()).filter((t) => {
      const hid = this.tariffHouseholdMap.get(t.id);
      return (
        hid === householdId &&
        t.direction === request.direction &&
        t.tariffKey === request.tariffKey
      );
    });

    for (const t of existing) {
      const overlapStart = !t.effectiveTo || request.effectiveFrom < t.effectiveTo;
      const overlapEnd = !request.effectiveTo || t.effectiveFrom < request.effectiveTo;
      if (overlapStart && overlapEnd) {
        return { success: false, error: 'OVERLAP' };
      }
    }

    const id = crypto.randomUUID();
    const tariffKey = request.tariffKey ?? crypto.randomUUID();
    const tariff: Tariff = {
      ...request,
      id,
      tariffKey,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.tariffs.set(id, tariff);
    this.tariffHouseholdMap.set(id, householdId);
    return { success: true, tariff };
  }

  async endTariff(
    tariffId: string,
    effectiveTo: string,
  ): Promise<{ success: boolean; tariff?: Tariff; error?: string }> {
    const tariff = this.tariffs.get(tariffId);
    if (!tariff) return { success: false, error: 'NOT_FOUND' };
    const updated: Tariff = { ...tariff, effectiveTo };
    this.tariffs.set(tariffId, updated);
    return { success: true, tariff: updated };
  }

  async deleteTariff(
    tariffId: string,
  ): Promise<{ success: boolean; error?: 'REFERENCED' | 'NOT_FOUND' }> {
    if (!this.tariffs.has(tariffId)) return { success: false, error: 'NOT_FOUND' };
    this.tariffs.delete(tariffId);
    this.tariffHouseholdMap.delete(tariffId);
    return { success: true };
  }

  async putPricePoints(
    _tariffId: string,
    points: readonly { intervalStart: string; ratePerKwh: string; intervalEnd?: string }[],
  ): Promise<{ count: number }> {
    return { count: points.length };
  }

  async listRules(
    siteId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly AutomationRule[]; nextCursor: string | null }> {
    let all = Array.from(this.rules.values()).filter((r) => r.siteId === siteId);
    if (cursor) {
      const idx = all.findIndex((r) => r.id === cursor);
      if (idx >= 0) all = all.slice(idx + 1);
    }
    const page = all.slice(0, limit);
    const nextCursor =
      page.length === limit && all.length > limit ? page[page.length - 1]!.id : null;
    return { items: page, nextCursor };
  }

  async getHouseholdIdForRule(ruleId: string): Promise<string | null> {
    const sid = this.ruleSiteMap.get(ruleId);
    if (!sid) return null;
    return this.siteHouseholdMap.get(sid) ?? null;
  }

  async createRule(siteId: string, rule: CreateRuleRequest): Promise<AutomationRule> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newRule: AutomationRule = {
      id,
      siteId,
      name: rule.name,
      priority: rule.priority,
      definitionVersion: 1,
      definition: rule.definition,
      mode: rule.mode,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rules.set(id, newRule);
    this.ruleSiteMap.set(id, siteId);
    return newRule;
  }

  async updateRule(
    ruleId: string,
    rule: UpdateRuleRequest,
  ): Promise<{ rule?: AutomationRule; error?: 'NOT_FOUND' | 'VERSION_MISMATCH' }> {
    const existing = this.rules.get(ruleId);
    if (!existing) return { error: 'NOT_FOUND' };
    if (rule.version !== existing.version) {
      return { error: 'VERSION_MISMATCH' };
    }

    const updated: AutomationRule = {
      ...existing,
      ...(rule.name !== undefined ? { name: rule.name } : {}),
      ...(rule.priority !== undefined ? { priority: rule.priority } : {}),
      ...(rule.definition !== undefined ? { definition: rule.definition } : {}),
      ...(rule.mode !== undefined ? { mode: rule.mode } : {}),
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.rules.set(ruleId, updated);
    return { rule: updated };
  }

  async listCommands(
    siteId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly CommandItem[]; nextCursor: string | null }> {
    let all = Array.from(this.commands.values()).filter((c) => c.siteId === siteId);
    if (cursor) {
      const idx = all.findIndex((c) => c.id === cursor);
      if (idx >= 0) all = all.slice(idx + 1);
    }
    const page = all.slice(0, limit);
    const nextCursor =
      page.length === limit && all.length > limit ? page[page.length - 1]!.id : null;
    return { items: page, nextCursor };
  }

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const digestBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(digestBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
