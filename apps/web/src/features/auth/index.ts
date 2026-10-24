/**
 * Authentication and permission-aware UI (TASK-07).
 *
 * Public API for the rest of the app:
 *  - `AuthProvider`, `useAuth`, `useOptionalAuth`, `usePermissions`: the state machine and what the server said about the role.
 *  - `RequireSession`, `RequireRole`, `PublicOnly`: route guards (interface only; the Worker and database authorise).
 *  - `ReadOnlyNotice`, `WriteButton`: READ_ONLY presentation helpers.
 *  - `createAuthClient`: builds the identity adapter chosen by configuration.
 * The in-memory mock adapter lives in `./mock` and is imported only by tests and development builds.
 */
export { AuthProvider, useAuth, useOptionalAuth, usePermissions } from './AuthProvider';
export type { AuthContextValue } from './AuthProvider';
export { AccountControls } from './AccountControls';
export { createAuthClient } from './create-client';
export { PublicOnly, RequireRole, RequireSession } from './guards';
export { extractInvitationToken } from './invitation';
export { failureMessage } from './messages';
export { ReadOnlyNotice, WriteButton } from './permissions';
export { readLoginState, safeReturnPath } from './redirect';
export type { LoginRedirectState } from './redirect';
export { permissionsOf, pickMembership, roleOf, stateFromAccount, stateFromFailure } from './state';
export type { Permissions } from './state';
export { AuthFailure, PASSWORD_MIN_LENGTH, isAuthFailure } from './types';
export type {
  Account,
  AuthClient,
  AuthEvent,
  AuthFailureKind,
  AuthState,
  AuthStatus,
  AuthUser,
} from './types';
export {
  AuthCallbackPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from './pages/AuthPages';
export { NoHouseholdPage, UnauthorisedPage } from './pages/AccessPages';
export { InvitePage } from './pages/InvitePage';
