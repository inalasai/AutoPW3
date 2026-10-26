import { useState } from 'react';
import type { AutomationRule, CommandRequest, RuleCondition } from '@autopw3/shared';
import { ConfirmDialog, GlassCard } from '../../components/ui';
import { WriteButton } from '../auth/permissions';
import { usePermissions } from '../auth/AuthProvider';

export interface RuleListProps {
  rules: readonly AutomationRule[];
  onEdit: (rule: AutomationRule) => void;
  onDelete: (ruleId: string) => Promise<boolean>;
  onToggleActive: (ruleId: string, active: boolean) => Promise<boolean>;
}

function formatConditions(conditions: readonly RuleCondition[]): string {
  return conditions
    .map((c) => {
      if (c.type === 'TIME_WINDOW') {
        const startH = Math.floor(c.startMinute / 60)
          .toString()
          .padStart(2, '0');
        const startM = (c.startMinute % 60).toString().padStart(2, '0');
        const endH = Math.floor(c.endMinute / 60)
          .toString()
          .padStart(2, '0');
        const endM = (c.endMinute % 60).toString().padStart(2, '0');
        const dayLabel =
          c.dayType === 'ALL' ? 'Daily' : c.dayType === 'WEEKDAY' ? 'Weekdays' : 'Weekends';
        return `${dayLabel} ${startH}:${startM}-${endH}:${endM}`;
      }
      if (c.type === 'BATTERY_SOC') {
        const comp =
          c.comparator === 'LT'
            ? '<'
            : c.comparator === 'LTE'
              ? '<='
              : c.comparator === 'GT'
                ? '>'
                : '>=';
        return `SOC ${comp} ${c.valuePercent}%`;
      }
      if (c.type === 'IMPORT_RATE') {
        const comp =
          c.comparator === 'LT'
            ? '<'
            : c.comparator === 'LTE'
              ? '<='
              : c.comparator === 'GT'
                ? '>'
                : '>=';
        return `Import ${comp} ${c.ratePerKwh}`;
      }
      return '';
    })
    .filter(Boolean)
    .join(' AND ');
}

function formatAction(action: CommandRequest | undefined): string {
  if (!action) return 'No action configured';
  if (action.kind === 'SET_BACKUP_RESERVE') {
    return `Set backup reserve to ${action.params.backupReservePercent}%`;
  }
  if (action.kind === 'SET_OPERATION_MODE') {
    return `Set mode to ${action.params.operationMode.replace('_', ' ')}`;
  }
  if (action.kind === 'SET_STORM_MODE') {
    return action.params.enabled ? 'Enable Storm Watch' : 'Disable Storm Watch';
  }
  return action.kind;
}

export function RuleList({ rules, onEdit, onDelete, onToggleActive }: RuleListProps) {
  const { canAdmin } = usePermissions();

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmActivateId, setConfirmActivateId] = useState<string | null>(null);

  return (
    <GlassCard title="Configured Automation Rules">
      {rules.length === 0 ? (
        <p className="text-sm text-ink-muted py-4">No automation rules configured yet.</p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => {
            const isActive = rule.mode === 'ACTIVE';
            const isDryRun = rule.mode === 'DRY_RUN';

            return (
              <div
                key={rule.id}
                data-testid={`rule-item-${rule.id}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-control border border-field-border bg-space-900/40 p-4 transition-colors hover:border-select/40"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink text-base">{rule.name}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        isActive
                          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : isDryRun
                            ? 'border border-amber-500/30 bg-amber-500/10 text-amber-300'
                            : 'border border-space-700 bg-space-800 text-ink-muted'
                      }`}
                    >
                      {rule.mode}
                    </span>
                    <span className="rounded bg-space-800 px-2 py-0.5 text-xs font-mono text-ink-muted">
                      Priority {rule.priority}
                    </span>
                  </div>

                  <div className="text-xs text-ink-muted space-y-0.5">
                    <p>
                      <span className="font-semibold text-ink-faint">When:</span>{' '}
                      {formatConditions(rule.definition.conditions)}
                    </p>
                    <p>
                      <span className="font-semibold text-ink-faint">Then:</span>{' '}
                      {formatAction(rule.definition.actions[0])}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {isActive ? (
                    <WriteButton
                      variant="ghost"
                      size="sm"
                      onClick={() => onToggleActive(rule.id, false)}
                    >
                      Deactivate
                    </WriteButton>
                  ) : (
                    <WriteButton
                      variant="primary"
                      size="sm"
                      disabled={!canAdmin}
                      title={
                        !canAdmin ? 'Admin role required to activate automation rules' : undefined
                      }
                      onClick={() => setConfirmActivateId(rule.id)}
                    >
                      Activate
                    </WriteButton>
                  )}

                  <WriteButton variant="ghost" size="sm" onClick={() => onEdit(rule)}>
                    Edit
                  </WriteButton>

                  <WriteButton
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmDeleteId(rule.id)}
                  >
                    Delete
                  </WriteButton>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={async () => {
          if (confirmDeleteId) {
            await onDelete(confirmDeleteId);
            setConfirmDeleteId(null);
          }
        }}
        title="Delete Automation Rule?"
        description="Are you sure you want to delete this rule? This action cannot be undone."
        confirmLabel="Delete Rule"
        tone="danger"
      />

      {/* Activate Confirmation */}
      <ConfirmDialog
        open={confirmActivateId !== null}
        onCancel={() => setConfirmActivateId(null)}
        onConfirm={async () => {
          if (confirmActivateId) {
            await onToggleActive(confirmActivateId, true);
            setConfirmActivateId(null);
          }
        }}
        title="Activate Automation Rule?"
        description="Activating this rule allows AutoPW3 to automatically dispatch device commands to your Powerwall when conditions are met. Make sure you have reviewed its dry-run history."
        confirmLabel="Activate Rule"
      />
    </GlassCard>
  );
}
