import { useState } from 'react';
import { InvitationTokenSchema } from '@autopw3/shared';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, buttonClasses } from '../../../components/ui/Button';
import { ErrorBanner, LoadingRegion, Skeleton } from '../../../components/ui/feedback';
import { useToast } from '../../../components/ui/toast';
import { useOptionalAuth } from '../AuthProvider';
import { AuthCard, DemoModeSignInNotice } from '../components/AuthCard';
import { failureMessage } from '../messages';
import type { LoginRedirectState } from '../redirect';
import { isAuthFailure } from '../types';

/**
 * Accept an invitation (`/invite/:token`). Opening the link changes nothing: the person signs in if needed and
 * then presses the button. The database function enforces every rule (single use, expiry, email match), and an
 * invalid, expired, used or withdrawn invitation all read the same. The token is never shown on the page.
 */
export function InvitePage() {
  const { token } = useParams();
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth === null) return <DemoModeSignInNotice title="Accept invitation" />;

  const validToken = token !== undefined && InvitationTokenSchema.safeParse(token).success;
  if (!validToken) {
    return (
      <AuthCard title="Accept invitation">
        <div className="grid gap-4">
          <ErrorBanner
            title="Invitation not valid"
            message={failureMessage('invalid_invitation')}
          />
          <Link to="/live" className={buttonClasses('secondary', 'md', 'w-full')}>
            Go to Live
          </Link>
        </div>
      </AuthCard>
    );
  }

  const { state } = auth;
  if (state.status === 'loading') {
    return (
      <AuthCard title="Accept invitation">
        <LoadingRegion label="Checking your account">
          <Skeleton className="h-10 w-full" />
        </LoadingRegion>
      </AuthCard>
    );
  }

  if (state.status === 'unauthenticated' || state.status === 'expired') {
    const back: LoginRedirectState = { from: `/invite/${token}`, reason: 'signed-out' };
    return (
      <AuthCard
        title="Accept invitation"
        description="Sign in, or create an account, to join the household you were invited to."
      >
        <div className="grid gap-3">
          <Link to="/login" state={back} className={buttonClasses('primary', 'md', 'w-full')}>
            Sign in
          </Link>
          <Link to="/register" className={buttonClasses('secondary', 'md', 'w-full')}>
            Create an account
          </Link>
          <p className="text-sm text-ink-muted">
            After you create and confirm an account, open the invitation link again.
          </p>
        </div>
      </AuthCard>
    );
  }

  if (state.status === 'error') {
    return (
      <AuthCard title="Accept invitation">
        <ErrorBanner
          title="Could not check your account"
          message={state.message}
          onRetry={auth.retry}
        />
      </AuthCard>
    );
  }

  async function accept() {
    if (auth === null || token === undefined) return;
    setError(null);
    setSubmitting(true);
    try {
      await auth.acceptInvitation(token);
      toast.push({ tone: 'success', title: 'Invitation accepted' });
      void navigate('/live', { replace: true });
    } catch (failure) {
      setError(failureMessage(isAuthFailure(failure) ? failure.kind : 'unknown'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Accept invitation"
      description="Joining gives you the role the admin chose. Most invitations give read-only access."
    >
      <div className="grid gap-4">
        {error !== null ? (
          <ErrorBanner title="Could not accept the invitation" message={error} />
        ) : null}
        <Button
          loading={submitting}
          onClick={() => {
            void accept();
          }}
        >
          Accept invitation
        </Button>
        <Link to="/live" className={buttonClasses('ghost', 'md', 'w-full')}>
          Not now
        </Link>
      </div>
    </AuthCard>
  );
}
