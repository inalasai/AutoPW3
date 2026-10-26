import { useMemo, useState } from 'react';
import type { Role } from '@autopw3/shared';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog, Modal } from '../../components/ui/overlays';
import { SelectField, TextField } from '../../components/ui/fields';
import { GlassCard } from '../../components/ui/display';
import type { MemberRow } from './types';

export interface MemberListProps {
  readonly members: readonly MemberRow[];
  readonly currentUserId: string | null;
  readonly canAdmin: boolean;
  readonly onChangeRole: (userId: string, newRole: Role) => Promise<boolean>;
  readonly onRemoveMember: (userId: string) => Promise<boolean>;
}

export function MemberList({
  members,
  currentUserId,
  canAdmin,
  onChangeRole,
  onRemoveMember,
}: MemberListProps) {
  const [search, setSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role | 'ALL'>('ALL');

  // Change Role State
  const [roleTarget, setRoleTarget] = useState<MemberRow | null>(null);
  const [pendingNewRole, setPendingNewRole] = useState<Role>('READ_ONLY');
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);

  // Remove Member State
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);

  // Calculate admin count for last-admin protection UI hints
  const adminCount = useMemo(() => members.filter((m) => m.role === 'ADMIN').length, [members]);

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const matchesSearch =
        search === '' ||
        (m.displayName ?? '').toLowerCase().includes(search.toLowerCase()) ||
        m.userId.toLowerCase().includes(search.toLowerCase());
      const matchesRole = selectedRole === 'ALL' || m.role === selectedRole;
      return matchesSearch && matchesRole;
    });
  }, [members, search, selectedRole]);

  const handleOpenRoleModal = (member: MemberRow) => {
    setRoleTarget(member);
    setPendingNewRole(member.role);
    setIsRoleModalOpen(true);
  };

  const handleConfirmRoleChange = async () => {
    if (!roleTarget) return;
    const ok = await onChangeRole(roleTarget.userId, pendingNewRole);
    if (ok) {
      setIsRoleModalOpen(false);
      setRoleTarget(null);
    }
  };

  const handleOpenRemoveDialog = (member: MemberRow) => {
    setRemoveTarget(member);
    setIsRemoveDialogOpen(true);
  };

  const handleConfirmRemove = async () => {
    if (!removeTarget) return;
    const ok = await onRemoveMember(removeTarget.userId);
    if (ok) {
      setIsRemoveDialogOpen(false);
      setRemoveTarget(null);
    }
  };

  return (
    <GlassCard title="Household Members" className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 gap-2">
          <TextField
            id="member-search"
            name="memberSearch"
            label="Search members"
            hideLabel
            placeholder="Search members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <SelectField
            id="role-filter"
            name="roleFilter"
            label="Filter by role"
            hideLabel
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value as Role | 'ALL')}
            className="w-36"
          >
            <option value="ALL">All Roles</option>
            <option value="ADMIN">ADMIN</option>
            <option value="READ_WRITE">READ_WRITE</option>
            <option value="READ_ONLY">READ_ONLY</option>
          </SelectField>
        </div>
        <div className="text-sm text-ink-muted">
          Showing {filteredMembers.length} of {members.length} member
          {members.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Members Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700/50 bg-slate-900/40">
        <table className="w-full text-left text-sm" role="table" aria-label="Household members">
          <thead className="border-b border-slate-700/60 bg-slate-800/40 text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3">
                Member
              </th>
              <th scope="col" className="px-4 py-3">
                Role
              </th>
              <th scope="col" className="px-4 py-3">
                Joined
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-ink">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                  No members match your criteria.
                </td>
              </tr>
            ) : (
              filteredMembers.map((member) => {
                const isSelf = member.userId === currentUserId;
                const isLastAdmin = member.role === 'ADMIN' && adminCount <= 1;

                return (
                  <tr key={member.userId} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">
                        {member.displayName ?? 'Unnamed User'}
                        {isSelf && (
                          <span className="ml-2 inline-flex items-center rounded bg-teal-500/10 px-2 py-0.5 text-xs font-semibold text-teal-400">
                            You
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs text-ink-muted">{member.userId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          member.role === 'ADMIN'
                            ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                            : member.role === 'READ_WRITE'
                              ? 'bg-teal-500/10 text-teal-300 border border-teal-500/20'
                              : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                        }`}
                      >
                        {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs">
                      {new Date(member.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canAdmin && (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleOpenRoleModal(member)}
                            disabled={isLastAdmin}
                            title={isLastAdmin ? 'Last admin cannot be demoted' : 'Change role'}
                          >
                            Change Role
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                            onClick={() => handleOpenRemoveDialog(member)}
                            disabled={isSelf || isLastAdmin}
                            title={
                              isSelf
                                ? 'Cannot remove yourself'
                                : isLastAdmin
                                  ? 'Last admin cannot be removed'
                                  : 'Remove member'
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Role Change Modal */}
      {roleTarget && (
        <Modal
          open={isRoleModalOpen}
          onClose={() => setIsRoleModalOpen(false)}
          labelledBy="role-modal-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-space-900 p-6 shadow-2xl space-y-4">
            <h2 id="role-modal-title" className="text-lg font-semibold text-slate-100">
              Change Role: {roleTarget.displayName ?? roleTarget.userId}
            </h2>

            <p className="text-sm text-ink-muted">
              Select the new access role for this household member. Changes take effect immediately.
            </p>

            <SelectField
              id="new-role-select"
              name="newRole"
              label="Select Role"
              value={pendingNewRole}
              onChange={(e) => setPendingNewRole(e.target.value as Role)}
            >
              <option value="READ_ONLY">READ_ONLY (View energy flows and reports)</option>
              <option value="READ_WRITE">READ_WRITE (Create rules, control devices)</option>
              <option value="ADMIN">ADMIN (Full management, members, settings)</option>
            </SelectField>

            {roleTarget.role === 'ADMIN' && pendingNewRole !== 'ADMIN' && adminCount <= 1 && (
              <p className="text-xs text-amber-400 font-medium">
                Warning: This user is the sole administrator. Demoting them is prohibited to prevent
                locking the household.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setIsRoleModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmRoleChange}
                disabled={
                  roleTarget.role === 'ADMIN' && pendingNewRole !== 'ADMIN' && adminCount <= 1
                }
              >
                Save Role
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Remove Member Confirmation Dialog */}
      {removeTarget && (
        <ConfirmDialog
          open={isRemoveDialogOpen}
          title="Remove Member"
          description={`Are you sure you want to remove ${removeTarget.displayName ?? removeTarget.userId} from this household? They will immediately lose access to all telemetry, automation, and site controls.`}
          confirmLabel="Remove Member"
          tone="danger"
          onCancel={() => setIsRemoveDialogOpen(false)}
          onConfirm={handleConfirmRemove}
        />
      )}
    </GlassCard>
  );
}
