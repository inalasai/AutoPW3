import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { permissionsOf, stateFromAccount, stateFromFailure } from './state';
import type { Permissions } from './state';
import { isAuthFailure } from './types';
import type { AuthClient, AuthState } from './types';

export interface AuthContextValue {
  state: AuthState;
  /** Derived from `state`, which holds only what the server returned. */
  permissions: Permissions;
  signIn(email: string, password: string): Promise<void>;
  /** Resolves the same way whether or not the address already has an account. */
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  /** Accepts an invitation as the signed-in person, then reloads the account so the new role appears. */
  acceptInvitation(token: string): Promise<void>;
  /** Try loading the account again after an error. */
  retry(): void;
  /**
   * Called by code that sees the server reject the token (an API answering 401): the session is treated as ended.
   * Later tasks use this from the API client.
   */
  markExpired(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** The auth context, or `null` when sign-in is not in use (demo mode). */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside an AuthProvider');
  return value;
}

/**
 * What the current person may do, as the server reported it. In demo mode (no provider) nobody is signed in and
 * there is no role. This is for showing or disabling controls only: the Worker and the database authorise.
 */
export function usePermissions(): Permissions {
  return useOptionalAuth()?.permissions ?? { role: null, canWrite: false, canAdmin: false };
}

export interface AuthProviderProps {
  client: AuthClient;
  children: ReactNode;
}

/**
 * Holds the auth state machine. Restores the session on start, loads the account (profile and memberships) under
 * the person's own token, and follows sign-in, sign-out and expiry. The role is never read from browser storage.
 */
export function AuthProvider({ client, children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Bumped by every load and by sign-out or expiry, so a slow earlier load cannot overwrite a newer result. */
  const generation = useRef(0);
  /** Greater than zero while an action here is running; its own sign-in event is then not reloaded twice. */
  const busy = useRef(0);

  const sync = useCallback(
    async (quiet = false): Promise<void> => {
      const mine = ++generation.current;
      if (!quiet) setState({ status: 'loading' });
      try {
        const user = await client.getUser();
        if (mine !== generation.current) return;
        if (user === null) {
          setState({ status: 'unauthenticated' });
          return;
        }
        const account = await client.loadAccount(user);
        if (mine !== generation.current) return;
        setState(stateFromAccount(user, account));
      } catch (error) {
        if (mine !== generation.current) return;
        // A background refresh that fails only because the network is down leaves the page as it was.
        if (quiet && !(isAuthFailure(error) && error.kind === 'expired_session')) return;
        setState(stateFromFailure(error));
      }
    },
    [client],
  );

  useEffect(() => {
    void sync();
    return client.subscribe((event) => {
      if (event.type === 'expired') {
        generation.current++;
        setState({ status: 'expired' });
      } else if (event.type === 'signed_out') {
        generation.current++;
        setState({ status: 'unauthenticated' });
      } else if (busy.current === 0) {
        void sync();
      }
    });
  }, [client, sync]);

  // Coming back to the tab re-reads the account, so a removed or changed role shows without a full reload.
  useEffect(() => {
    const onVisible = () => {
      const { status } = stateRef.current;
      if (
        document.visibilityState === 'visible' &&
        (status === 'authorised' || status === 'no-household')
      ) {
        void sync(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync]);

  const value = useMemo<AuthContextValue>(() => {
    async function run(action: () => Promise<void>): Promise<void> {
      busy.current++;
      try {
        await action();
      } finally {
        busy.current--;
      }
    }
    return {
      state,
      permissions: permissionsOf(state),
      signIn: (email, password) =>
        run(async () => {
          await client.signIn(email, password);
          await sync();
        }),
      signUp: (email, password) =>
        run(async () => {
          await client.signUp(email, password);
          // With email confirmation on there is no session yet and this changes nothing.
          await sync(true);
        }),
      signOut: () =>
        run(async () => {
          await client.signOut();
          generation.current++;
          setState({ status: 'unauthenticated' });
        }),
      requestPasswordReset: (email) => client.requestPasswordReset(email),
      updatePassword: (newPassword) => client.updatePassword(newPassword),
      acceptInvitation: (token) =>
        run(async () => {
          await client.acceptInvitation(token);
          await sync(true);
        }),
      retry: () => {
        void sync();
      },
      markExpired: () => {
        generation.current++;
        setState({ status: 'expired' });
      },
    };
  }, [client, state, sync]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
