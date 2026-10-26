import { useId, useState } from 'react';
import type { Role } from '@autopw3/shared';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/overlays';
import { SelectField, TextField } from '../../components/ui/fields';

export interface InviteMemberModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onInvite: (
    email: string | null,
    role: Role,
    expiresInDays: number,
  ) => Promise<{ link: string; token: string } | null>;
}

export function InviteMemberModal({ isOpen, onClose, onInvite }: InviteMemberModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('READ_ONLY');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<{ link: string; token: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const handleReset = () => {
    setEmail('');
    setRole('READ_ONLY');
    setExpiresInDays(7);
    setGeneratedResult(null);
    setCopied(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await onInvite(email.trim() ? email.trim() : null, role, expiresInDays);
      if (res) {
        setGeneratedResult(res);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedResult) return;
    try {
      await navigator.clipboard.writeText(generatedResult.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard fallback
    }
  };

  const titleId = useId();
  const isShown = isOpen;

  return (
    <Modal open={isShown} onClose={handleReset} labelledBy={titleId}>
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-space-900 p-6 shadow-2xl space-y-4">
        <h2 id={titleId} className="text-lg font-semibold text-slate-100">
          {generatedResult ? 'Invitation Created' : 'Invite Household Member'}
        </h2>

        {generatedResult ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-4 text-sm text-teal-200">
              <p className="font-semibold text-teal-300">Invitation link is ready!</p>
              <p className="mt-1 text-xs text-teal-200/80">
                Share this single-use link with the invitee. The invitation token will not be shown
                again.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-muted">Invitation Link</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  aria-label="Invitation Link"
                  value={generatedResult.link}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none"
                />
                <Button size="sm" variant="secondary" onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy Link'}
                </Button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="primary" onClick={handleReset}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-ink-muted">
              Send an invitation to join this household. The recipient will be granted the assigned
              role upon acceptance.
            </p>

            <TextField
              id="invite-email"
              name="inviteEmail"
              label="Invitee Email (Optional)"
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint="If provided, only this email address will be permitted to accept the invitation."
            />

            <SelectField
              id="invite-role"
              name="inviteRole"
              label="Initial Role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="READ_ONLY">READ_ONLY (View energy flows and reports)</option>
              <option value="READ_WRITE">READ_WRITE (Create rules, control devices)</option>
              <option value="ADMIN">ADMIN (Full household management)</option>
            </SelectField>

            <SelectField
              id="invite-expiry"
              name="inviteExpiry"
              label="Invitation Validity"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
            >
              <option value={1}>24 Hours</option>
              <option value={7}>7 Days (Default)</option>
              <option value={14}>14 Days</option>
              <option value={30}>30 Days</option>
            </SelectField>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={handleReset} disabled={loading}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Invitation'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
