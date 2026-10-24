import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, buttonClasses } from '../../../components/ui/Button';
import { GlassCard } from '../../../components/ui/display';
import { TextField } from '../../../components/ui/fields';
import { useDocumentTitle } from '../../../app/pages/Page';
import { useOptionalAuth } from '../AuthProvider';
import { extractInvitationToken } from '../invitation';

/**
 * Shown to a signed-in person who belongs to no household yet. They have no access to anything, and the only
 * ways forward are to open an invitation link or to sign out.
 */
export function NoHouseholdPage() {
  useDocumentTitle('Waiting for an invitation');
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = extractInvitationToken(text);
    if (token === null) {
      setError(
        'That does not look like an invitation link or code. Paste the whole link you were sent.',
      );
      document.getElementById('invitation-input')?.focus();
      return;
    }
    setError(undefined);
    void navigate(`/invite/${token}`);
  }

  return (
    <>
      <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
        Waiting for an invitation
      </h1>
      <p className="mb-6 mt-2 max-w-prose text-ink-muted">
        Your account is ready, but it is not part of a household yet, so there is nothing to show. A
        household admin can send you an invitation link. Open it, or paste it below.
      </p>
      <div className="grid max-w-xl gap-4">
        <GlassCard title="Have an invitation?" headingLevel={2}>
          <form className="grid gap-3" onSubmit={onSubmit} noValidate>
            <TextField
              id="invitation-input"
              label="Invitation link or code"
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
              {...(error !== undefined ? { error } : {})}
            />
            <Button type="submit">Continue</Button>
          </form>
        </GlassCard>
        {auth !== null ? (
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                void auth.signOut().then(() => navigate('/login', { replace: true }));
              }}
            >
              Sign out
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Shown when a signed-in person opens a page their role does not allow (for example `/admin`). */
export function UnauthorisedPage() {
  useDocumentTitle('Not authorised');
  return (
    <>
      <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
        Not authorised
      </h1>
      <p className="mb-6 mt-2 max-w-prose text-ink-muted">
        Your role in this household does not allow you to open this page. If you need access, ask a
        household admin.
      </p>
      <Link to="/live" className={buttonClasses('primary', 'md')}>
        Go to Live
      </Link>
    </>
  );
}
