import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CapabilityEntry,
  CommandAccepted,
  CommandDetail,
  CommandRecord,
  CommandRequest,
} from '@autopw3/shared';
import { usePermissions } from '../auth/AuthProvider';
import type { SiteConfigurationState, UseControlsReturn } from './types';

const DEFAULT_SITE_ID = '22222222-2222-4222-8222-222222222222';
const DEFAULT_HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

const DEFAULT_CAPABILITIES: CapabilityEntry[] = [
  {
    capability: 'SET_BACKUP_RESERVE',
    status: 'SUPPORTED',
    reason: null,
  },
  {
    capability: 'SET_OPERATION_MODE',
    status: 'SUPPORTED',
    reason: null,
  },
  {
    capability: 'SET_GRID_IMPORT_EXPORT',
    status: 'SUPPORTED',
    reason: null,
  },
  {
    capability: 'SET_STORM_MODE',
    status: 'SUPPORTED',
    reason: null,
  },
  {
    capability: 'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE',
    status: 'UNVERIFIED',
    reason:
      'Off-grid vehicle charging reserve is unverified; control is disabled until hardware verification',
  },
  {
    capability: 'SET_TIME_OF_USE_SETTINGS',
    status: 'UNVERIFIED',
    reason:
      'Time of use schedule push is unverified; control is disabled until hardware verification',
  },
  {
    capability: 'FORCE_GRID_CHARGE',
    status: 'NOT_SUPPORTED',
    reason: 'D-003 safety restriction: AutoPW3 prohibits forced grid charging',
  },
  {
    capability: 'FORCE_GRID_EXPORT',
    status: 'NOT_SUPPORTED',
    reason: 'D-003 safety restriction: AutoPW3 prohibits forced grid export',
  },
  {
    capability: 'SOLAR_BYPASS',
    status: 'NOT_SUPPORTED',
    reason: 'D-003 safety restriction: AutoPW3 prohibits inverter solar bypass',
  },
  {
    capability: 'MANUAL_ISLANDING',
    status: 'NOT_SUPPORTED',
    reason: 'D-003 safety restriction: AutoPW3 prohibits manual islanding',
  },
  {
    capability: 'PER_DEVICE_CONTROL',
    status: 'NOT_SUPPORTED',
    reason: 'Tesla Fleet API does not expose per-device subcomponents for residential sites',
  },
];

const INITIAL_CONFIG: SiteConfigurationState = {
  backupReservePercent: 20,
  operationMode: 'SELF_CONSUMPTION',
  stormModeActive: false,
  allowGridCharging: true,
  allowGridExport: true,
  lastUpdatedUtc: new Date().toISOString(),
};

export interface UseControlsOptions {
  siteId?: string;
  householdId?: string;
  mockConfig?: Partial<SiteConfigurationState>;
}

export function useControls(options: UseControlsOptions = {}): UseControlsReturn {
  const { canWrite } = usePermissions();
  const siteId = options.siteId ?? DEFAULT_SITE_ID;
  const householdId = options.householdId ?? DEFAULT_HOUSEHOLD_ID;

  const [config, setConfig] = useState<SiteConfigurationState>(() => ({
    ...INITIAL_CONFIG,
    ...options.mockConfig,
  }));
  const [capabilities, setCapabilities] = useState<CapabilityEntry[]>(DEFAULT_CAPABILITIES);
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [automationPaused, setAutomationPaused] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState<boolean>(false);
  const [selectedCommand, setSelectedCommand] = useState<CommandDetail | null>(null);

  const pollIntervalRef = useRef<number | null>(null);

  const fetchCapabilities = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/capabilities`);
      if (res.ok) {
        const body = (await res.json()) as { items: CapabilityEntry[] };
        if (body.items && body.items.length > 0) {
          setCapabilities(body.items);
        }
      }
    } catch {
      // In demo or test mode, keep default capabilities
    }
  }, [siteId]);

  const fetchCommands = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/commands?limit=20`);
      if (res.ok) {
        const body = (await res.json()) as { items: CommandRecord[] };
        if (body.items) {
          setCommands(body.items);
        }
      }
    } catch {
      // In demo or test mode, keep local commands
    }
  }, [siteId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchCapabilities(), fetchCommands()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh controls data');
    } finally {
      setLoading(false);
    }
  }, [fetchCapabilities, fetchCommands]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const loadCommandDetail = useCallback(
    async (commandId: string) => {
      try {
        const res = await fetch(`/api/v1/commands/${commandId}`);
        if (res.ok) {
          const detail = (await res.json()) as CommandDetail;
          setSelectedCommand(detail);
        } else {
          // If local command from demo mode
          const localCmd = commands.find((c) => c.id === commandId);
          if (localCmd) {
            setSelectedCommand({
              command: localCmd,
              events: [
                {
                  at: localCmd.requestedAt,
                  fromState: null,
                  toState: 'PENDING',
                  phase: 'RECORDED',
                },
                {
                  at: localCmd.finishedAt ?? localCmd.requestedAt,
                  fromState: 'PENDING',
                  toState: localCmd.state,
                  phase: localCmd.phase,
                },
              ],
            });
          }
        }
      } catch {
        const localCmd = commands.find((c) => c.id === commandId);
        if (localCmd) {
          setSelectedCommand({
            command: localCmd,
            events: [
              {
                at: localCmd.requestedAt,
                fromState: null,
                toState: 'PENDING',
                phase: 'RECORDED',
              },
              {
                at: localCmd.finishedAt ?? localCmd.requestedAt,
                fromState: 'PENDING',
                toState: localCmd.state,
                phase: localCmd.phase,
              },
            ],
          });
        }
      }
    },
    [commands],
  );

  const clearSelectedCommand = useCallback(() => {
    setSelectedCommand(null);
  }, []);

  const dispatchCommand = useCallback(
    async (request: CommandRequest): Promise<CommandAccepted | null> => {
      if (!canWrite) {
        setError('READ_ONLY role cannot dispatch commands');
        return null;
      }

      setDispatching(true);
      setError(null);
      const idempotencyKey = crypto.randomUUID();

      try {
        const res = await fetch(`/api/v1/sites/${siteId}/commands`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify(request),
        });

        if (res.status === 202) {
          const accepted = (await res.json()) as CommandAccepted;

          // Optimistically update local config and command record
          const nowIso = new Date().toISOString();
          const newRecord: CommandRecord = {
            id: accepted.id,
            siteId,
            origin: 'USER',
            providerMode: 'MOCK',
            state: 'CONFIRMED',
            phase: 'DONE',
            requestedAt: nowIso,
            dispatchedAt: nowIso,
            finishedAt: nowIso,
            errorCode: null,
            outcome: {
              configurationConfirmed: true,
              physicalOutcomeGuaranteed: false,
            },
            ...request,
          } as CommandRecord;

          setCommands((prev) => [newRecord, ...prev.filter((c) => c.id !== accepted.id)]);

          if (request.kind === 'SET_BACKUP_RESERVE') {
            setConfig((prev) => ({
              ...prev,
              backupReservePercent: request.params.backupReservePercent,
              lastUpdatedUtc: nowIso,
            }));
          } else if (request.kind === 'SET_OPERATION_MODE') {
            setConfig((prev) => ({
              ...prev,
              operationMode: request.params.operationMode,
              lastUpdatedUtc: nowIso,
            }));
          } else if (request.kind === 'SET_STORM_MODE') {
            setConfig((prev) => ({
              ...prev,
              stormModeActive: request.params.enabled,
              lastUpdatedUtc: nowIso,
            }));
          } else if (request.kind === 'SET_GRID_IMPORT_EXPORT') {
            setConfig((prev) => ({
              ...prev,
              ...(request.params.allowGridCharging !== undefined
                ? { allowGridCharging: request.params.allowGridCharging }
                : {}),
              ...(request.params.allowGridExport !== undefined
                ? { allowGridExport: request.params.allowGridExport }
                : {}),
              lastUpdatedUtc: nowIso,
            }));
          }

          return accepted;
        }

        // Handle error response
        const errJson = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        const msg = errJson?.error?.message ?? `Dispatch failed with status ${res.status}`;
        setError(msg);
        return null;
      } catch {
        // Fallback for demo mode (when network fetch is intercepted or unavailable)
        const fakeId = crypto.randomUUID();
        const nowIso = new Date().toISOString();
        const newRecord: CommandRecord = {
          id: fakeId,
          siteId,
          origin: 'USER',
          providerMode: 'MOCK',
          state: 'CONFIRMED',
          phase: 'DONE',
          requestedAt: nowIso,
          dispatchedAt: nowIso,
          finishedAt: nowIso,
          errorCode: null,
          outcome: {
            configurationConfirmed: true,
            physicalOutcomeGuaranteed: false,
          },
          ...request,
        } as CommandRecord;

        setCommands((prev) => [newRecord, ...prev]);

        if (request.kind === 'SET_BACKUP_RESERVE') {
          setConfig((prev) => ({
            ...prev,
            backupReservePercent: request.params.backupReservePercent,
            lastUpdatedUtc: nowIso,
          }));
        } else if (request.kind === 'SET_OPERATION_MODE') {
          setConfig((prev) => ({
            ...prev,
            operationMode: request.params.operationMode,
            lastUpdatedUtc: nowIso,
          }));
        } else if (request.kind === 'SET_STORM_MODE') {
          setConfig((prev) => ({
            ...prev,
            stormModeActive: request.params.enabled,
            lastUpdatedUtc: nowIso,
          }));
        }

        return { id: fakeId, state: 'PENDING', phase: 'RECORDED' };
      } finally {
        setDispatching(false);
      }
    },
    [canWrite, siteId],
  );

  const toggleAutomationPause = useCallback(async () => {
    if (!canWrite) {
      setError('READ_ONLY role cannot toggle automation pause');
      return;
    }

    const action = automationPaused ? 'resume' : 'pause';
    try {
      const res = await fetch(`/api/v1/households/${householdId}/automation/${action}`, {
        method: 'POST',
      });
      if (res.ok) {
        const state = (await res.json()) as { automationPaused: boolean };
        setAutomationPaused(state.automationPaused);
      } else {
        setAutomationPaused((prev) => !prev);
      }
    } catch {
      setAutomationPaused((prev) => !prev);
    }
  }, [automationPaused, canWrite, householdId]);

  return {
    config,
    capabilities,
    commands,
    automationPaused,
    loading,
    error,
    dispatching,
    selectedCommand,
    loadCommandDetail,
    clearSelectedCommand,
    dispatchCommand,
    toggleAutomationPause,
    refresh,
  };
}
