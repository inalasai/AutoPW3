import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/overlays';
import { GlassCard } from '../../components/ui/display';
import type { InvitationRow } from './types';

export interface InvitationListProps {
  readonly invitations: readonly InvitationRow[];
  readonly canAdmin: boolean;
  readonly onOpenInviteModal: () => void;
  readonly onRevokeInvitation: (invitationId: string) => Promise<boolean>;
}

export function InvitationList({
  invitations,
  canAdmin,
  onOpenInviteModal,
  onRevokeInvitation,
}: InvitationListProps) {
  const [revokeTarget, setRevokeTarget] = useState<InvitationRow | null>(null);
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false);

  const handleOpenRevoke = (inv: InvitationRow) => {
    setRevokeTarget(inv);
    setIsRevokeDialogOpen(true);
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return;
    const ok = await onRevokeInvitation(revokeTarget.id);
    if (ok) {
      setIsRevokeDialogOpen(false);
      setRevokeTarget(null);
    }
  };

  const getStatus = (inv: InvitationRow) => {
    if (inv.revokedAt)
      return { label: 'Revoked', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20' };
    if (inv.acceptedAt)
      return {
        label: 'Accepted',
        color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      };
    if (new Date(inv.expiresAt).getTime() < Date.now()) {
      return { label: 'Expired', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
    }
    return { label: 'Pending', color: 'bg-amber-500/10 text-amber-300 border-amber-500/20' };
  };

  return (
    <GlassCard
      title="Pending Invitations"
      actions={
        canAdmin ? (
          <Button size="sm" variant="primary" onClick={onOpenInviteModal}>
            Invite Member
          </Button>
        ) : undefined
      }
      className="space-y-4"
    >
      <div className="overflow-x-auto rounded-lg border border-slate-700/50 bg-slate-900/40">
        <table className="w-full text-left text-sm" role="table" aria-label="Household invitations">
          <thead className="border-b border-slate-700/60 bg-slate-800/40 text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3">
                Invitee Email
              </th>
              <th scope="col" className="px-4 py-3">
                Role
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              <th scope="col" className="px-4 py-3">
                Expires
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-ink">
            {invitations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  No invitations recorded.
                </td>
              </tr>
            ) : (
              invitations.map((inv) => {
                const status = getStatus(inv);
                const isPending = status.label === 'Pending';

                return (
                  <tr key={inv.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-100">
                      {inv.email ?? (
                        <span className="italic text-ink-muted">Any email (open link)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-ink-muted">{inv.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${status.color}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {new Date(inv.expiresAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canAdmin && isPending && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => handleOpenRevoke(inv)}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {revokeTarget && (
        <ConfirmDialog
          open={isRevokeDialogOpen}
          title="Revoke Invitation"
          description={`Are you sure you want to revoke the invitation for ${revokeTarget.email ?? 'this recipient'}? The link will immediately stop functioning.`}
          confirmLabel="Revoke Invitation"
          tone="danger"
          onCancel={() => setIsRevokeDialogOpen(false)}
          onConfirm={handleConfirmRevoke}
        />
      )}
    </GlassCard>
  );
}
