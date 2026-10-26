import { useEffect, useState } from 'react';
import type { UpdateHouseholdSettingsRequest } from '@autopw3/shared';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/display';
import { Switch, TextField } from '../../components/ui/fields';
import { ConfirmDialog } from '../../components/ui/overlays';
import type { HouseholdSettingsData, TeslaLinkData } from './types';

export interface SettingsManagerProps {
  readonly settings: HouseholdSettingsData | null;
  readonly teslaLink: TeslaLinkData | null;
  readonly canAdmin: boolean;
  readonly onUpdateSettings: (updates: UpdateHouseholdSettingsRequest) => Promise<boolean>;
  readonly onDisconnectTesla: () => Promise<boolean>;
}

export function SettingsManager({
  settings,
  teslaLink,
  canAdmin,
  onUpdateSettings,
  onDisconnectTesla,
}: SettingsManagerProps) {
  const [spendCap, setSpendCap] = useState('9.00');
  const [staleAfter, setStaleAfter] = useState('300');
  const [backgroundInterval] = useState('5');
  const [retentionDays, setRetentionDays] = useState('90');
  const [controlsEnabled, setControlsEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Disconnect confirmation
  const [isDisconnectOpen, setIsDisconnectOpen] = useState(false);

  useEffect(() => {
    if (settings) {
      setSpendCap(settings.budget.capUsd);
      setStaleAfter(String(settings.staleAfterSeconds));
      setControlsEnabled(settings.controlsEnabled);
    }
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const parsedStale = parseInt(staleAfter, 10);
    const parsedInterval = parseInt(backgroundInterval, 10);

    if (isNaN(parsedStale) || parsedStale <= 0) {
      setFormError('Stale threshold must be a positive integer.');
      return;
    }

    if (parsedStale <= parsedInterval * 60) {
      setFormError(
        `Stale data threshold (${parsedStale}s) must exceed the background interval (${parsedInterval * 60}s).`,
      );
      return;
    }

    setIsSaving(true);
    try {
      const ok = await onUpdateSettings({
        monthlySpendCapUsd: spendCap,
        staleAfterSeconds: parsedStale,
        rawRetentionDays: parseInt(retentionDays, 10) || 90,
        controlsEnabled,
      });

      if (ok) {
        setSuccessMessage('Household settings updated successfully.');
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    const ok = await onDisconnectTesla();
    if (ok) {
      setIsDisconnectOpen(false);
    }
  };

  const isConnected = teslaLink?.state === 'ACTIVE';

  return (
    <div className="space-y-6">
      {/* Tesla Connection Card */}
      <GlassCard title="Tesla Connection Status">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  isConnected ? 'bg-emerald-400 shadow-emerald-400/50 shadow-sm' : 'bg-rose-400'
                }`}
              />
              <span className="font-semibold text-slate-100">
                {isConnected ? 'Tesla Fleet API Connected' : 'Disconnected'}
              </span>
              <span
                className={`rounded border px-2 py-0.5 text-xs font-mono font-medium ${
                  isConnected
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-800 text-slate-400'
                }`}
              >
                {teslaLink?.state ?? 'NOT_CONNECTED'}
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              {isConnected
                ? `Authorized scopes: ${teslaLink?.scopes?.join(', ') || 'energy_device_data'}. Tokens encrypted at rest.`
                : 'No active Tesla authorization. Telemetry ingestion is suspended.'}
            </p>
          </div>

          {canAdmin && isConnected && (
            <Button
              variant="secondary"
              size="sm"
              className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
              onClick={() => setIsDisconnectOpen(true)}
            >
              Disconnect Tesla
            </Button>
          )}
        </div>
      </GlassCard>

      {/* Household Settings Form */}
      <GlassCard title="Household Settings">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              id="spend-cap"
              name="monthlySpendCap"
              label="Monthly Spend Cap (USD)"
              value={spendCap}
              onChange={(e) => setSpendCap(e.target.value)}
              hint="Estimated maximum monthly provider API expenditure."
              disabled={!canAdmin}
            />

            <TextField
              id="stale-threshold"
              name="staleAfterSeconds"
              label="Stale Data Threshold (Seconds)"
              value={staleAfter}
              onChange={(e) => setStaleAfter(e.target.value)}
              hint="Must strictly exceed background interval (300s)."
              disabled={!canAdmin}
            />

            <TextField
              id="retention-days"
              name="rawRetentionDays"
              label="Raw Telemetry Retention (Days)"
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              hint="Powerwall metrics logs older than this are purged (minimum 90 days)."
              disabled={!canAdmin}
            />

            <div className="flex flex-col justify-center space-y-1 pt-2 sm:pt-0">
              <label className="text-xs font-medium text-ink">Hardware Control Permissions</label>
              <Switch
                label="Enable Powerwall Remote Controls"
                checked={controlsEnabled}
                onCheckedChange={setControlsEnabled}
                disabled={!canAdmin}
              />
              <p className="text-xs text-ink-muted">
                When disabled, all device control requests and rule executions are blocked.
              </p>
            </div>
          </div>

          {formError && <p className="text-xs font-medium text-rose-400">{formError}</p>}

          {successMessage && (
            <p className="text-xs font-medium text-emerald-400">{successMessage}</p>
          )}

          {canAdmin && (
            <div className="flex justify-end pt-2">
              <Button variant="primary" type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          )}
        </form>
      </GlassCard>

      {/* Disconnect Confirmation Dialog */}
      <ConfirmDialog
        open={isDisconnectOpen}
        title="Disconnect Tesla Account"
        description="Are you sure you want to disconnect your Tesla account? Live telemetry ingestion and device automation will immediately cease, and encrypted access tokens will be securely wiped."
        confirmLabel="Disconnect Tesla"
        tone="danger"
        onCancel={() => setIsDisconnectOpen(false)}
        onConfirm={handleConfirmDisconnect}
      />
    </div>
  );
}
