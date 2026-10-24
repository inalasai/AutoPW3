import { Link, useNavigate } from 'react-router';
import { Button, buttonClasses } from '../../components/ui/Button';
import { useToast } from '../../components/ui/toast';
import { useOptionalAuth } from './AuthProvider';

const ROLE_LABEL = {
  READ_ONLY: 'Read only',
  READ_WRITE: 'Read and write',
  ADMIN: 'Admin',
} as const;

/**
 * Who is signed in and how to sign out, or a "Sign in" link when nobody is. Renders nothing in demo mode, where
 * there is no sign-in, and while the account is loading. The role text is what the server returned.
 * `bar` sits in the header (hidden on narrow screens); `drawer` sits in the mobile menu.
 */
export function AccountControls({
  layout,
  onNavigate,
}: {
  layout: 'bar' | 'drawer';
  /** Called after an action that leaves the page, so the mobile menu can close. */
  onNavigate?: () => void;
}) {
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const toast = useToast();
  if (auth === null) return null;
  const { state, permissions } = auth;

  async function signOut() {
    if (auth === null) return;
    try {
      await auth.signOut();
    } catch {
      toast.push({
        tone: 'error',
        title: 'Could not sign out',
        message: 'Check your connection and try again.',
      });
      return;
    }
    onNavigate?.();
    void navigate('/login', { replace: true });
  }

  if (state.status === 'authorised' || state.status === 'no-household') {
    const email = state.user.email ?? 'Signed in';
    const roleText = permissions.role === null ? 'No household' : ROLE_LABEL[permissions.role];
    if (layout === 'drawer') {
      return (
        <div className="mt-4 grid gap-2 border-t border-line pt-4">
          <p className="break-all text-sm" data-testid="account-email">
            {email}
          </p>
          <p className="font-mono text-xs text-ink-muted" data-testid="account-role">
            {roleText}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3 max-sm:hidden">
        <div className="min-w-0 text-right leading-tight">
          <p className="max-w-48 truncate text-sm" title={email} data-testid="account-email">
            {email}
          </p>
          <p className="font-mono text-xs text-ink-muted" data-testid="account-role">
            {roleText}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </Button>
      </div>
    );
  }

  if (state.status === 'loading') return null;

  return layout === 'drawer' ? (
    <Link
      to="/login"
      className={buttonClasses('secondary', 'md', 'mt-4 w-full')}
      onClick={onNavigate}
    >
      Sign in
    </Link>
  ) : (
    <Link to="/login" className={buttonClasses('secondary', 'sm', 'max-sm:hidden')}>
      Sign in
    </Link>
  );
}
