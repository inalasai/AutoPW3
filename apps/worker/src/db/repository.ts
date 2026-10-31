import type {
  AuditEntry,
  AuditQuery,
  AutomationExecution,
  AutomationRule,
  CommandEvent,
  CreateRuleRequest,
  CreateSiteRequest,
  CreateTariffRequest,
  EnergyInterval,
  EnergySeriesPoint,
  EnergySite,
  Household,
  HouseholdExportResponse,
  HouseholdSettingsView,
  MeExportResponse,
  PersistedPowerSample,
  Role,
  RuleMode,
  Tariff,
  TeslaLinkStatus,
  UpdateHouseholdSettingsRequest,
  UpdateRuleRequest,
} from '@autopw3/shared';
import type { SiteConfiguration, StoredCommandRecord } from '../services/commands/types';
import type { TelemetrySyncState } from '../services/ingestion/types';

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
  listSites(
    householdId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly EnergySite[]; nextCursor: string | null }>;
  getSite(siteId: string): Promise<EnergySite | null>;
  getHouseholdIdForSite(siteId: string): Promise<string | null>;
  getProviderSiteId(siteId: string): Promise<string | null>;
  getSiteCapabilities(siteId: string): Promise<readonly SiteCapabilityItem[]>;
  createSite(householdId: string, site: CreateSiteRequest): Promise<EnergySite>;
  getTeslaLink(householdId: string): Promise<TeslaLinkStatus>;
  setTeslaLink(householdId: string, status: TeslaLinkStatus): Promise<void>;
  disconnectTesla(householdId: string): Promise<void>;
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
  getRule(ruleId: string): Promise<AutomationRule | null>;
  getHouseholdIdForRule(ruleId: string): Promise<string | null>;
  getHouseholdIdForCommand(commandId: string): Promise<string | null>;
  createRule(siteId: string, rule: CreateRuleRequest): Promise<AutomationRule>;
  updateRule(
    ruleId: string,
    rule: UpdateRuleRequest,
  ): Promise<{ rule?: AutomationRule; error?: 'NOT_FOUND' | 'VERSION_MISMATCH' }>;
  deleteRule(ruleId: string): Promise<boolean>;
  setRuleMode(
    ruleId: string,
    mode: RuleMode,
  ): Promise<{ rule?: AutomationRule; error?: 'NOT_FOUND' }>;
  recordAutomationExecution(
    execution: AutomationExecution,
  ): Promise<{ execution: AutomationExecution; alreadyRecorded: boolean }>;
  listAutomationExecutions(
    siteId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly AutomationExecution[]; nextCursor: string | null }>;
  getAutomationPaused(householdId: string): Promise<boolean>;
  setAutomationPaused(
    householdId: string,
    paused: boolean,
  ): Promise<{ automationPaused: boolean; pausedAt: string | null }>;
  getSiteConfiguration(siteId: string): Promise<SiteConfiguration | null>;
  updateSiteConfiguration(
    siteId: string,
    updates: Partial<SiteConfiguration>,
  ): Promise<SiteConfiguration>;
  recordCommandIntent(
    command: StoredCommandRecord,
  ): Promise<{ command: StoredCommandRecord; replayed: boolean }>;
  getCommand(siteId: string, commandId: string): Promise<StoredCommandRecord | null>;
  getCommandById(
    commandId: string,
  ): Promise<{ command: StoredCommandRecord; events: readonly CommandEvent[] } | null>;
  getCommandWithEvents(
    siteId: string,
    commandId: string,
  ): Promise<{ command: StoredCommandRecord; events: readonly CommandEvent[] } | null>;
  updateCommand(
    siteId: string,
    commandId: string,
    updates: Partial<StoredCommandRecord>,
  ): Promise<StoredCommandRecord>;
  recordCommandEvent(commandId: string, event: CommandEvent): Promise<void>;
  listCommands(
    siteId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly StoredCommandRecord[]; nextCursor: string | null }>;
  recordPowerSample(siteId: string, sample: PersistedPowerSample): Promise<void>;
  getLatestPowerSample(siteId: string): Promise<PersistedPowerSample | null>;
  queryPowerSamples(
    siteId: string,
    from: string,
    to: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly PersistedPowerSample[]; nextCursor: string | null }>;
  recordEnergyIntervals(siteId: string, intervals: readonly EnergyInterval[]): Promise<void>;
  queryEnergyIntervals(
    siteId: string,
    from: string,
    to: string,
  ): Promise<readonly EnergyInterval[]>;
  getHourlyRollups(siteId: string, from: string, to: string): Promise<readonly EnergySeriesPoint[]>;
  saveHourlyRollups(siteId: string, rollups: readonly EnergySeriesPoint[]): Promise<void>;
  getDailyRollups(siteId: string, from: string, to: string): Promise<readonly EnergySeriesPoint[]>;
  saveDailyRollups(siteId: string, rollups: readonly EnergySeriesPoint[]): Promise<void>;
  getSyncState(siteId: string, stream: 'LIVE' | 'HISTORY'): Promise<TelemetrySyncState | null>;
  updateSyncState(
    siteId: string,
    stream: 'LIVE' | 'HISTORY',
    update: Partial<TelemetrySyncState>,
  ): Promise<void>;
  updateSiteConnectionState(
    siteId: string,
    state: 'CONNECTING' | 'LIVE' | 'STALE' | 'ERROR' | 'DISCONNECTED',
  ): Promise<void>;
  recordProviderUsage(
    householdId: string,
    category: 'DATA' | 'COMMAND' | 'WAKE' | 'STREAM' | 'AUTH',
    success: boolean,
    date?: string,
  ): Promise<void>;
  getProviderUsage(
    householdId: string,
    date: string,
    category: 'DATA' | 'COMMAND' | 'WAKE' | 'STREAM' | 'AUTH',
  ): Promise<{ requestCount: number; errorCount: number }>;
  purgeOldMetricsLog(olderThanUtc: string, dryRun: boolean): Promise<{ deletedCount: number }>;
  purgeOldScheduledJobs(olderThanUtc: string, dryRun: boolean): Promise<{ deletedCount: number }>;
  removeMember(
    householdId: string,
    callerUserId: string,
    targetUserId: string,
  ): Promise<{ success: boolean; error?: 'SELF_MODIFICATION' | 'LAST_ADMIN' | 'NOT_FOUND' }>;
  updateHousehold(
    householdId: string,
    updates: { name?: string | undefined; timezone?: string | undefined },
  ): Promise<Household | null>;
  updateSite(siteId: string, updates: { name?: string | undefined }): Promise<EnergySite | null>;
  updateSettings(
    householdId: string,
    updates: UpdateHouseholdSettingsRequest,
  ): Promise<HouseholdSettingsView | null>;
  listAudit(
    householdId: string,
    query: AuditQuery,
  ): Promise<{ items: readonly AuditEntry[]; nextCursor: string | null }>;
  recordAuditEvent(
    householdId: string,
    entry: Omit<AuditEntry, 'id' | 'createdAt'> & { createdAt?: string },
  ): Promise<AuditEntry>;
  exportHouseholdData(householdId: string): Promise<HouseholdExportResponse>;
  deleteHousehold(
    householdId: string,
    confirmName: string,
  ): Promise<{ success: boolean; error?: 'NAME_MISMATCH' | 'NOT_FOUND' }>;
  exportMe(userId: string): Promise<MeExportResponse>;
  deleteAccount(userId: string): Promise<{ success: boolean; error?: 'LAST_ADMIN' }>;
  leaveHousehold(
    householdId: string,
    userId: string,
  ): Promise<{ success: boolean; error?: 'LAST_ADMIN' | 'NOT_FOUND' }>;
  listAllHouseholdIds?(): Promise<readonly string[]>;
}

export class InMemoryRepository implements Repository {
  private readonly profiles = new Map<
    string,
    { userId: string; displayName: string | null; locale: string | null }
  >();
  private readonly households = new Map<string, Household>();
  private readonly members = new Map<string, Map<string, MemberItem>>();
  private readonly invitations = new Map<string, InvitationItem & { tokenHash: string }>();
  private readonly sites = new Map<string, EnergySite>();
  private readonly siteHouseholdMap = new Map<string, string>();
  private readonly siteProviderIds = new Map<string, string>();
  private readonly tariffs = new Map<string, Tariff>();
  private readonly tariffHouseholdMap = new Map<string, string>();
  private readonly rules = new Map<string, AutomationRule>();
  private readonly ruleSiteMap = new Map<string, string>();
  private readonly automationExecutions = new Map<string, AutomationExecution>();
  private readonly ruleSlotExecutionMap = new Map<string, string>();
  private readonly commands = new Map<string, StoredCommandRecord>();
  private readonly commandEvents = new Map<string, CommandEvent[]>();
  private readonly teslaLinks = new Map<string, TeslaLinkStatus>();
  private readonly siteConfigurations = new Map<string, SiteConfiguration>();
  private readonly householdAutomationPaused = new Map<
    string,
    { paused: boolean; pausedAt: string | null }
  >();
  private readonly powerSamples = new Map<string, PersistedPowerSample[]>();
  private readonly intervals = new Map<string, Map<string, EnergyInterval>>();
  private readonly hourly = new Map<string, Map<string, EnergySeriesPoint>>();
  private readonly daily = new Map<string, Map<string, EnergySeriesPoint>>();
  private readonly syncStates = new Map<string, TelemetrySyncState>();
  private readonly providerUsage = new Map<string, { requestCount: number; errorCount: number }>();
  private readonly scheduledJobs = new Map<
    string,
    { id: string; state: string; createdAt: string; finishedAt?: string }
  >();

  async getProfile(userId: string) {
    const existing = this.profiles.get(userId);
    if (existing) return { ...existing };
    let displayName: string | null = null;
    for (const householdMembers of this.members.values()) {
      const member = householdMembers.get(userId);
      if (member) {
        displayName = member.displayName;
        break;
      }
    }
    return { userId, displayName, locale: 'en-IE' };
  }

  async updateProfile(
    userId: string,
    updates: { displayName?: string | null; locale?: string | null },
  ) {
    const current = await this.getProfile(userId);
    const next = { ...current, ...updates };
    this.profiles.set(userId, next);
    return next;
  }

  private readonly householdSettings = new Map<
    string,
    {
      monthlySpendCapUsd: string;
      liveBackgroundIntervalMinutes: number;
      liveOnDemandMinIntervalSeconds: number;
      onDemandMonthlyAllowance: number;
      rawRetentionDays: number;
      staleAfterSeconds: number;
      controlsEnabled: boolean;
    }
  >();
  private readonly auditLogs = new Map<string, AuditEntry[]>();
  private auditIdCounter = 1;

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
    this.siteProviderIds.set(sid, '1234567890');

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

    this.siteConfigurations.set(sid, {
      backupReservePercent: 20,
      operationMode: 'SELF_CONSUMPTION',
      stormModeCapable: true,
      stormModeEnabled: false,
      allowGridCharging: true,
      allowGridExport: true,
      lastUpdated: '2026-06-21T12:00:00Z',
    });

    this.householdSettings.set(hid, {
      monthlySpendCapUsd: '9.00',
      liveBackgroundIntervalMinutes: 5,
      liveOnDemandMinIntervalSeconds: 30,
      onDemandMonthlyAllowance: 100,
      rawRetentionDays: 90,
      staleAfterSeconds: 300,
      controlsEnabled: true,
    });

    this.auditLogs.set(hid, [
      {
        id: '1',
        action: 'bootstrap.completed',
        actorType: 'SYSTEM',
        actorUserId: null,
        targetType: 'household',
        targetId: hid,
        metadata: { initialSiteId: sid },
        requestId: 'bootstrap-req-1',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: '2',
        action: 'member.added',
        actorType: 'USER',
        actorUserId: adminId,
        targetType: 'user',
        targetId: rwId,
        metadata: { role: 'READ_WRITE' },
        requestId: 'invite-req-1',
        createdAt: '2026-01-02T00:00:00Z',
      },
      {
        id: '3',
        action: 'member.added',
        actorType: 'USER',
        actorUserId: adminId,
        targetType: 'user',
        targetId: roId,
        metadata: { role: 'READ_ONLY' },
        requestId: 'invite-req-2',
        createdAt: '2026-01-03T00:00:00Z',
      },
      {
        id: '4',
        action: 'rule.mode_changed',
        actorType: 'USER',
        actorUserId: adminId,
        targetType: 'rule',
        targetId: r1Id,
        metadata: { oldMode: 'DISABLED', newMode: 'DRY_RUN' },
        requestId: 'rule-req-1',
        createdAt: '2026-01-05T00:00:00Z',
      },
    ]);
    this.auditIdCounter = 5;
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

  async listAllHouseholdIds(): Promise<readonly string[]> {
    return Array.from(this.households.keys());
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
  ): Promise<{ invitation: InvitationItem; token: string }> {
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
    const settings = this.householdSettings.get(householdId) ?? {
      monthlySpendCapUsd: '9.00',
      liveBackgroundIntervalMinutes: 5,
      liveOnDemandMinIntervalSeconds: 30,
      onDemandMonthlyAllowance: 100,
      rawRetentionDays: 90,
      staleAfterSeconds: 300,
      controlsEnabled: true,
    };
    const pauseInfo = this.householdAutomationPaused.get(householdId);
    return {
      staleAfterSeconds: settings.staleAfterSeconds,
      automationPaused: pauseInfo?.paused ?? false,
      controlsEnabled: settings.controlsEnabled,
      budget: {
        spentUsd: '0.00',
        capUsd: settings.monthlySpendCapUsd,
        state: 'OK',
      },
    };
  }

  async updateSettings(
    householdId: string,
    updates: UpdateHouseholdSettingsRequest,
  ): Promise<HouseholdSettingsView | null> {
    if (!this.households.has(householdId)) return null;
    const current = this.householdSettings.get(householdId) ?? {
      monthlySpendCapUsd: '9.00',
      liveBackgroundIntervalMinutes: 5,
      liveOnDemandMinIntervalSeconds: 30,
      onDemandMonthlyAllowance: 100,
      rawRetentionDays: 90,
      staleAfterSeconds: 300,
      controlsEnabled: true,
    };
    const updated = {
      monthlySpendCapUsd: updates.monthlySpendCapUsd ?? current.monthlySpendCapUsd,
      liveBackgroundIntervalMinutes:
        updates.liveBackgroundIntervalMinutes ?? current.liveBackgroundIntervalMinutes,
      liveOnDemandMinIntervalSeconds:
        updates.liveOnDemandMinIntervalSeconds ?? current.liveOnDemandMinIntervalSeconds,
      onDemandMonthlyAllowance:
        updates.onDemandMonthlyAllowance ?? current.onDemandMonthlyAllowance,
      rawRetentionDays: updates.rawRetentionDays ?? current.rawRetentionDays,
      staleAfterSeconds: updates.staleAfterSeconds ?? current.staleAfterSeconds,
      controlsEnabled: updates.controlsEnabled ?? current.controlsEnabled,
    };
    this.householdSettings.set(householdId, updated);
    return this.getSettings(householdId);
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

  async getProviderSiteId(siteId: string): Promise<string | null> {
    return this.siteProviderIds.get(siteId) ?? null;
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

  async getTeslaLink(householdId: string): Promise<TeslaLinkStatus> {
    return (
      this.teslaLinks.get(householdId) ?? {
        state: 'NOT_CONNECTED',
        scopes: [],
        lastRefreshAt: null,
      }
    );
  }

  async setTeslaLink(householdId: string, status: TeslaLinkStatus): Promise<void> {
    this.teslaLinks.set(householdId, status);
  }

  async disconnectTesla(householdId: string): Promise<void> {
    this.teslaLinks.set(householdId, {
      state: 'NOT_CONNECTED',
      scopes: [],
      lastRefreshAt: null,
    });
    for (const [sid, hid] of this.siteHouseholdMap.entries()) {
      if (hid === householdId) {
        const site = this.sites.get(sid);
        if (site && site.provider === 'TESLA') {
          this.sites.set(sid, {
            ...site,
            connectionState: 'DISCONNECTED',
          });
        }
      }
    }
  }

  async createSite(householdId: string, request: CreateSiteRequest): Promise<EnergySite> {
    const household = this.households.get(householdId);
    const timezone = request.timezone ?? household?.timezone ?? 'UTC';
    const siteId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      request.providerSiteId,
    )
      ? request.providerSiteId
      : crypto.randomUUID();

    const site: EnergySite = {
      id: siteId,
      name: request.name ?? `Tesla Powerwall (${request.providerSiteId})`,
      timezone,
      provider: request.provider,
      connectionState: 'LIVE',
      capabilitiesSummary: {
        supported: 4,
        unverified: 1,
        notSupported: 1,
        disabledBySetting: 0,
      },
    };

    this.sites.set(siteId, site);
    this.siteHouseholdMap.set(siteId, householdId);
    this.siteProviderIds.set(siteId, request.providerSiteId);
    return site;
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

  async getHouseholdIdForCommand(commandId: string): Promise<string | null> {
    const cmd = this.commands.get(commandId);
    if (!cmd) return null;
    return cmd.householdId;
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

  async getRule(ruleId: string): Promise<AutomationRule | null> {
    return this.rules.get(ruleId) ?? null;
  }

  async deleteRule(ruleId: string): Promise<boolean> {
    const existed = this.rules.delete(ruleId);
    this.ruleSiteMap.delete(ruleId);
    return existed;
  }

  async setRuleMode(
    ruleId: string,
    mode: RuleMode,
  ): Promise<{ rule?: AutomationRule; error?: 'NOT_FOUND' }> {
    const existing = this.rules.get(ruleId);
    if (!existing) return { error: 'NOT_FOUND' };
    const updated: AutomationRule = {
      ...existing,
      mode,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.rules.set(ruleId, updated);
    return { rule: updated };
  }

  async recordAutomationExecution(
    execution: AutomationExecution,
  ): Promise<{ execution: AutomationExecution; alreadyRecorded: boolean }> {
    const slotKey = `${execution.ruleId}:${execution.scheduledSlot}`;
    const existingId = this.ruleSlotExecutionMap.get(slotKey);
    if (existingId) {
      const existing = this.automationExecutions.get(existingId);
      if (existing) {
        return { execution: existing, alreadyRecorded: true };
      }
    }
    this.automationExecutions.set(execution.id, execution);
    this.ruleSlotExecutionMap.set(slotKey, execution.id);
    return { execution, alreadyRecorded: false };
  }

  async listAutomationExecutions(
    siteId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly AutomationExecution[]; nextCursor: string | null }> {
    let all = Array.from(this.automationExecutions.values())
      .filter((e) => e.siteId === siteId)
      .sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime());

    if (cursor) {
      const idx = all.findIndex((e) => e.id === cursor);
      if (idx >= 0) all = all.slice(idx + 1);
    }
    const page = all.slice(0, limit);
    const nextCursor =
      page.length === limit && all.length > limit ? page[page.length - 1]!.id : null;
    return { items: page, nextCursor };
  }

  async getAutomationPaused(householdId: string): Promise<boolean> {
    return this.householdAutomationPaused.get(householdId)?.paused ?? false;
  }

  async setAutomationPaused(
    householdId: string,
    paused: boolean,
  ): Promise<{ automationPaused: boolean; pausedAt: string | null }> {
    const pausedAt = paused ? new Date().toISOString() : null;
    this.householdAutomationPaused.set(householdId, { paused, pausedAt });
    return { automationPaused: paused, pausedAt };
  }

  async getSiteConfiguration(siteId: string): Promise<SiteConfiguration | null> {
    return this.siteConfigurations.get(siteId) ?? null;
  }

  async updateSiteConfiguration(
    siteId: string,
    updates: Partial<SiteConfiguration>,
  ): Promise<SiteConfiguration> {
    const existing = this.siteConfigurations.get(siteId) ?? {
      backupReservePercent: 20,
      operationMode: 'SELF_CONSUMPTION',
      stormModeCapable: true,
      stormModeEnabled: false,
      allowGridCharging: true,
      allowGridExport: true,
      lastUpdated: new Date().toISOString(),
    };
    const updated: SiteConfiguration = {
      ...existing,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };
    this.siteConfigurations.set(siteId, updated);
    return updated;
  }

  async recordCommandIntent(
    command: StoredCommandRecord,
  ): Promise<{ command: StoredCommandRecord; replayed: boolean }> {
    const existing = Array.from(this.commands.values()).find(
      (c) => c.siteId === command.siteId && c.idempotencyKey === command.idempotencyKey,
    );
    if (existing) {
      if (existing.paramsHash !== command.paramsHash) {
        throw new Error('Idempotency key replayed with mismatched parameters');
      }
      return { command: existing, replayed: true };
    }

    this.commands.set(command.id, command);
    return { command, replayed: false };
  }

  async getCommand(siteId: string, commandId: string): Promise<StoredCommandRecord | null> {
    const cmd = this.commands.get(commandId);
    if (!cmd || cmd.siteId !== siteId) return null;
    return cmd;
  }

  async getCommandById(
    commandId: string,
  ): Promise<{ command: StoredCommandRecord; events: readonly CommandEvent[] } | null> {
    const cmd = this.commands.get(commandId);
    if (!cmd) return null;
    const events = this.commandEvents.get(commandId) ?? [];
    return { command: cmd, events };
  }

  async getCommandWithEvents(
    siteId: string,
    commandId: string,
  ): Promise<{ command: StoredCommandRecord; events: readonly CommandEvent[] } | null> {
    const cmd = await this.getCommand(siteId, commandId);
    if (!cmd) return null;
    const events = this.commandEvents.get(commandId) ?? [];
    return { command: cmd, events };
  }

  async updateCommand(
    siteId: string,
    commandId: string,
    updates: Partial<StoredCommandRecord>,
  ): Promise<StoredCommandRecord> {
    const existing = await this.getCommand(siteId, commandId);
    if (!existing) {
      throw new Error(`Command ${commandId} not found`);
    }
    const updated = {
      ...existing,
      ...updates,
      outcome: {
        ...existing.outcome,
        ...(updates.outcome ?? {}),
        physicalOutcomeGuaranteed: false as const,
      },
    } as unknown as StoredCommandRecord;
    this.commands.set(commandId, updated);
    return updated;
  }

  async recordCommandEvent(commandId: string, event: CommandEvent): Promise<void> {
    let list = this.commandEvents.get(commandId);
    if (!list) {
      list = [];
      this.commandEvents.set(commandId, list);
    }
    list.push(event);
  }

  async listCommands(
    siteId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly StoredCommandRecord[]; nextCursor: string | null }> {
    let all = Array.from(this.commands.values()).filter((c) => c.siteId === siteId);
    all.sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
    if (cursor) {
      const idx = all.findIndex((c) => c.id === cursor);
      if (idx >= 0) all = all.slice(idx + 1);
    }
    const page = all.slice(0, limit);
    const nextCursor =
      page.length === limit && all.length > limit ? page[page.length - 1]!.id : null;
    return { items: page, nextCursor };
  }

  async recordPowerSample(siteId: string, sample: PersistedPowerSample): Promise<void> {
    if ((sample.source as string) === 'DEMO') {
      throw new Error('DEMO source is rejected in powerwall_metrics_log');
    }
    let list = this.powerSamples.get(siteId);
    if (!list) {
      list = [];
      this.powerSamples.set(siteId, list);
    }
    const existingIdx = list.findIndex((s) => s.sampledAt === sample.sampledAt);
    if (existingIdx >= 0) {
      list[existingIdx] = sample;
    } else {
      list.push(sample);
      list.sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
    }
  }

  async getLatestPowerSample(siteId: string): Promise<PersistedPowerSample | null> {
    const list = this.powerSamples.get(siteId);
    if (!list || list.length === 0) return null;
    return list[list.length - 1] ?? null;
  }

  async queryPowerSamples(
    siteId: string,
    from: string,
    to: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: readonly PersistedPowerSample[]; nextCursor: string | null }> {
    const list = this.powerSamples.get(siteId) ?? [];
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    let filtered = list.filter((s) => {
      const ms = Date.parse(s.sampledAt);
      return ms >= fromMs && ms < toMs;
    });
    if (cursor) {
      const idx = filtered.findIndex((s) => s.sampledAt === cursor);
      if (idx >= 0) {
        filtered = filtered.slice(idx + 1);
      }
    }
    const page = filtered.slice(0, limit);
    const nextCursor =
      page.length === limit && filtered.length > limit ? page[page.length - 1]!.sampledAt : null;
    return { items: page, nextCursor };
  }

  async recordEnergyIntervals(siteId: string, intervals: readonly EnergyInterval[]): Promise<void> {
    let siteMap = this.intervals.get(siteId);
    if (!siteMap) {
      siteMap = new Map();
      this.intervals.set(siteId, siteMap);
    }
    for (const interval of intervals) {
      if ((interval.source as string) === 'DEMO') {
        throw new Error('DEMO source is rejected in energy_intervals');
      }
      const key = `${interval.intervalStart}:${interval.resolutionSeconds}`;
      siteMap.set(key, interval);
    }
  }

  async queryEnergyIntervals(
    siteId: string,
    from: string,
    to: string,
  ): Promise<readonly EnergyInterval[]> {
    const siteMap = this.intervals.get(siteId);
    if (!siteMap) return [];
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    return Array.from(siteMap.values())
      .filter((i) => {
        const ms = Date.parse(i.intervalStart);
        return ms >= fromMs && ms < toMs;
      })
      .sort((a, b) => a.intervalStart.localeCompare(b.intervalStart));
  }

  async getHourlyRollups(
    siteId: string,
    from: string,
    to: string,
  ): Promise<readonly EnergySeriesPoint[]> {
    const siteMap = this.hourly.get(siteId);
    if (!siteMap) return [];
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    return Array.from(siteMap.values())
      .filter((r) => {
        const ms = Date.parse(r.start);
        return ms >= fromMs && ms < toMs;
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  async saveHourlyRollups(siteId: string, rollups: readonly EnergySeriesPoint[]): Promise<void> {
    let siteMap = this.hourly.get(siteId);
    if (!siteMap) {
      siteMap = new Map();
      this.hourly.set(siteId, siteMap);
    }
    for (const r of rollups) {
      siteMap.set(r.start, r);
    }
  }

  async getDailyRollups(
    siteId: string,
    from: string,
    to: string,
  ): Promise<readonly EnergySeriesPoint[]> {
    const siteMap = this.daily.get(siteId);
    if (!siteMap) return [];
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    return Array.from(siteMap.values())
      .filter((r) => {
        const ms = Date.parse(r.start);
        return ms >= fromMs && ms < toMs;
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  async saveDailyRollups(siteId: string, rollups: readonly EnergySeriesPoint[]): Promise<void> {
    let siteMap = this.daily.get(siteId);
    if (!siteMap) {
      siteMap = new Map();
      this.daily.set(siteId, siteMap);
    }
    for (const r of rollups) {
      siteMap.set(r.localDate ?? r.start, r);
    }
  }

  async getSyncState(
    siteId: string,
    stream: 'LIVE' | 'HISTORY',
  ): Promise<TelemetrySyncState | null> {
    const key = `${siteId}:${stream}`;
    return this.syncStates.get(key) ?? null;
  }

  async updateSyncState(
    siteId: string,
    stream: 'LIVE' | 'HISTORY',
    update: Partial<TelemetrySyncState>,
  ): Promise<void> {
    const key = `${siteId}:${stream}`;
    const existing = this.syncStates.get(key);
    const merged: TelemetrySyncState = {
      siteId,
      stream,
      lastAttemptAt: update.lastAttemptAt ?? existing?.lastAttemptAt ?? null,
      lastSuccessAt: update.lastSuccessAt ?? existing?.lastSuccessAt ?? null,
      lastStatus:
        update.lastStatus !== undefined ? update.lastStatus : (existing?.lastStatus ?? null),
      lastErrorCode:
        update.lastErrorCode !== undefined
          ? update.lastErrorCode
          : (existing?.lastErrorCode ?? null),
      cursor: update.cursor !== undefined ? update.cursor : (existing?.cursor ?? null),
      latestSampleAt:
        update.latestSampleAt !== undefined
          ? update.latestSampleAt
          : (existing?.latestSampleAt ?? null),
      consecutiveFailures:
        update.consecutiveFailures !== undefined
          ? update.consecutiveFailures
          : (existing?.consecutiveFailures ?? 0),
    };
    this.syncStates.set(key, merged);
  }

  async updateSiteConnectionState(
    siteId: string,
    state: 'CONNECTING' | 'LIVE' | 'STALE' | 'ERROR' | 'DISCONNECTED',
  ): Promise<void> {
    const site = this.sites.get(siteId);
    if (site) {
      this.sites.set(siteId, {
        ...site,
        connectionState: state,
      });
    }
  }

  async recordProviderUsage(
    householdId: string,
    category: 'DATA' | 'COMMAND' | 'WAKE' | 'STREAM' | 'AUTH',
    success: boolean,
    date?: string,
  ): Promise<void> {
    const usageDate = date ?? new Date().toISOString().substring(0, 10);
    const key = `${householdId}:${usageDate}:${category}`;
    const curr = this.providerUsage.get(key) ?? { requestCount: 0, errorCount: 0 };
    this.providerUsage.set(key, {
      requestCount: curr.requestCount + 1,
      errorCount: curr.errorCount + (success ? 0 : 1),
    });
  }

  async getProviderUsage(
    householdId: string,
    date: string,
    category: 'DATA' | 'COMMAND' | 'WAKE' | 'STREAM' | 'AUTH',
  ): Promise<{ requestCount: number; errorCount: number }> {
    const key = `${householdId}:${date}:${category}`;
    return this.providerUsage.get(key) ?? { requestCount: 0, errorCount: 0 };
  }

  async purgeOldMetricsLog(
    olderThanUtc: string,
    dryRun: boolean,
  ): Promise<{ deletedCount: number }> {
    let deleted = 0;
    for (const [siteId, list] of this.powerSamples.entries()) {
      const remaining: PersistedPowerSample[] = [];
      for (const sample of list) {
        if (sample.sampledAt < olderThanUtc) {
          deleted++;
        } else {
          remaining.push(sample);
        }
      }
      if (!dryRun) {
        this.powerSamples.set(siteId, remaining);
      }
    }
    return { deletedCount: deleted };
  }

  async purgeOldScheduledJobs(
    olderThanUtc: string,
    dryRun: boolean,
  ): Promise<{ deletedCount: number }> {
    let deleted = 0;
    for (const [jobId, job] of this.scheduledJobs.entries()) {
      if (job.finishedAt && job.finishedAt < olderThanUtc) {
        deleted++;
        if (!dryRun) {
          this.scheduledJobs.delete(jobId);
        }
      }
    }
    return { deletedCount: deleted };
  }

  async removeMember(
    householdId: string,
    callerUserId: string,
    targetUserId: string,
  ): Promise<{ success: boolean; error?: 'SELF_MODIFICATION' | 'LAST_ADMIN' | 'NOT_FOUND' }> {
    if (callerUserId === targetUserId) {
      return { success: false, error: 'SELF_MODIFICATION' };
    }
    const hhMembers = this.members.get(householdId);
    if (!hhMembers) return { success: false, error: 'NOT_FOUND' };
    const target = hhMembers.get(targetUserId);
    if (!target) return { success: false, error: 'NOT_FOUND' };

    if (target.role === 'ADMIN') {
      const adminCount = Array.from(hhMembers.values()).filter((m) => m.role === 'ADMIN').length;
      if (adminCount <= 1) {
        return { success: false, error: 'LAST_ADMIN' };
      }
    }

    hhMembers.delete(targetUserId);
    return { success: true };
  }

  async updateHousehold(
    householdId: string,
    updates: { name?: string | undefined; timezone?: string | undefined },
  ): Promise<Household | null> {
    const hh = this.households.get(householdId);
    if (!hh) return null;
    const updated: Household = {
      ...hh,
      name: updates.name ?? hh.name,
      timezone: updates.timezone ?? hh.timezone,
    };
    this.households.set(householdId, updated);
    return updated;
  }

  async updateSite(
    siteId: string,
    updates: { name?: string | undefined },
  ): Promise<EnergySite | null> {
    const site = this.sites.get(siteId);
    if (!site) return null;
    const updated: EnergySite = {
      ...site,
      name: updates.name ?? site.name,
    };
    this.sites.set(siteId, updated);
    return updated;
  }

  async recordAuditEvent(
    householdId: string,
    entry: Omit<AuditEntry, 'id' | 'createdAt'> & { createdAt?: string },
  ): Promise<AuditEntry> {
    const id = String(this.auditIdCounter++);
    const createdAt = entry.createdAt ?? new Date().toISOString();
    const fullEntry: AuditEntry = {
      id,
      action: entry.action,
      actorType: entry.actorType,
      actorUserId: entry.actorUserId,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata,
      requestId: entry.requestId,
      createdAt,
    };
    let list = this.auditLogs.get(householdId);
    if (!list) {
      list = [];
      this.auditLogs.set(householdId, list);
    }
    list.push(fullEntry);
    return fullEntry;
  }

  async listAudit(
    householdId: string,
    query: AuditQuery,
  ): Promise<{ items: readonly AuditEntry[]; nextCursor: string | null }> {
    const list = this.auditLogs.get(householdId) ?? [];
    let filtered = [...list];
    if (query.action) {
      filtered = filtered.filter((e) => e.action === query.action);
    }
    if (query.from) {
      const fromTime = Date.parse(query.from);
      filtered = filtered.filter((e) => Date.parse(e.createdAt) >= fromTime);
    }
    if (query.to) {
      const toTime = Date.parse(query.to);
      filtered = filtered.filter((e) => Date.parse(e.createdAt) <= toTime);
    }

    filtered.sort((a, b) => {
      const timeDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (timeDiff !== 0) return timeDiff;
      return Number(b.id) - Number(a.id);
    });

    if (query.cursor) {
      const idx = filtered.findIndex((e) => e.id === query.cursor);
      if (idx >= 0) {
        filtered = filtered.slice(idx + 1);
      }
    }

    const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
    const page = filtered.slice(0, limit);
    const nextCursor =
      page.length === limit && filtered.length > limit ? page[page.length - 1]!.id : null;
    return { items: page, nextCursor };
  }

  async exportHouseholdData(householdId: string): Promise<HouseholdExportResponse> {
    const hh = this.households.get(householdId);
    if (!hh) {
      return {
        status: 'READY',
        requestedAt: new Date().toISOString(),
        data: null,
      };
    }

    const members = Array.from(this.members.get(householdId)?.values() ?? []).map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      role: m.role,
      createdAt: m.createdAt,
    }));

    const sites = Array.from(this.siteHouseholdMap.entries())
      .filter(([, h]) => h === householdId)
      .map(([s]) => this.sites.get(s))
      .filter((s): s is EnergySite => s !== undefined)
      .map((s) => ({
        id: s.id,
        name: s.name,
        timezone: s.timezone,
        provider: s.provider,
        connectionState: s.connectionState,
      }));

    const tariffs = Array.from(this.tariffHouseholdMap.entries())
      .filter(([, h]) => h === householdId)
      .map(([t]) => this.tariffs.get(t))
      .filter((t): t is Tariff => t !== undefined);

    const rules: AutomationRule[] = [];
    for (const site of sites) {
      for (const [rId, rule] of this.rules.entries()) {
        if (this.ruleSiteMap.get(rId) === site.id) {
          rules.push(rule);
        }
      }
    }

    const recentAudit = (this.auditLogs.get(householdId) ?? []).slice(-100);

    return {
      status: 'READY',
      requestedAt: new Date().toISOString(),
      data: {
        household: hh,
        members,
        sites,
        tariffs,
        rules,
        recentAudit,
      },
    };
  }

  async deleteHousehold(
    householdId: string,
    confirmName: string,
  ): Promise<{ success: boolean; error?: 'NAME_MISMATCH' | 'NOT_FOUND' }> {
    const hh = this.households.get(householdId);
    if (!hh) return { success: false, error: 'NOT_FOUND' };
    if (hh.name.trim() !== confirmName.trim()) {
      return { success: false, error: 'NAME_MISMATCH' };
    }

    this.households.delete(householdId);
    this.members.delete(householdId);
    this.householdSettings.delete(householdId);
    this.auditLogs.delete(householdId);
    this.householdAutomationPaused.delete(householdId);
    this.teslaLinks.delete(householdId);

    for (const [id, inv] of this.invitations.entries()) {
      if (inv.householdId === householdId) {
        this.invitations.delete(id);
      }
    }

    for (const [tId, hid] of this.tariffHouseholdMap.entries()) {
      if (hid === householdId) {
        this.tariffs.delete(tId);
        this.tariffHouseholdMap.delete(tId);
      }
    }

    for (const [sId, hid] of this.siteHouseholdMap.entries()) {
      if (hid === householdId) {
        this.sites.delete(sId);
        this.siteHouseholdMap.delete(sId);
        this.siteProviderIds.delete(sId);
        this.siteConfigurations.delete(sId);
        for (const [rId, sid] of this.ruleSiteMap.entries()) {
          if (sid === sId) {
            this.rules.delete(rId);
            this.ruleSiteMap.delete(rId);
          }
        }
      }
    }

    return { success: true };
  }

  async exportMe(userId: string): Promise<MeExportResponse> {
    const memberships = await this.getHouseholdMemberships(userId);
    let displayName: string | null = null;
    for (const membersMap of this.members.values()) {
      const m = membersMap.get(userId);
      if (m && m.displayName) {
        displayName = m.displayName;
        break;
      }
    }

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        userId,
        displayName: displayName ?? 'User',
        locale: 'en-IE',
      },
      memberships: memberships.map((m) => ({
        householdId: m.householdId,
        name: m.name,
        role: m.role,
      })),
    };
  }

  async deleteAccount(userId: string): Promise<{ success: boolean; error?: 'LAST_ADMIN' }> {
    for (const [, membersMap] of this.members.entries()) {
      const member = membersMap.get(userId);
      if (member && member.role === 'ADMIN') {
        const admins = Array.from(membersMap.values()).filter((m) => m.role === 'ADMIN');
        if (admins.length <= 1 && membersMap.size > 1) {
          return { success: false, error: 'LAST_ADMIN' };
        }
      }
    }

    for (const membersMap of this.members.values()) {
      membersMap.delete(userId);
    }

    return { success: true };
  }

  async leaveHousehold(
    householdId: string,
    userId: string,
  ): Promise<{ success: boolean; error?: 'LAST_ADMIN' | 'NOT_FOUND' }> {
    const membersMap = this.members.get(householdId);
    if (!membersMap) return { success: false, error: 'NOT_FOUND' };
    const member = membersMap.get(userId);
    if (!member) return { success: false, error: 'NOT_FOUND' };

    if (member.role === 'ADMIN') {
      const admins = Array.from(membersMap.values()).filter((m) => m.role === 'ADMIN');
      if (admins.length <= 1) {
        return { success: false, error: 'LAST_ADMIN' };
      }
    }

    membersMap.delete(userId);
    return { success: true };
  }

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const digestBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(digestBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
