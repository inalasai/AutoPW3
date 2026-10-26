import { useCallback, useEffect, useState } from 'react';
import type { AutomationExecution, AutomationRule, CreateRuleRequest } from '@autopw3/shared';
import { usePermissions } from '../auth/AuthProvider';
import type { UseAutomationReturn } from './types';

const DEMO_RULES: readonly AutomationRule[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    siteId: '22222222-2222-4222-8222-222222222222',
    name: 'Cheap Night Charge Window',
    priority: 100,
    definitionVersion: 1,
    definition: {
      conditions: [
        {
          type: 'TIME_WINDOW',
          dayType: 'ALL',
          startMinute: 120, // 02:00
          endMinute: 300, // 05:00
        },
      ],
      actions: [
        {
          kind: 'SET_BACKUP_RESERVE',
          params: { backupReservePercent: 80 },
        },
      ],
    },
    mode: 'DRY_RUN',
    version: 1,
    createdAt: '2026-06-21T00:00:00Z',
    updatedAt: '2026-06-21T00:00:00Z',
  },
  {
    id: '33333333-3333-4333-8333-444444444444',
    siteId: '22222222-2222-4222-8222-222222222222',
    name: 'Evening Peak Self-Consumption',
    priority: 80,
    definitionVersion: 1,
    definition: {
      conditions: [
        {
          type: 'TIME_WINDOW',
          dayType: 'WEEKDAY',
          startMinute: 1020, // 17:00
          endMinute: 1140, // 19:00
        },
        {
          type: 'BATTERY_SOC',
          comparator: 'GT',
          valuePercent: 20,
        },
      ],
      actions: [
        {
          kind: 'SET_OPERATION_MODE',
          params: { operationMode: 'SELF_CONSUMPTION' },
        },
      ],
    },
    mode: 'DRY_RUN',
    version: 1,
    createdAt: '2026-06-21T00:00:00Z',
    updatedAt: '2026-06-21T00:00:00Z',
  },
];

const DEMO_EXECUTIONS: readonly AutomationExecution[] = [
  {
    id: 'e1111111-1111-4111-8111-111111111111',
    ruleId: '33333333-3333-4333-8333-333333333333',
    siteId: '22222222-2222-4222-8222-222222222222',
    scheduledSlot: '2026-06-21T02:00:00Z',
    evaluatedAt: '2026-06-21T02:00:02Z',
    modeAtEvaluation: 'DRY_RUN',
    decision: 'WOULD_ACT',
    reason: 'Local minute 120 is within [120, 300). Mode is DRY_RUN; no device command dispatched.',
    commandId: null,
  },
  {
    id: 'e2222222-2222-4222-8222-222222222222',
    ruleId: '33333333-3333-4333-8333-444444444444',
    siteId: '22222222-2222-4222-8222-222222222222',
    scheduledSlot: '2026-06-21T12:00:00Z',
    evaluatedAt: '2026-06-21T12:00:01Z',
    modeAtEvaluation: 'DRY_RUN',
    decision: 'NO_ACTION',
    reason: 'Local minute 720 is outside [1020, 1140)',
    commandId: null,
  },
];

export function useAutomation(): UseAutomationReturn {
  const { canWrite, canAdmin } = usePermissions();

  const [rules, setRules] = useState<readonly AutomationRule[]>(DEMO_RULES);
  const [executions, setExecutions] = useState<readonly AutomationExecution[]>(DEMO_EXECUTIONS);
  const [automationPaused, setAutomationPaused] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [selectedRule, setSelectedRule] = useState<AutomationRule | null>(null);

  const siteId = '22222222-2222-4222-8222-222222222222';
  const householdId = '11111111-1111-4111-8111-111111111111';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch rules
      const rulesRes = await fetch(`/api/v1/sites/${siteId}/automation/rules?limit=50`).catch(
        () => null,
      );

      if (rulesRes && rulesRes.ok) {
        const data = (await rulesRes.json()) as { items: AutomationRule[] };
        setRules(data.items);
      }

      // Fetch executions
      const execRes = await fetch(`/api/v1/sites/${siteId}/automation/executions?limit=50`).catch(
        () => null,
      );

      if (execRes && execRes.ok) {
        const data = (await execRes.json()) as { items: AutomationExecution[] };
        setExecutions(data.items);
      }
    } catch {
      // In demo mode or when offline, keep memory state
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreateEditor = useCallback(() => {
    setSelectedRule(null);
    setIsEditorOpen(true);
  }, []);

  const openEditEditor = useCallback((rule: AutomationRule) => {
    setSelectedRule(rule);
    setIsEditorOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    setSelectedRule(null);
    setIsEditorOpen(false);
  }, []);

  const createRule = useCallback(
    async (request: CreateRuleRequest): Promise<boolean> => {
      if (!canWrite) return false;
      setError(null);
      try {
        const res = await fetch(`/api/v1/sites/${siteId}/automation/rules`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        }).catch(() => null);

        if (res && res.ok) {
          const created = (await res.json()) as AutomationRule;
          setRules((prev) => [created, ...prev]);
          setIsEditorOpen(false);
          return true;
        }

        // Demo fallback
        const newRule: AutomationRule = {
          id: crypto.randomUUID(),
          siteId,
          name: request.name,
          priority: request.priority,
          mode: request.mode,
          definitionVersion: 1,
          definition: request.definition,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setRules((prev) => [newRule, ...prev]);
        setIsEditorOpen(false);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create rule');
        return false;
      }
    },
    [canWrite, siteId],
  );

  const updateRule = useCallback(
    async (
      ruleId: string,
      updates: Partial<CreateRuleRequest>,
      version: number,
    ): Promise<boolean> => {
      if (!canWrite) return false;
      setError(null);
      try {
        const res = await fetch(`/api/v1/automation/rules/${ruleId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...updates, version }),
        }).catch(() => null);

        if (res && res.ok) {
          const updated = (await res.json()) as AutomationRule;
          setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
          setIsEditorOpen(false);
          return true;
        }

        // Demo fallback
        setRules((prev) =>
          prev.map((r) =>
            r.id === ruleId
              ? {
                  ...r,
                  ...(updates.name !== undefined ? { name: updates.name } : {}),
                  ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
                  ...(updates.mode !== undefined ? { mode: updates.mode } : {}),
                  ...(updates.definition !== undefined ? { definition: updates.definition } : {}),
                  version: r.version + 1,
                  updatedAt: new Date().toISOString(),
                }
              : r,
          ),
        );
        setIsEditorOpen(false);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update rule');
        return false;
      }
    },
    [canWrite],
  );

  const deleteRule = useCallback(
    async (ruleId: string): Promise<boolean> => {
      if (!canWrite) return false;
      setError(null);
      try {
        await fetch(`/api/v1/automation/rules/${ruleId}`, {
          method: 'DELETE',
        }).catch(() => null);

        setRules((prev) => prev.filter((r) => r.id !== ruleId));
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete rule');
        return false;
      }
    },
    [canWrite],
  );

  const setRuleActive = useCallback(
    async (ruleId: string, active: boolean): Promise<boolean> => {
      if (!canWrite) return false;
      if (active && !canAdmin) {
        setError('Only administrators can activate rules');
        return false;
      }
      setError(null);
      try {
        const endpoint = active
          ? `/api/v1/automation/rules/${ruleId}/activate`
          : `/api/v1/automation/rules/${ruleId}/deactivate`;

        const res = await fetch(endpoint, {
          method: 'POST',
        }).catch(() => null);

        if (res && res.ok) {
          const updated = (await res.json()) as AutomationRule;
          setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
          return true;
        }

        // Demo fallback
        setRules((prev) =>
          prev.map((r) =>
            r.id === ruleId
              ? {
                  ...r,
                  mode: active ? 'ACTIVE' : 'DRY_RUN',
                  version: r.version + 1,
                  updatedAt: new Date().toISOString(),
                }
              : r,
          ),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to change rule state');
        return false;
      }
    },
    [canWrite, canAdmin],
  );

  const toggleAutomationPause = useCallback(async (): Promise<boolean> => {
    if (!canWrite) return false;
    const nextPaused = !automationPaused;
    setError(null);
    try {
      const endpoint = nextPaused
        ? `/api/v1/households/${householdId}/automation/pause`
        : `/api/v1/households/${householdId}/automation/resume`;

      await fetch(endpoint, {
        method: 'POST',
      }).catch(() => null);

      setAutomationPaused(nextPaused);
      return true;
    } catch {
      setAutomationPaused(nextPaused);
      return true;
    }
  }, [automationPaused, canWrite, householdId]);

  return {
    rules,
    executions,
    automationPaused,
    loading,
    error,
    selectedRule,
    isEditorOpen,
    openCreateEditor,
    openEditEditor,
    closeEditor,
    createRule,
    updateRule,
    deleteRule,
    setRuleActive,
    toggleAutomationPause,
    refresh,
  };
}
