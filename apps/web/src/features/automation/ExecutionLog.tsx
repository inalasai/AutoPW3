import type { AutomationExecution, ExecutionDecision } from '@autopw3/shared';
import { DataTable, GlassCard } from '../../components/ui';

export interface ExecutionLogProps {
  executions: readonly AutomationExecution[];
}

function decisionBadge(decision: ExecutionDecision) {
  switch (decision) {
    case 'ACTED':
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
          ACTED
        </span>
      );
    case 'WOULD_ACT':
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300">
          WOULD ACT (DRY RUN)
        </span>
      );
    case 'NO_ACTION':
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border border-space-700 bg-space-800 text-ink-muted">
          NO ACTION
        </span>
      );
    case 'SKIPPED_PAUSED':
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300">
          SKIPPED (PAUSED)
        </span>
      );
    case 'SKIPPED_STALE':
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border border-orange-500/30 bg-orange-500/10 text-orange-300">
          SKIPPED (STALE DATA)
        </span>
      );
    case 'SKIPPED_CONFLICT':
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border border-purple-500/30 bg-purple-500/10 text-purple-300">
          SKIPPED (CONFLICT)
        </span>
      );
    case 'SKIPPED_CAPABILITY':
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border border-violet-500/30 bg-violet-500/10 text-violet-300">
          SKIPPED (CAPABILITY)
        </span>
      );
    case 'SKIPPED_MISSED':
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border border-rose-500/30 bg-rose-500/10 text-rose-300">
          SKIPPED (MISSED RUN)
        </span>
      );
    case 'ERROR':
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border border-rose-500/30 bg-rose-500/10 text-rose-300">
          ERROR
        </span>
      );
  }
}

export function ExecutionLog({ executions }: ExecutionLogProps) {
  return (
    <GlassCard title="Automation Execution History">
      {executions.length === 0 ? (
        <p className="text-sm text-ink-muted py-4">No automation evaluations recorded yet.</p>
      ) : (
        <DataTable<AutomationExecution>
          caption="Automation execution history"
          captionHidden
          rows={executions}
          getRowKey={(e) => e.id}
          columns={[
            {
              key: 'evaluatedAt',
              header: 'Evaluated At',
              render: (e) => (
                <span className="font-mono text-xs text-ink">
                  {new Date(e.evaluatedAt).toLocaleTimeString()}
                </span>
              ),
            },
            {
              key: 'modeAtEvaluation',
              header: 'Mode',
              render: (e) => (
                <span className="font-mono text-xs text-ink-muted">{e.modeAtEvaluation}</span>
              ),
            },
            {
              key: 'decision',
              header: 'Decision',
              render: (e) => decisionBadge(e.decision),
            },
            {
              key: 'reason',
              header: 'Reason',
              render: (e) => (
                <span
                  className="text-xs text-ink-muted block max-w-md truncate"
                  title={e.reason ?? ''}
                >
                  {e.reason ?? '—'}
                </span>
              ),
            },
            {
              key: 'commandId',
              header: 'Command',
              render: (e) =>
                e.commandId ? (
                  <span className="font-mono text-xs text-emerald-400">
                    {e.commandId.slice(0, 8)}…
                  </span>
                ) : (
                  <span className="text-xs text-ink-faint">None</span>
                ),
            },
          ]}
        />
      )}
    </GlassCard>
  );
}
