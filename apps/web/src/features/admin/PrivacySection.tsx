import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/display';
import { TextField } from '../../components/ui/fields';
import { ConfirmDialog, Modal } from '../../components/ui/overlays';

export interface PrivacySectionProps {
  readonly householdName: string;
  readonly canAdmin: boolean;
  readonly onExportHousehold: () => Promise<void>;
  readonly onExportAccount: () => Promise<void>;
  readonly onDeleteHousehold: (confirmName: string) => Promise<boolean>;
  readonly onDeleteAccount: () => Promise<boolean>;
  readonly onLeaveHousehold: () => Promise<boolean>;
}

export function PrivacySection({
  householdName,
  canAdmin,
  onExportHousehold,
  onExportAccount,
  onDeleteHousehold,
  onDeleteAccount,
  onLeaveHousehold,
}: PrivacySectionProps) {
  const [isExporting, setIsExporting] = useState(false);

  // Leave Household Dialog
  const [isLeaveOpen, setIsLeaveOpen] = useState(false);

  // Delete Account Dialog
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);

  // Delete Household Modal
  const [isDeleteHouseholdOpen, setIsDeleteHouseholdOpen] = useState(false);
  const [typedConfirmName, setTypedConfirmName] = useState('');
  const [deleteHouseholdError, setDeleteHouseholdError] = useState<string | null>(null);
  const [isDeletingHousehold, setIsDeletingHousehold] = useState(false);

  const handleExportHousehold = async () => {
    setIsExporting(true);
    try {
      await onExportHousehold();
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAccount = async () => {
    setIsExporting(true);
    try {
      await onExportAccount();
    } finally {
      setIsExporting(false);
    }
  };

  const handleConfirmLeave = async () => {
    const ok = await onLeaveHousehold();
    if (ok) {
      setIsLeaveOpen(false);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    const ok = await onDeleteAccount();
    if (ok) {
      setIsDeleteAccountOpen(false);
    }
  };

  const handleConfirmDeleteHousehold = async () => {
    if (typedConfirmName.trim() !== householdName.trim()) {
      setDeleteHouseholdError('Household name does not match.');
      return;
    }
    setIsDeletingHousehold(true);
    try {
      const ok = await onDeleteHousehold(typedConfirmName.trim());
      if (ok) {
        setIsDeleteHouseholdOpen(false);
      }
    } finally {
      setIsDeletingHousehold(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Data Portability Card */}
      <GlassCard title="Data Portability & Export (GDPR Article 20)">
        <p className="text-sm text-ink-muted">
          Under GDPR Article 20, you may export your data in a portable JSON format at any time. All
          exported files are generated directly and sanitized of sensitive tokens or credentials.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {canAdmin && (
            <Button variant="secondary" onClick={handleExportHousehold} disabled={isExporting}>
              Export Household Data (JSON)
            </Button>
          )}

          <Button variant="secondary" onClick={handleExportAccount} disabled={isExporting}>
            Export My Account Data (JSON)
          </Button>
        </div>
      </GlassCard>

      {/* Danger Zone */}
      <GlassCard title="Privacy Operations & Erasure" className="border-rose-500/20">
        <p className="text-sm text-ink-muted">
          Permanent operations for leaving households or exercising the Right to Erasure (GDPR
          Article 17).
        </p>

        <div className="mt-6 divide-y divide-slate-800/80">
          {/* Leave Household */}
          <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Leave Household</h2>
              <p className="text-xs text-ink-muted">
                Relinquish your membership in &quot;{householdName}&quot;. You cannot leave if you
                are the sole administrator.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
              onClick={() => setIsLeaveOpen(true)}
            >
              Leave Household
            </Button>
          </div>

          {/* Delete Account */}
          <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Delete My Account</h2>
              <p className="text-xs text-ink-muted">
                Permanently erase your user profile and remove all your household memberships.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
              onClick={() => setIsDeleteAccountOpen(true)}
            >
              Delete Account
            </Button>
          </div>

          {/* Delete Entire Household (ADMIN only) */}
          {canAdmin && (
            <div className="flex flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-rose-300">Delete Entire Household</h2>
                <p className="text-xs text-rose-200/70">
                  Permanently erase &quot;{householdName}&quot;, including all members, tariffs,
                  automation rules, commands, and telemetry history.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/30"
                onClick={() => {
                  setTypedConfirmName('');
                  setDeleteHouseholdError(null);
                  setIsDeleteHouseholdOpen(true);
                }}
              >
                Delete Household
              </Button>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Leave Household Confirm */}
      <ConfirmDialog
        open={isLeaveOpen}
        title="Leave Household"
        description={`Are you sure you want to leave ${householdName}? You will no longer be able to view or manage energy telemetry for this home.`}
        confirmLabel="Leave Household"
        tone="danger"
        onCancel={() => setIsLeaveOpen(false)}
        onConfirm={handleConfirmLeave}
      />

      {/* Delete Account Confirm */}
      <ConfirmDialog
        open={isDeleteAccountOpen}
        title="Delete Your Account"
        description="Are you sure you want to permanently delete your account? This action is irreversible. If you are the last admin of an active household, you must assign another admin or delete the household first."
        confirmLabel="Permanently Delete Account"
        tone="danger"
        onCancel={() => setIsDeleteAccountOpen(false)}
        onConfirm={handleConfirmDeleteAccount}
      />

      {/* Delete Household Modal (Requires Typing Name) */}
      <Modal
        open={isDeleteHouseholdOpen}
        onClose={() => setIsDeleteHouseholdOpen(false)}
        labelledBy="delete-household-title"
      >
        <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-space-900 p-6 shadow-2xl space-y-4">
          <h2 id="delete-household-title" className="text-lg font-semibold text-rose-300">
            Delete Household
          </h2>

          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            <span className="font-bold">CRITICAL WARNING:</span> This will permanently erase the
            household, disconnect all Tesla credentials, and purge all tariffs, automation rules,
            and telemetry records. This action cannot be undone.
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-300">
              Please type{' '}
              <span className="font-mono font-bold text-slate-100">{householdName}</span> to
              confirm:
            </label>
            <TextField
              id="confirm-household-name"
              name="confirmHouseholdName"
              label="Confirm household name"
              hideLabel
              value={typedConfirmName}
              onChange={(e) => {
                setTypedConfirmName(e.target.value);
                setDeleteHouseholdError(null);
              }}
              placeholder={householdName}
            />
          </div>

          {deleteHouseholdError && (
            <p className="text-xs font-semibold text-rose-400">{deleteHouseholdError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setIsDeleteHouseholdOpen(false)}
              disabled={isDeletingHousehold}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="bg-rose-600 hover:bg-rose-500 text-white"
              onClick={handleConfirmDeleteHousehold}
              disabled={typedConfirmName.trim() !== householdName.trim() || isDeletingHousehold}
            >
              {isDeletingHousehold ? 'Deleting...' : 'Permanently Delete Household'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
