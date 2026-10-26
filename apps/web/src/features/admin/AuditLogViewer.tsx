import { useMemo, useState } from 'react';
import type { AuditAction } from '@autopw3/shared';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/display';
import { SelectField, TextField } from '../../components/ui/fields';
import { Modal } from '../../components/ui/overlays';
import type { AuditRow } from './types';

export interface AuditLogViewerProps {
  readonly auditEntries: readonly AuditRow[];
  readonly canAdmin: boolean;
}

export function AuditLogViewer({ auditEntries, canAdmin }: AuditLogViewerProps) {
  const [selectedAction, setSelectedAction] = useState<AuditAction | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [activeEntry, setActiveEntry] = useState<AuditRow | null>(null);

  const filteredEntries = useMemo(() => {
    return auditEntries.filter((entry) => {
      const matchesAction = selectedAction === 'ALL' || entry.action === selectedAction;
      const searchLower = search.toLowerCase();
      const matchesSearch =
        search === '' ||
        entry.action.toLowerCase().includes(searchLower) ||
        (entry.actorUserId ?? '').toLowerCase().includes(searchLower) ||
        (entry.targetId ?? '').toLowerCase().includes(searchLower) ||
        (entry.requestId ?? '').toLowerCase().includes(searchLower);
      return matchesAction && matchesSearch;
    });
  }, [auditEntries, selectedAction, search]);

  const getActionBadgeClass = (action: AuditAction) => {
    if (action.startsWith('member.')) {
      return 'bg-purple-500/10 text-purple-300 border-purple-500/20';
    }
    if (action.startsWith('invitation.')) {
      return 'bg-blue-500/10 text-blue-300 border-blue-500/20';
    }
    if (action.startsWith('automation.') || action.startsWith('rule.')) {
      return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
    }
    if (action.startsWith('command.')) {
      return 'bg-rose-500/10 text-rose-300 border-rose-500/20';
    }
    if (action.startsWith('settings.')) {
      return 'bg-teal-500/10 text-teal-300 border-teal-500/20';
    }
    return 'bg-slate-500/10 text-slate-300 border-slate-500/20';
  };

  return (
    <GlassCard title="Audit Log" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap gap-2">
          <TextField
            id="audit-search"
            name="auditSearch"
            label="Search audit log"
            hideLabel
            placeholder="Search action, actor, target..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <SelectField
            id="audit-action-filter"
            name="auditActionFilter"
            label="Filter by action"
            hideLabel
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value as AuditAction | 'ALL')}
            className="w-48"
          >
            <option value="ALL">All Actions</option>
            <option value="member.added">member.added</option>
            <option value="member.role_changed">member.role_changed</option>
            <option value="member.removed">member.removed</option>
            <option value="invitation.created">invitation.created</option>
            <option value="invitation.accepted">invitation.accepted</option>
            <option value="invitation.revoked">invitation.revoked</option>
            <option value="settings.changed">settings.changed</option>
            <option value="rule.mode_changed">rule.mode_changed</option>
            <option value="automation.paused">automation.paused</option>
            <option value="automation.resumed">automation.resumed</option>
            <option value="command.requested">command.requested</option>
            <option value="tariff.version_created">tariff.version_created</option>
            <option value="tariff.deleted">tariff.deleted</option>
            <option value="bootstrap.completed">bootstrap.completed</option>
          </SelectField>
        </div>
        <div className="text-sm text-ink-muted">
          Showing {filteredEntries.length} event{filteredEntries.length === 1 ? '' : 's'}
        </div>
      </div>

      {!canAdmin && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Viewing audit history requires the ADMIN role. In demo mode, sample events are displayed.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700/50 bg-slate-900/40">
        <table className="w-full text-left text-sm" role="table" aria-label="Household audit log">
          <thead className="border-b border-slate-700/60 bg-slate-800/40 text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3">
                Timestamp
              </th>
              <th scope="col" className="px-4 py-3">
                Action
              </th>
              <th scope="col" className="px-4 py-3">
                Actor
              </th>
              <th scope="col" className="px-4 py-3">
                Target
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-ink">
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  No audit events found matching the criteria.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 text-xs text-ink-muted whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-mono font-medium ${getActionBadgeClass(
                        entry.action,
                      )}`}
                    >
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {entry.actorType === 'SYSTEM' ? (
                      <span className="font-semibold text-slate-400">SYSTEM</span>
                    ) : (
                      <span
                        className="font-mono text-ink-muted"
                        title={entry.actorUserId ?? undefined}
                      >
                        {entry.actorUserId ? `${entry.actorUserId.substring(0, 8)}...` : 'User'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">
                    {entry.targetType ? (
                      <span className="font-mono">
                        {entry.targetType}:{' '}
                        {entry.targetId ? `${entry.targetId.substring(0, 8)}...` : '-'}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setActiveEntry(entry)}
                      className="text-xs"
                    >
                      View Metadata
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Metadata Detail Modal */}
      {activeEntry && (
        <Modal
          open={Boolean(activeEntry)}
          onClose={() => setActiveEntry(null)}
          labelledBy="audit-modal-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-space-900 p-6 shadow-2xl space-y-4">
            <h2 id="audit-modal-title" className="text-lg font-semibold text-slate-100">
              Audit Event #{activeEntry.id}: {activeEntry.action}
            </h2>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-ink-muted">Timestamp:</span>{' '}
                <span className="font-mono text-slate-200">{activeEntry.createdAt}</span>
              </div>
              <div>
                <span className="text-ink-muted">Request ID:</span>{' '}
                <span className="font-mono text-slate-200">{activeEntry.requestId ?? 'None'}</span>
              </div>
              <div>
                <span className="text-ink-muted">Actor Type:</span>{' '}
                <span className="text-slate-200">{activeEntry.actorType}</span>
              </div>
              <div>
                <span className="text-ink-muted">Actor User ID:</span>{' '}
                <span className="font-mono text-slate-200">{activeEntry.actorUserId ?? 'N/A'}</span>
              </div>
              <div>
                <span className="text-ink-muted">Target Type:</span>{' '}
                <span className="text-slate-200">{activeEntry.targetType ?? 'N/A'}</span>
              </div>
              <div>
                <span className="text-ink-muted">Target ID:</span>{' '}
                <span className="font-mono text-slate-200">{activeEntry.targetId ?? 'N/A'}</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-ink-muted">
                Sanitised Event Metadata
              </label>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-950 p-3 text-xs font-mono text-teal-300 border border-slate-800">
                {JSON.stringify(activeEntry.metadata, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="primary" onClick={() => setActiveEntry(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </GlassCard>
  );
}
