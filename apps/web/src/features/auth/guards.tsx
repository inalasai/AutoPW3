import { roleAtLeast } from '@autopw3/shared';
import type { Role } from '@autopw3/shared';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorBanner, LoadingRegion, Skeleton } from '../../components/ui/feedback';
import { useOptionalAuth } from './AuthProvider';
import { readLoginState } from './redirect';
import type { LoginRedirectState } from './redirect';
import { NoHouseholdPage, UnauthorisedPage } from './pages/AccessPages';

function LoadingAccount() {
  return (
    <LoadingRegion label="Loading your account" className="grid gap-3">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
    </LoadingRegion>
  );
}

/**
 * Layout route for every page that needs a signed-in person with a household. In demo mode there is no sign-in
 * and it passes through. Otherwise it follows the auth state machine:
 * loading shows a placeholder, signed-out and expired go to `/login` (remembering where the person was going),
 * an error offers a retry, no household shows the "waiting for an invitation" page, and only `authorised` renders the page.
 * This guards the interface only: the Worker and the database refuse unauthorised requests regardless.
 */
export function RequireSession() {
  const auth = useOptionalAuth();
  const location = useLocation();
  if (auth === null) return <Outlet />;

  const { state } = auth;
  switch (state.status) {
    case 'loading':
      return <LoadingAccount />;
    case 'unauthenticated':
    case 'expired': {
      const redirect: LoginRedirectState = {
        from: `${location.pathname}${location.search}`,
        reason: state.status === 'expired' ? 'expired' : 'signed-out',
      };
      return <Navigate to="/login" replace state={redirect} />;
    }
    case 'error':
      return (
        <ErrorBanner
          title="Could not load your account"
          message={state.message}
          onRetry={auth.retry}
        />
      );
    case 'no-household':
      return <NoHouseholdPage />;
    case 'authorised':
      return <Outlet />;
  }
}

/**
 * Layout route that needs at least `minimum` in the household. A person without it sees the "not authorised"
 * page at the same address (no redirect, so the reason is clear). Place it inside `RequireSession`.
 * In demo mode (no sign-in) it passes through, because demo shows every page with synthetic data only.
 */
export function RequireRole({ minimum }: { minimum: Role }) {
  const auth = useOptionalAuth();
  if (auth === null) return <Outlet />;
  const { role } = auth.permissions;
  return role !== null && roleAtLeast(role, minimum) ? <Outlet /> : <UnauthorisedPage />;
}

/**
 * Layout route for sign-in and registration. Someone who is already signed in goes where they were heading
 * (or to the live view) instead of seeing the form again.
 */
export function PublicOnly() {
  const auth = useOptionalAuth();
  const location = useLocation();
  if (auth === null) return <Outlet />;
  switch (auth.state.status) {
    case 'loading':
      return <LoadingAccount />;
    case 'authorised':
    case 'no-household':
      return <Navigate to={readLoginState(location.state).from ?? '/live'} replace />;
    default:
      return <Outlet />;
  }
}
