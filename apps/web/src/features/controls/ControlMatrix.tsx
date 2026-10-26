import { useState } from 'react';
import type { OperationMode } from '@autopw3/shared';
import {
  Button,
  ConfirmDialog,
  DataTable,
  ErrorBanner,
  GlassCard,
  Modal,
  PageHeader,
  Switch,
} from '../../components/ui';
import { BoltIcon } from '../../components/ui/icons';
import { ReadOnlyNotice, WriteButton } from '../auth/permissions';
import { usePermissions } from '../auth/AuthProvider';
import { useDocumentTitle } from '../../app/pages/Page';
import { useControls } from './use-controls';

const OPERATION_MODE_LABELS: Record<OperationMode, string> = {
  SELF_CONSUMPTION: 'Self-Consumption (Powerwall powers home)',
  AUTONOMOUS: 'Autonomous / Time-of-Use (Optimise for energy rates)',
};

export function ControlMatrix() {
  useDocumentTitle('Controls');
  const { canWrite } = usePermissions();
  const {
    config,
    capabilities,
    commands,
    automationPaused,
    error,
    dispatching,
    selectedCommand,
    loadCommandDetail,
    clearSelectedCommand,
    dispatchCommand,
    toggleAutomationPause,
  } = useControls();

  // Local form state for pending changes
  const [targetReserve, setTargetReserve] = useState<number>(config.backupReservePercent);
  const [targetMode, setTargetMode] = useState<OperationMode>(config.operationMode);
  const [targetStormMode, setTargetStormMode] = useState<boolean>(config.stormModeActive);

  // Dialog states
  const [pendingConfirmAction, setPendingConfirmAction] = useState<
    'reserve' | 'mode' | 'storm' | 'pause' | null
  >(null);

  const handleConfirmAction = async () => {
    if (!pendingConfirmAction) return;

    if (pendingConfirmAction === 'reserve') {
      await dispatchCommand({
        kind: 'SET_BACKUP_RESERVE',
        params: { backupReservePercent: targetReserve },
      });
    } else if (pendingConfirmAction === 'mode') {
      await dispatchCommand({
        kind: 'SET_OPERATION_MODE',
        params: { operationMode: targetMode },
      });
    } else if (pendingConfirmAction === 'storm') {
      await dispatchCommand({
        kind: 'SET_STORM_MODE',
        params: { enabled: targetStormMode },
      });
    } else if (pendingConfirmAction === 'pause') {
      await toggleAutomationPause();
    }

    setPendingConfirmAction(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Controls"
        description="Configuration changes for supported Powerwall sites. Commands undergo read-back reconciliation; physical outcomes are not guaranteed."
        actions={
          <div className="flex items-center gap-3">
            <div
              data-testid="automation-pause-status"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                automationPaused
                  ? 'border border-amber-500/30 bg-amber-500/10 text-amber-300'
                  : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  automationPaused ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                }`}
              />
              {automationPaused ? 'AUTOMATION PAUSED' : 'AUTOMATION ACTIVE'}
            </div>
            <WriteButton
              variant={automationPaused ? 'primary' : 'danger'}
              size="sm"
              onClick={() => setPendingConfirmAction('pause')}
            >
              {automationPaused ? 'Resume Automation' : 'Emergency Pause'}
            </WriteButton>
          </div>
        }
      />

      <ReadOnlyNotice what="send commands" />

      {error && <ErrorBanner tone="error" title="Command Operation Error" message={error} />}

      {/* Safety Notice per D-015 / D-003 */}
      <div
        data-testid="safety-disclaimer"
        className="rounded-card border border-amber-500/20 bg-amber-950/20 p-4 text-xs text-amber-200/90 leading-relaxed shadow-sm"
      >
        <p className="font-semibold text-amber-100 mb-1 flex items-center gap-1.5">
          <BoltIcon className="h-4 w-4 text-amber-400" />
          Safety Notice: Configuration Confirmed ≠ Physical Outcome Guaranteed
        </p>
        <p>
          State <span className="font-mono font-semibold">CONFIRMED</span> proves that the Tesla
          fleet API accepted the request and reported the new setting upon read-back reconciliation.
          Local Powerwall battery management (BMS), thermal throttles, grid frequency regulations,
          and hardware interlocks strictly govern real-time energy flow (
          <span className="font-mono">physicalOutcomeGuaranteed: false</span>).
        </p>
      </div>

      {/* Active Configuration Summary */}
      <GlassCard title="Active Powerwall Configuration">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-control border border-field-border bg-space-900/40 p-4">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              Backup Reserve
            </span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono text-ink">
                {config.backupReservePercent}%
              </span>
              <span className="text-xs text-ink-muted">of capacity</span>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-space-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${config.backupReservePercent}%` }}
              />
            </div>
          </div>

          <div className="rounded-control border border-field-border bg-space-900/40 p-4">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              Operational Mode
            </span>
            <div className="mt-2 text-base font-semibold text-ink capitalize">
              {config.operationMode.replace('_', ' ')}
            </div>
            <p className="mt-1 text-xs text-ink-muted truncate">
              {OPERATION_MODE_LABELS[config.operationMode]}
            </p>
          </div>

          <div className="rounded-control border border-field-border bg-space-900/40 p-4">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              Storm Watch Mode
            </span>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  config.stormModeActive ? 'bg-amber-400 animate-pulse' : 'bg-ink-muted/40'
                }`}
              />
              <span className="text-base font-semibold text-ink">
                {config.stormModeActive ? 'Active' : 'Standby'}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {config.stormModeActive
                ? 'Powerwall maximizes reserve for severe weather'
                : 'Storm watch trigger is idle'}
            </p>
          </div>

          <div className="rounded-control border border-field-border bg-space-900/40 p-4">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              Last Reconciled
            </span>
            <div className="mt-2 text-sm font-mono text-ink truncate">
              {config.lastUpdatedUtc
                ? new Date(config.lastUpdatedUtc).toLocaleTimeString()
                : 'Not available'}
            </div>
            <p className="mt-1 text-xs text-emerald-400 flex items-center gap-1">
              ✓ Read-back verified
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Device Controls: Supported Operations */}
      <GlassCard title="Supported Device Controls">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Backup Reserve Control */}
          <div className="flex flex-col justify-between rounded-control border border-field-border bg-space-900/40 p-5">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-ink">Backup Reserve</h3>
                <span className="font-mono text-sm font-bold text-emerald-400">
                  {targetReserve}%
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Minimum energy reserved solely for grid outages.
              </p>

              <div className="mt-5 space-y-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  id="backup-reserve-slider"
                  aria-label="Backup reserve percentage slider"
                  disabled={!canWrite || dispatching}
                  value={targetReserve}
                  onChange={(e) => setTargetReserve(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                />
                <div className="flex justify-between text-[11px] text-ink-muted font-mono">
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-field-border">
              <WriteButton
                variant="primary"
                size="sm"
                className="w-full"
                loading={dispatching && pendingConfirmAction === 'reserve'}
                disabled={targetReserve === config.backupReservePercent}
                onClick={() => setPendingConfirmAction('reserve')}
              >
                Apply Reserve ({targetReserve}%)
              </WriteButton>
            </div>
          </div>

          {/* Operational Mode Control */}
          <div className="flex flex-col justify-between rounded-control border border-field-border bg-space-900/40 p-5">
            <div>
              <h3 className="font-semibold text-ink">Operational Mode</h3>
              <p className="mt-1 text-xs text-ink-muted">
                Governs how the battery balances solar self-consumption and grid arbitrage.
              </p>

              <div className="mt-4 space-y-2">
                {(['SELF_CONSUMPTION', 'AUTONOMOUS'] as const).map((mode) => (
                  <label
                    key={mode}
                    className={`flex items-start gap-2.5 rounded-control p-2.5 text-xs cursor-pointer border transition-colors ${
                      targetMode === mode
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-ink'
                        : 'border-field-border bg-space-950/40 text-ink-muted hover:bg-space-800/40'
                    } ${!canWrite || dispatching ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <input
                      type="radio"
                      name="operationMode"
                      value={mode}
                      disabled={!canWrite || dispatching}
                      checked={targetMode === mode}
                      onChange={() => setTargetMode(mode)}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <div>
                      <span className="font-semibold capitalize text-ink">
                        {mode.replace('_', ' ').toLowerCase()}
                      </span>
                      <p className="mt-0.5 text-[11px] text-ink-muted">
                        {mode === 'SELF_CONSUMPTION' &&
                          'Prioritises powering your home with solar.'}
                        {mode === 'AUTONOMOUS' && 'Balances rates and load automatically.'}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-field-border">
              <WriteButton
                variant="primary"
                size="sm"
                className="w-full"
                loading={dispatching && pendingConfirmAction === 'mode'}
                disabled={targetMode === config.operationMode}
                onClick={() => setPendingConfirmAction('mode')}
              >
                Apply Mode
              </WriteButton>
            </div>
          </div>

          {/* Storm Watch Mode Control */}
          <div className="flex flex-col justify-between rounded-control border border-field-border bg-space-900/40 p-5">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-ink">Storm Watch Mode</h3>
                <span
                  className={`text-xs font-semibold ${
                    targetStormMode ? 'text-amber-400' : 'text-ink-muted'
                  }`}
                >
                  {targetStormMode ? 'ENABLED' : 'DISABLED'}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Pre-charges the Powerwall to maximum capacity in anticipation of hazardous weather.
              </p>

              <div className="mt-6 flex items-center justify-between rounded-control border border-field-border bg-space-950/40 p-3">
                <Switch
                  label="Enable Storm Watch"
                  checked={targetStormMode}
                  disabled={!canWrite || dispatching}
                  onCheckedChange={setTargetStormMode}
                />
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-field-border">
              <WriteButton
                variant="primary"
                size="sm"
                className="w-full"
                loading={dispatching && pendingConfirmAction === 'storm'}
                disabled={targetStormMode === config.stormModeActive}
                onClick={() => setPendingConfirmAction('storm')}
              >
                {targetStormMode ? 'Activate Storm Watch' : 'Deactivate Storm Watch'}
              </WriteButton>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Disabled Unsupported & Unverified Controls Section */}
      <GlassCard title="Disabled & Unsupported Controls">
        <p className="text-xs text-ink-muted mb-4">
          In strict compliance with <strong>D-003 safety invariants</strong> and verified Tesla
          Fleet API documentation, the following controls are deliberately disabled and rejected by
          the backend:
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-control border border-rose-500/20 bg-rose-950/10 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-200">Forced Grid Charging</span>
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                NOT SUPPORTED
              </span>
            </div>
            <p className="mt-1.5 text-xs text-rose-300/80">
              Rule D-003: AutoPW3 prohibits forced battery charging from grid.
            </p>
          </div>

          <div className="rounded-control border border-rose-500/20 bg-rose-950/10 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-200">Forced Grid Export</span>
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                NOT SUPPORTED
              </span>
            </div>
            <p className="mt-1.5 text-xs text-rose-300/80">
              Rule D-003: AutoPW3 prohibits forced discharging into the grid.
            </p>
          </div>

          <div className="rounded-control border border-rose-500/20 bg-rose-950/10 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-200">Solar Inverter Bypass</span>
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                NOT SUPPORTED
              </span>
            </div>
            <p className="mt-1.5 text-xs text-rose-300/80">
              Rule D-003: AutoPW3 prohibits direct bypass of solar hardware inverters.
            </p>
          </div>

          <div className="rounded-control border border-rose-500/20 bg-rose-950/10 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-200">Manual Islanding</span>
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                NOT SUPPORTED
              </span>
            </div>
            <p className="mt-1.5 text-xs text-rose-300/80">
              Rule D-003: Manual off-grid disconnection prohibited for safety.
            </p>
          </div>

          <div className="rounded-control border border-amber-500/20 bg-amber-950/10 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-200">Off-Grid Vehicle Reserve</span>
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                UNVERIFIED
              </span>
            </div>
            <p className="mt-1.5 text-xs text-amber-300/80">
              Pending physical hardware test verification by site owner.
            </p>
          </div>

          <div className="rounded-control border border-amber-500/20 bg-amber-950/10 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-200">Time-of-Use Schedule</span>
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                UNVERIFIED
              </span>
            </div>
            <p className="mt-1.5 text-xs text-amber-300/80">
              Fleet API schedule push payload is unverified with live hardware.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Full Capability Matrix Table */}
      <GlassCard title="Site Capability Registry">
        <DataTable
          caption="Registered capabilities for this site"
          rows={capabilities}
          getRowKey={(row) => row.capability}
          columns={[
            {
              key: 'capability',
              header: 'Capability',
              render: (row) => (
                <span className="font-mono text-xs font-semibold text-ink">{row.capability}</span>
              ),
            },
            {
              key: 'status',
              header: 'Registry Status',
              render: (row) => {
                const colors = {
                  SUPPORTED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
                  UNVERIFIED: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
                  NOT_SUPPORTED: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
                  DISABLED_BY_SETTING: 'bg-space-800 text-ink-muted border-field-border',
                };
                return (
                  <span
                    className={`inline-block rounded border px-2 py-0.5 text-[11px] font-bold ${
                      colors[row.status]
                    }`}
                  >
                    {row.status}
                  </span>
                );
              },
            },
            {
              key: 'reason',
              header: 'Details & Safety Rationale',
              render: (row) => (
                <span className="text-xs text-ink-muted">
                  {row.reason ?? 'Verified and supported for this site'}
                </span>
              ),
            },
          ]}
        />
      </GlassCard>

      {/* Command History & Event Log */}
      <GlassCard title="Recent Command Log & Audit Trail">
        {commands.length === 0 ? (
          <p className="text-xs text-ink-muted py-4 text-center">
            No device commands have been dispatched for this site yet.
          </p>
        ) : (
          <DataTable
            caption="Command history"
            rows={commands}
            getRowKey={(row) => row.id}
            columns={[
              {
                key: 'requestedAt',
                header: 'Time (UTC)',
                render: (row) => (
                  <span className="font-mono text-xs text-ink-muted">
                    {new Date(row.requestedAt).toLocaleTimeString()}
                  </span>
                ),
              },
              {
                key: 'kind',
                header: 'Command',
                render: (row) => (
                  <span className="font-mono text-xs font-semibold text-ink">{row.kind}</span>
                ),
              },
              {
                key: 'origin',
                header: 'Origin',
                render: (row) => (
                  <span className="text-xs text-ink-muted font-medium">{row.origin}</span>
                ),
              },
              {
                key: 'state',
                header: 'State',
                render: (row) => {
                  const stateColors = {
                    CONFIRMED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
                    PENDING: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
                    FAILED: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
                    UNKNOWN: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
                  };
                  return (
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-[11px] font-bold ${
                        stateColors[row.state]
                      }`}
                    >
                      {row.state}
                    </span>
                  );
                },
              },
              {
                key: 'outcome',
                header: 'Reconciliation',
                render: (row) => (
                  <span className="text-xs font-medium">
                    {row.outcome.configurationConfirmed ? (
                      <span className="text-emerald-400">✓ Reconciled</span>
                    ) : (
                      <span className="text-ink-muted">Pending</span>
                    )}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <button
                    type="button"
                    onClick={() => void loadCommandDetail(row.id)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-medium underline"
                  >
                    Details
                  </button>
                ),
              },
            ]}
          />
        )}
      </GlassCard>

      {/* Command Confirmation Modal */}
      <ConfirmDialog
        open={pendingConfirmAction !== null}
        title={
          pendingConfirmAction === 'pause'
            ? automationPaused
              ? 'Resume Automation Dispatch?'
              : 'Emergency Pause All Automation?'
            : 'Confirm Consequential Device Command'
        }
        description={
          pendingConfirmAction === 'pause'
            ? automationPaused
              ? 'Resuming automation will allow active automated rules to dispatch configuration commands to your Powerwall site.'
              : 'Emergency pause immediately suspends all automated rule dispatches. Manual commands will still be permitted by READ_WRITE users.'
            : pendingConfirmAction === 'reserve'
              ? `Are you sure you want to change the backup reserve to ${targetReserve}%? This directly affects how much energy is retained during an outage.`
              : pendingConfirmAction === 'mode'
                ? `Are you sure you want to switch the operational mode to ${targetMode.replace('_', ' ')}?`
                : 'Are you sure you want to change Storm Watch mode?'
        }
        confirmLabel={
          pendingConfirmAction === 'pause'
            ? automationPaused
              ? 'Resume Automation'
              : 'Emergency Pause Now'
            : 'Dispatch Command'
        }
        tone={pendingConfirmAction === 'pause' && !automationPaused ? 'danger' : 'default'}
        busy={dispatching}
        onConfirm={handleConfirmAction}
        onCancel={() => setPendingConfirmAction(null)}
      />

      {/* Command Detail Modal */}
      {selectedCommand && (
        <Modal
          open={selectedCommand !== null}
          onClose={clearSelectedCommand}
          labelledBy="cmd-detail-title"
        >
          <div className="space-y-4">
            <h2 id="cmd-detail-title" className="text-base font-bold text-ink">
              Command Lifecycle & Audit Trail
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between border-b border-field-border pb-1.5">
                <span className="text-ink-muted">Command ID:</span>
                <span className="font-mono text-ink">{selectedCommand.command.id}</span>
              </div>
              <div className="flex justify-between border-b border-field-border pb-1.5">
                <span className="text-ink-muted">Kind:</span>
                <span className="font-mono font-semibold text-ink">
                  {selectedCommand.command.kind}
                </span>
              </div>
              <div className="flex justify-between border-b border-field-border pb-1.5">
                <span className="text-ink-muted">Final State:</span>
                <span className="font-bold text-emerald-400">
                  {selectedCommand.command.state} ({selectedCommand.command.phase})
                </span>
              </div>
              <div className="flex justify-between border-b border-field-border pb-1.5">
                <span className="text-ink-muted">Requested:</span>
                <span className="text-ink">{selectedCommand.command.requestedAt}</span>
              </div>
              <div className="flex justify-between border-b border-field-border pb-1.5">
                <span className="text-ink-muted">Dispatched:</span>
                <span className="text-ink">{selectedCommand.command.dispatchedAt ?? 'None'}</span>
              </div>
              <div className="flex justify-between border-b border-field-border pb-1.5">
                <span className="text-ink-muted">Finished:</span>
                <span className="text-ink">{selectedCommand.command.finishedAt ?? 'Pending'}</span>
              </div>
            </div>

            <div className="mt-4">
              <h3 className="text-xs font-semibold text-ink mb-2">Phase Transition Trail:</h3>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {selectedCommand.events.map((ev, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded bg-space-950/60 p-2 text-[11px] font-mono text-ink-muted border border-field-border"
                  >
                    <span>
                      {ev.fromState ?? 'INIT'} → {ev.toState} ({ev.phase ?? 'N/A'})
                    </span>
                    <span>{new Date(ev.at).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearSelectedCommand}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
