import { useEffect, useState } from 'react';
import type {
  AutomationRule,
  CommandRequest,
  Comparator,
  CreateRuleRequest,
  DayType,
  RuleCondition,
  RuleRequestMode,
} from '@autopw3/shared';
import { Button, Modal, SelectField, TextField } from '../../components/ui';

export interface RuleEditorProps {
  isOpen: boolean;
  onClose: () => void;
  rule: AutomationRule | null;
  onSave: (rule: CreateRuleRequest, version?: number) => Promise<boolean>;
}

function minuteToTime(min: number): string {
  const h = Math.floor(min / 60)
    .toString()
    .padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function timeToMinute(timeStr: string): number {
  const [hStr = '0', mStr = '0'] = timeStr.split(':');
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  return Math.min(1440, Math.max(0, h * 60 + m));
}

export function RuleEditor({ isOpen, onClose, rule, onSave }: RuleEditorProps) {
  const [name, setName] = useState('New Powerwall Rule');
  const [priority, setPriority] = useState(100);
  const [mode, setMode] = useState<RuleRequestMode>('DRY_RUN');

  // Condition 1: Time Window
  const [enableTimeWindow, setEnableTimeWindow] = useState(true);
  const [dayType, setDayType] = useState<DayType>('ALL');
  const [startTime, setStartTime] = useState('02:00');
  const [endTime, setEndTime] = useState('05:00');

  // Condition 2: Battery SOC
  const [enableSoc, setEnableSoc] = useState(false);
  const [socComparator, setSocComparator] = useState<Comparator>('LT');
  const [socPercent, setSocPercent] = useState(50);

  // Condition 3: Import Rate
  const [enableRate, setEnableRate] = useState(false);
  const [rateComparator, setRateComparator] = useState<Comparator>('LTE');
  const [ratePerKwh, setRatePerKwh] = useState('0.150000');

  // Action
  const [actionKind, setActionKind] = useState<
    'SET_BACKUP_RESERVE' | 'SET_OPERATION_MODE' | 'SET_STORM_MODE'
  >('SET_BACKUP_RESERVE');
  const [backupReservePercent, setBackupReservePercent] = useState(80);
  const [operationMode, setOperationMode] = useState<'SELF_CONSUMPTION' | 'AUTONOMOUS'>(
    'SELF_CONSUMPTION',
  );
  const [stormModeEnabled, setStormModeEnabled] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setPriority(rule.priority);
      setMode(rule.mode === 'ACTIVE' ? 'DRY_RUN' : rule.mode);

      // Parse conditions
      let foundTime = false;
      let foundSoc = false;
      let foundRate = false;

      for (const cond of rule.definition.conditions) {
        if (cond.type === 'TIME_WINDOW') {
          foundTime = true;
          setDayType(cond.dayType);
          setStartTime(minuteToTime(cond.startMinute));
          setEndTime(minuteToTime(cond.endMinute));
        } else if (cond.type === 'BATTERY_SOC') {
          foundSoc = true;
          setSocComparator(cond.comparator);
          setSocPercent(cond.valuePercent);
        } else if (cond.type === 'IMPORT_RATE') {
          foundRate = true;
          setRateComparator(cond.comparator);
          setRatePerKwh(cond.ratePerKwh);
        }
      }

      setEnableTimeWindow(foundTime);
      setEnableSoc(foundSoc);
      setEnableRate(foundRate);

      // Parse first action
      const action = rule.definition.actions[0];
      if (action) {
        if (action.kind === 'SET_BACKUP_RESERVE') {
          setActionKind('SET_BACKUP_RESERVE');
          setBackupReservePercent(action.params.backupReservePercent);
        } else if (action.kind === 'SET_OPERATION_MODE') {
          setActionKind('SET_OPERATION_MODE');
          setOperationMode(action.params.operationMode as 'SELF_CONSUMPTION' | 'AUTONOMOUS');
        } else if (action.kind === 'SET_STORM_MODE') {
          setActionKind('SET_STORM_MODE');
          setStormModeEnabled(action.params.enabled);
        }
      }
    } else {
      setName('New Powerwall Rule');
      setPriority(100);
      setMode('DRY_RUN');
      setEnableTimeWindow(true);
      setDayType('ALL');
      setStartTime('02:00');
      setEndTime('05:00');
      setEnableSoc(false);
      setSocComparator('LT');
      setSocPercent(50);
      setEnableRate(false);
      setRateComparator('LTE');
      setRatePerKwh('0.150000');
      setActionKind('SET_BACKUP_RESERVE');
      setBackupReservePercent(80);
      setOperationMode('SELF_CONSUMPTION');
      setStormModeEnabled(true);
    }
  }, [rule]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Rule name is required');
      return;
    }

    const conditions: RuleCondition[] = [];

    if (enableTimeWindow) {
      const startMin = timeToMinute(startTime);
      const endMin = timeToMinute(endTime);
      if (endMin <= startMin) {
        setError('End time must be after start time');
        return;
      }
      conditions.push({
        type: 'TIME_WINDOW',
        dayType,
        startMinute: startMin,
        endMinute: endMin,
      });
    }

    if (enableSoc) {
      conditions.push({
        type: 'BATTERY_SOC',
        comparator: socComparator,
        valuePercent: Math.min(100, Math.max(0, socPercent)),
      });
    }

    if (enableRate) {
      conditions.push({
        type: 'IMPORT_RATE',
        comparator: rateComparator,
        ratePerKwh,
      });
    }

    if (conditions.length === 0) {
      setError('At least one condition is required');
      return;
    }

    let action: CommandRequest;
    if (actionKind === 'SET_BACKUP_RESERVE') {
      action = {
        kind: 'SET_BACKUP_RESERVE',
        params: { backupReservePercent: Math.min(100, Math.max(0, backupReservePercent)) },
      };
    } else if (actionKind === 'SET_OPERATION_MODE') {
      action = {
        kind: 'SET_OPERATION_MODE',
        params: { operationMode },
      };
    } else {
      action = {
        kind: 'SET_STORM_MODE',
        params: { enabled: stormModeEnabled },
      };
    }

    const payload: CreateRuleRequest = {
      name: name.trim(),
      priority,
      mode,
      definition: {
        conditions,
        actions: [action],
      },
    };

    setSaving(true);
    try {
      const ok = await onSave(payload, rule?.version);
      if (ok) {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} labelledBy="rule-editor-modal-title">
      <div className="flex flex-col gap-4 max-w-xl w-full">
        <h2 id="rule-editor-modal-title" className="text-lg font-semibold text-ink">
          {rule ? 'Edit Automation Rule' : 'New Automation Rule'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          {error && (
            <div className="rounded-control border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label="Rule Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Night Charge Window"
              required
            />

            <TextField
              label="Priority (Higher wins conflicts)"
              type="number"
              value={priority.toString()}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
              min={0}
              max={10000}
              required
            />
          </div>

          <SelectField
            label="Initial Mode (Safety Default)"
            value={mode}
            onChange={(e) => setMode(e.target.value as RuleRequestMode)}
          >
            <option value="DRY_RUN">
              DRY_RUN (Recommended: Records actions without sending commands)
            </option>
            <option value="DISABLED">DISABLED (Inactive)</option>
          </SelectField>
          <p className="text-xs text-ink-muted -mt-2">
            New rules default to DRY_RUN. Once verified in the execution log, an administrator can
            activate the rule.
          </p>

          {/* Conditions Section */}
          <div className="rounded-control border border-field-border bg-space-900/60 p-3 space-y-3">
            <span className="font-semibold text-xs tracking-wider uppercase text-ink-muted block">
              Rule Conditions (All must hold: AND logic)
            </span>

            {/* Time Window */}
            <div className="space-y-2 border-b border-field-border pb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableTimeWindow}
                  onChange={(e) => setEnableTimeWindow(e.target.checked)}
                  className="rounded border-field-border bg-space-800 text-select focus:ring-0"
                />
                <span className="font-medium text-ink">Time of Day Window</span>
              </label>
              {enableTimeWindow && (
                <div className="grid grid-cols-3 gap-2 pl-6 pt-1">
                  <SelectField
                    label="Day Type"
                    value={dayType}
                    onChange={(e) => setDayType(e.target.value as DayType)}
                  >
                    <option value="ALL">Everyday</option>
                    <option value="WEEKDAY">Weekdays (Mon-Fri)</option>
                    <option value="WEEKEND">Weekends (Sat-Sun)</option>
                  </SelectField>
                  <TextField
                    label="Start Time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                  <TextField
                    label="End Time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Battery SOC */}
            <div className="space-y-2 border-b border-field-border pb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableSoc}
                  onChange={(e) => setEnableSoc(e.target.checked)}
                  className="rounded border-field-border bg-space-800 text-select focus:ring-0"
                />
                <span className="font-medium text-ink">Battery State of Charge</span>
              </label>
              {enableSoc && (
                <div className="grid grid-cols-2 gap-2 pl-6 pt-1">
                  <SelectField
                    label="Condition"
                    value={socComparator}
                    onChange={(e) => setSocComparator(e.target.value as Comparator)}
                  >
                    <option value="LT">Less Than (&lt;)</option>
                    <option value="LTE">Less Than or Equal (&le;)</option>
                    <option value="GT">Greater Than (&gt;)</option>
                    <option value="GTE">Greater Than or Equal (&ge;)</option>
                  </SelectField>
                  <TextField
                    label="Percentage (%)"
                    type="number"
                    min={0}
                    max={100}
                    value={socPercent.toString()}
                    onChange={(e) => setSocPercent(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
              )}
            </div>

            {/* Import Rate */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableRate}
                  onChange={(e) => setEnableRate(e.target.checked)}
                  className="rounded border-field-border bg-space-800 text-select focus:ring-0"
                />
                <span className="font-medium text-ink">Tariff Import Rate Threshold</span>
              </label>
              {enableRate && (
                <div className="grid grid-cols-2 gap-2 pl-6 pt-1">
                  <SelectField
                    label="Condition"
                    value={rateComparator}
                    onChange={(e) => setRateComparator(e.target.value as Comparator)}
                  >
                    <option value="LTE">Rate is at most (&le;)</option>
                    <option value="LT">Rate is less than (&lt;)</option>
                    <option value="GTE">Rate is at least (&ge;)</option>
                    <option value="GT">Rate is greater than (&gt;)</option>
                  </SelectField>
                  <TextField
                    label="Rate per kWh"
                    value={ratePerKwh}
                    onChange={(e) => setRatePerKwh(e.target.value)}
                    placeholder="0.150000"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Action Section */}
          <div className="rounded-control border border-field-border bg-space-900/60 p-3 space-y-3">
            <span className="font-semibold text-xs tracking-wider uppercase text-ink-muted block">
              Automated Action (Dispatched if conditions match)
            </span>

            <SelectField
              label="Device Action"
              value={actionKind}
              onChange={(e) =>
                setActionKind(
                  e.target.value as 'SET_BACKUP_RESERVE' | 'SET_OPERATION_MODE' | 'SET_STORM_MODE',
                )
              }
            >
              <option value="SET_BACKUP_RESERVE">Set Backup Reserve Percentage</option>
              <option value="SET_OPERATION_MODE">
                Set Operational Mode (Self-Consumption / Autonomous)
              </option>
              <option value="SET_STORM_MODE">Set Storm Watch Mode</option>
            </SelectField>

            {actionKind === 'SET_BACKUP_RESERVE' && (
              <TextField
                label="Target Backup Reserve (%)"
                type="number"
                min={0}
                max={100}
                value={backupReservePercent.toString()}
                onChange={(e) => setBackupReservePercent(parseInt(e.target.value, 10) || 0)}
              />
            )}

            {actionKind === 'SET_OPERATION_MODE' && (
              <SelectField
                label="Target Operation Mode"
                value={operationMode}
                onChange={(e) =>
                  setOperationMode(e.target.value as 'SELF_CONSUMPTION' | 'AUTONOMOUS')
                }
              >
                <option value="SELF_CONSUMPTION">Self-Consumption</option>
                <option value="AUTONOMOUS">Autonomous / Time-of-Use</option>
              </SelectField>
            )}

            {actionKind === 'SET_STORM_MODE' && (
              <SelectField
                label="Storm Watch Setting"
                value={stormModeEnabled ? 'true' : 'false'}
                onChange={(e) => setStormModeEnabled(e.target.value === 'true')}
              >
                <option value="true">Enable Storm Watch</option>
                <option value="false">Disable Storm Watch</option>
              </SelectField>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={saving} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Saving...' : rule ? 'Save Changes' : 'Create Rule'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
