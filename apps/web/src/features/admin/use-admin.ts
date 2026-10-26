import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry, Role, UpdateHouseholdSettingsRequest } from '@autopw3/shared';
import { useOptionalAuth } from '../auth/AuthProvider';
import type {
  HouseholdSettingsData,
  InvitationRow,
  MemberRow,
  TeslaLinkData,
  UseAdminReturn,
} from './types';

const DEMO_MEMBERS: readonly MemberRow[] = [
  {
    userId: '44444444-4444-4444-8444-444444444444',
    displayName: 'Alice Admin (You)',
    role: 'ADMIN',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    userId: '55555555-5555-4555-8555-555555555555',
    displayName: 'Bob Member',
    role: 'READ_WRITE',
    createdAt: '2026-01-02T10:00:00Z',
  },
  {
    userId: '66666666-6666-4666-8666-666666666666',
    displayName: 'Charlie Viewer',
    role: 'READ_ONLY',
    createdAt: '2026-01-03T09:15:00Z',
  },
];

const DEMO_INVITATIONS: readonly InvitationRow[] = [
  {
    id: 'invitation-1111-1111-1111-111111111111',
    householdId: '11111111-1111-4111-8111-111111111111',
    email: 'tenant@example.com',
    role: 'READ_ONLY',
    expiresAt: '2026-07-01T00:00:00Z',
    createdAt: '2026-06-24T00:00:00Z',
    acceptedAt: null,
    revokedAt: null,
  },
];

const DEMO_AUDIT_LOGS: readonly AuditEntry[] = [
  {
    id: '4',
    action: 'rule.mode_changed',
    actorType: 'USER',
    actorUserId: '44444444-4444-4444-8444-444444444444',
    targetType: 'rule',
    targetId: '33333333-3333-4333-8333-333333333333',
    metadata: { oldMode: 'DISABLED', newMode: 'DRY_RUN' },
    requestId: 'req-audit-4',
    createdAt: '2026-06-25T14:30:00Z',
  },
  {
    id: '3',
    action: 'member.added',
    actorType: 'USER',
    actorUserId: '44444444-4444-4444-8444-444444444444',
    targetType: 'user',
    targetId: '66666666-6666-4666-8666-666666666666',
    metadata: { role: 'READ_ONLY' },
    requestId: 'req-audit-3',
    createdAt: '2026-06-24T09:15:00Z',
  },
  {
    id: '2',
    action: 'member.added',
    actorType: 'USER',
    actorUserId: '44444444-4444-4444-8444-444444444444',
    targetType: 'user',
    targetId: '55555555-5555-4555-8555-555555555555',
    metadata: { role: 'READ_WRITE' },
    requestId: 'req-audit-2',
    createdAt: '2026-06-23T10:00:00Z',
  },
  {
    id: '1',
    action: 'bootstrap.completed',
    actorType: 'SYSTEM',
    actorUserId: null,
    targetType: 'household',
    targetId: '11111111-1111-4111-8111-111111111111',
    metadata: { initialSiteId: '22222222-2222-4222-8222-222222222222' },
    requestId: 'req-audit-1',
    createdAt: '2026-06-20T00:00:00Z',
  },
];

const DEMO_SETTINGS: HouseholdSettingsData = {
  staleAfterSeconds: 300,
  automationPaused: false,
  controlsEnabled: true,
  budget: {
    spentUsd: '0.00',
    capUsd: '9.00',
    state: 'OK',
  },
};

const DEMO_TESLA_LINK: TeslaLinkData = {
  state: 'ACTIVE',
  scopes: ['energy_device_data', 'energy_cmds'],
};

function downloadBlob(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function useAdmin(): UseAdminReturn {
  const auth = useOptionalAuth();

  const [members, setMembers] = useState<readonly MemberRow[]>(DEMO_MEMBERS);
  const [invitations, setInvitations] = useState<readonly InvitationRow[]>(DEMO_INVITATIONS);
  const [auditEntries, setAuditEntries] = useState<readonly AuditEntry[]>(DEMO_AUDIT_LOGS);
  const [settings, setSettings] = useState<HouseholdSettingsData | null>(DEMO_SETTINGS);
  const [teslaLink, setTeslaLink] = useState<TeslaLinkData | null>(DEMO_TESLA_LINK);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const householdId =
    auth?.state.status === 'authorised'
      ? auth.state.membership.householdId
      : '11111111-1111-4111-8111-111111111111';
  const householdName =
    auth?.state.status === 'authorised' ? auth.state.membership.name : 'Demo Household';
  const currentUserId =
    auth?.state.status === 'authorised'
      ? auth.state.user.id
      : '44444444-4444-4444-8444-444444444444';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Settings
      const settingsRes = await fetch(`/api/v1/households/${householdId}/settings`).catch(
        () => null,
      );
      if (settingsRes && settingsRes.ok) {
        const data = (await settingsRes.json()) as HouseholdSettingsData;
        setSettings(data);
      }

      // 2. Tesla link
      const teslaRes = await fetch(`/api/v1/households/${householdId}/provider/tesla`).catch(
        () => null,
      );
      if (teslaRes && teslaRes.ok) {
        const data = (await teslaRes.json()) as TeslaLinkData;
        setTeslaLink(data);
      }

      // 3. Members (requires ADMIN in live)
      const membersRes = await fetch(`/api/v1/households/${householdId}/members?limit=50`).catch(
        () => null,
      );
      if (membersRes && membersRes.ok) {
        const data = (await membersRes.json()) as { items: MemberRow[] };
        setMembers(data.items);
      }

      // 4. Invitations
      const invRes = await fetch(`/api/v1/households/${householdId}/invitations?limit=50`).catch(
        () => null,
      );
      if (invRes && invRes.ok) {
        const data = (await invRes.json()) as { items: InvitationRow[] };
        setInvitations(data.items);
      }

      // 5. Audit Log
      const auditRes = await fetch(`/api/v1/households/${householdId}/audit?limit=50`).catch(
        () => null,
      );
      if (auditRes && auditRes.ok) {
        const data = (await auditRes.json()) as { items: AuditEntry[] };
        setAuditEntries(data.items);
      }
    } catch {
      // fallback in demo mode
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const changeMemberRole = useCallback(
    async (userId: string, newRole: Role): Promise<boolean> => {
      setError(null);
      if (userId === currentUserId && newRole !== 'ADMIN') {
        setError('Cannot demote your own administrator role.');
        return false;
      }
      try {
        const res = await fetch(`/api/v1/households/${householdId}/members/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        }).catch(() => null);

        if (res) {
          if (!res.ok) {
            const errData = (await res.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            setError(errData?.error?.message ?? 'Failed to update member role');
            return false;
          }
          const updated = (await res.json()) as MemberRow;
          setMembers((prev) => prev.map((m) => (m.userId === userId ? updated : m)));
          return true;
        }

        // Demo fallback
        setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m)));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to change role');
        return false;
      }
    },
    [householdId, currentUserId],
  );

  const removeMember = useCallback(
    async (userId: string): Promise<boolean> => {
      setError(null);
      if (userId === currentUserId) {
        setError('Cannot remove yourself. Use "Leave Household" instead.');
        return false;
      }
      try {
        const res = await fetch(`/api/v1/households/${householdId}/members/${userId}`, {
          method: 'DELETE',
        }).catch(() => null);

        if (res && !res.ok) {
          const errData = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setError(errData?.error?.message ?? 'Failed to remove member');
          return false;
        }

        setMembers((prev) => prev.filter((m) => m.userId !== userId));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to remove member');
        return false;
      }
    },
    [householdId, currentUserId],
  );

  const createInvitation = useCallback(
    async (
      email: string | null,
      role: Role,
      expiresInDays: number,
    ): Promise<{ link: string; token: string } | null> => {
      setError(null);
      try {
        const res = await fetch(`/api/v1/households/${householdId}/invitations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `inv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          },
          body: JSON.stringify({ email: email || undefined, role, expiresInDays }),
        }).catch(() => null);

        if (res && res.ok) {
          const data = (await res.json()) as {
            invitation: InvitationRow;
            token: string;
            link: string;
          };
          setInvitations((prev) => [data.invitation, ...prev]);
          return { link: data.link, token: data.token };
        }

        // Demo fallback
        const demoToken = 'demo-invitation-token-0123456789abcdef';
        const demoLink = `https://autopw3.local/invite?token=${demoToken}`;
        const newInv: InvitationRow = {
          id: crypto.randomUUID(),
          householdId,
          email,
          role,
          expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          acceptedAt: null,
          revokedAt: null,
        };
        setInvitations((prev) => [newInv, ...prev]);
        return { link: demoLink, token: demoToken };
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create invitation');
        return null;
      }
    },
    [householdId],
  );

  const revokeInvitation = useCallback(
    async (invitationId: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch(`/api/v1/households/${householdId}/invitations/${invitationId}`, {
          method: 'DELETE',
        }).catch(() => null);

        if (res && !res.ok) {
          setError('Failed to revoke invitation');
          return false;
        }

        setInvitations((prev) =>
          prev.map((i) =>
            i.id === invitationId ? { ...i, revokedAt: new Date().toISOString() } : i,
          ),
        );
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to revoke invitation');
        return false;
      }
    },
    [householdId],
  );

  const updateSettings = useCallback(
    async (updates: UpdateHouseholdSettingsRequest): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch(`/api/v1/households/${householdId}/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }).catch(() => null);

        if (res) {
          if (!res.ok) {
            const errData = (await res.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            setError(errData?.error?.message ?? 'Failed to update settings');
            return false;
          }
          const updated = (await res.json()) as HouseholdSettingsData;
          setSettings(updated);
          return true;
        }

        // Demo fallback
        if (settings) {
          setSettings({
            ...settings,
            staleAfterSeconds: updates.staleAfterSeconds ?? settings.staleAfterSeconds,
            controlsEnabled: updates.controlsEnabled ?? settings.controlsEnabled,
            budget: {
              ...settings.budget,
              capUsd: updates.monthlySpendCapUsd ?? settings.budget.capUsd,
            },
          });
        }
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update settings');
        return false;
      }
    },
    [householdId, settings],
  );

  const disconnectTesla = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/households/${householdId}/provider/tesla/disconnect`, {
        method: 'POST',
      }).catch(() => null);

      if (res && !res.ok) {
        setError('Failed to disconnect Tesla account');
        return false;
      }

      setTeslaLink({ state: 'NOT_CONNECTED', scopes: [] });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect Tesla');
      return false;
    }
  }, [householdId]);

  const exportHousehold = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/households/${householdId}/export`, {
        method: 'POST',
      }).catch(() => null);

      if (res && res.ok) {
        const data = (await res.json()) as { data: unknown };
        downloadBlob(
          `autopw3-household-export-${new Date().toISOString().substring(0, 10)}.json`,
          JSON.stringify(data.data, null, 2),
        );
        return;
      }

      // Demo fallback export
      const demoExport = {
        exportedAt: new Date().toISOString(),
        household: { id: householdId, name: householdName },
        members,
        settings,
        auditCount: auditEntries.length,
      };
      downloadBlob(
        `autopw3-household-export-${new Date().toISOString().substring(0, 10)}.json`,
        JSON.stringify(demoExport, null, 2),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export household data');
    }
  }, [householdId, householdName, members, settings, auditEntries]);

  const exportAccount = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch('/api/v1/me/export', { method: 'POST' }).catch(() => null);
      if (res && res.ok) {
        const data = (await res.json()) as unknown;
        downloadBlob(
          `autopw3-account-export-${new Date().toISOString().substring(0, 10)}.json`,
          JSON.stringify(data, null, 2),
        );
        return;
      }

      // Demo fallback
      const demoAccountExport = {
        exportedAt: new Date().toISOString(),
        profile: { userId: currentUserId, displayName: 'Alice Admin', locale: 'en-IE' },
        memberships: [{ householdId, name: householdName, role: 'ADMIN' }],
      };
      downloadBlob(
        `autopw3-account-export-${new Date().toISOString().substring(0, 10)}.json`,
        JSON.stringify(demoAccountExport, null, 2),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export account data');
    }
  }, [currentUserId, householdId, householdName]);

  const deleteHousehold = useCallback(
    async (confirmName: string): Promise<boolean> => {
      setError(null);
      if (confirmName.trim() !== householdName.trim()) {
        setError('Household name does not match confirmation.');
        return false;
      }
      try {
        const res = await fetch(`/api/v1/households/${householdId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmName }),
        }).catch(() => null);

        if (res && !res.ok) {
          const errData = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setError(errData?.error?.message ?? 'Failed to delete household');
          return false;
        }

        // Redirect to /live or show deleted state
        window.location.href = '/live';
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete household');
        return false;
      }
    },
    [householdId, householdName],
  );

  const deleteAccount = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch('/api/v1/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      }).catch(() => null);

      if (res && !res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(errData?.error?.message ?? 'Failed to delete account');
        return false;
      }

      if (auth) {
        await auth.signOut();
      }
      window.location.href = '/sign-in';
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete account');
      return false;
    }
  }, [auth]);

  const leaveHousehold = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/me/memberships/${householdId}`, {
        method: 'DELETE',
      }).catch(() => null);

      if (res && !res.ok) {
        const errData = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(errData?.error?.message ?? 'Failed to leave household');
        return false;
      }

      window.location.href = '/live';
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to leave household');
      return false;
    }
  }, [householdId]);

  return {
    members,
    invitations,
    auditEntries,
    settings,
    teslaLink,
    loading,
    error,
    householdName,
    currentUserId,
    refresh,
    changeMemberRole,
    removeMember,
    createInvitation,
    revokeInvitation,
    updateSettings,
    disconnectTesla,
    exportHousehold,
    exportAccount,
    deleteHousehold,
    deleteAccount,
    leaveHousehold,
  };
}
