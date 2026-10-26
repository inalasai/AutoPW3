import { useState } from 'react';
import type { CreateRuleRequest } from '@autopw3/shared';
import { useDocumentTitle } from '../../app/pages/Page';
import { ConfirmDialog, ErrorBanner, PageHeader } from '../../components/ui';
import { BoltIcon } from '../../components/ui/icons';
import { ReadOnlyNotice, WriteButton } from '../auth/permissions';
import { ExecutionLog } from './ExecutionLog';
import { RuleEditor } from './RuleEditor';
import { RuleList } from './RuleList';
import { useAutomation } from './use-automation';

export function AutomationManager() {
  useDocumentTitle('Automation');

  const {
    rules,
    executions,
    automationPaused,
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
  } = useAutomation();

  const [confirmPauseOpen, setConfirmPauseOpen] = useState(false);

  const handleSaveRule = async (
    ruleData: CreateRuleRequest,
    version?: number,
  ): Promise<boolean> => {
    if (selectedRule && version !== undefined) {
      return updateRule(selectedRule.id, ruleData, version);
    }
    return createRule(ruleData);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automation"
        description="Rules that act on conditions such as time of day, battery level and import rate."
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
              onClick={() => setConfirmPauseOpen(true)}
            >
              {automationPaused ? 'Resume Automation' : 'Emergency Pause'}
            </WriteButton>

            <WriteButton variant="primary" size="sm" onClick={openCreateEditor}>
              New rule
            </WriteButton>
          </div>
        }
      />

      <ReadOnlyNotice what="change rules" />

      {error && <ErrorBanner tone="error" title="Automation Error" message={error} />}

      {/* Safety Notice per D-003 / Task 18 requirements */}
      <div
        data-testid="automation-safety-notice"
        className="rounded-card border border-amber-500/20 bg-amber-950/20 p-4 text-xs text-amber-200/90 leading-relaxed shadow-sm"
      >
        <p className="font-semibold text-amber-100 mb-1 flex items-center gap-1.5">
          <BoltIcon className="h-4 w-4 text-amber-400" />
          Safety Guardrail: Real Automation is Off by Default
        </p>
        <p>
          New rules are created in <span className="font-mono font-semibold">DRY_RUN</span> mode.
          Dry-run evaluations record what would have happened in the execution log and never call
          device control endpoints. Real hardware dispatches occur only when an administrator
          promotes a rule to <span className="font-mono font-semibold">ACTIVE</span>. Forced
          charging, forced export, solar bypass, and islanding are strictly prohibited.
        </p>
      </div>

      {/* Rules List */}
      <RuleList
        rules={rules}
        onEdit={openEditEditor}
        onDelete={deleteRule}
        onToggleActive={setRuleActive}
      />

      {/* Execution Audit Log */}
      <ExecutionLog executions={executions} />

      {/* Rule Create/Edit Modal */}
      <RuleEditor
        isOpen={isEditorOpen}
        onClose={closeEditor}
        rule={selectedRule}
        onSave={handleSaveRule}
      />

      {/* Emergency Pause Confirmation */}
      <ConfirmDialog
        open={confirmPauseOpen}
        onCancel={() => setConfirmPauseOpen(false)}
        onConfirm={async () => {
          await toggleAutomationPause();
          setConfirmPauseOpen(false);
        }}
        title={automationPaused ? 'Resume Automated Rules?' : 'Emergency Pause All Automation?'}
        description={
          automationPaused
            ? 'Resuming automation allows active rules to evaluate and dispatch commands during their scheduled slots.'
            : 'Emergency pause immediately suspends all automated rule dispatches. Manual commands remain available.'
        }
        confirmLabel={automationPaused ? 'Resume Automation' : 'Emergency Pause Now'}
        tone={automationPaused ? 'default' : 'danger'}
      />
    </div>
  );
}
