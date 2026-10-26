import type {
  AuditEntry,
  BudgetStatus,
  Role,
  TeslaLinkState,
  UpdateHouseholdSettingsRequest,
} from '@autopw3/shared';

export interface MemberRow {
  readonly userId: string;
  readonly displayName: string | null;
  readonly role: Role;
  readonly createdAt: string;
}

export interface InvitationRow {
  readonly id: string;
  readonly householdId: string;
  readonly email: string | null;
  readonly role: Role;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
  readonly revokedAt: string | null;
}

export type AuditRow = AuditEntry;

export interface HouseholdSettingsData {
  readonly staleAfterSeconds: number;
  readonly automationPaused: boolean;
  readonly controlsEnabled: boolean;
  readonly budget: BudgetStatus;
}

export interface TeslaLinkData {
  readonly state: TeslaLinkState;
  readonly scopes: readonly string[];
}

export interface UseAdminReturn {
  readonly members: readonly MemberRow[];
  readonly invitations: readonly InvitationRow[];
  readonly auditEntries: readonly AuditRow[];
  readonly settings: HouseholdSettingsData | null;
  readonly teslaLink: TeslaLinkData | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly householdName: string;
  readonly currentUserId: string | null;
  readonly refresh: () => Promise<void>;
  readonly changeMemberRole: (userId: string, newRole: Role) => Promise<boolean>;
  readonly removeMember: (userId: string) => Promise<boolean>;
  readonly createInvitation: (
    email: string | null,
    role: Role,
    expiresInDays: number,
  ) => Promise<{ link: string; token: string } | null>;
  readonly revokeInvitation: (invitationId: string) => Promise<boolean>;
  readonly updateSettings: (updates: UpdateHouseholdSettingsRequest) => Promise<boolean>;
  readonly disconnectTesla: () => Promise<boolean>;
  readonly exportHousehold: () => Promise<void>;
  readonly exportAccount: () => Promise<void>;
  readonly deleteHousehold: (confirmName: string) => Promise<boolean>;
  readonly deleteAccount: () => Promise<boolean>;
  readonly leaveHousehold: () => Promise<boolean>;
}

export type AdminTab = 'members' | 'audit' | 'settings' | 'privacy';
