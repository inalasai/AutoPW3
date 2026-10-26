import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppFrame } from '../../app/App';
import { StartupError } from '../../app/StartupError';
import { expectNoAxeViolations } from '../../test/axe';
import { mockClientFor, renderApp } from '../../test/render';
import { AuthProvider, useAuth } from './AuthProvider';
import {
  MOCK_INVITE_TOKEN,
  MOCK_PASSWORD,
  MOCK_SESSION_STORAGE_KEY,
  createMockAuthClient,
} from './mock/mock-client';
import type { MockAuthClient } from './mock/mock-client';
import { AuthFailure } from './types';
import type { AuthClient } from './types';

afterEach(() => {
  window.localStorage.clear();
  document.title = '';
});

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

/** The same client with some methods replaced, to simulate a server fault. */
function withOverrides(base: MockAuthClient, overrides: Partial<AuthClient>): MockAuthClient {
  return { ...base, ...overrides } as MockAuthClient;
}

async function signInThroughForm(user: UserEvent, email: string, password = MOCK_PASSWORD) {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

function navLabels(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  return within(nav)
    .getAllByRole('link')
    .map((a) => a.textContent ?? '');
}

describe('demo mode', () => {
  it('has no sign-in: the sign-in page says so, and the header has no account controls', async () => {
    renderApp({ path: '/login', demoMode: true });
    expect(await heading('Sign in')).toBeInTheDocument();
    expect(screen.getByText('Sign-in is off in demo mode')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('keeps every write switched off and says so', () => {
    renderApp({ path: '/tariffs', demoMode: true });
    expect(screen.getByRole('button', { name: 'New tariff' })).toBeDisabled();
    expect(screen.getByText('Demo mode: changes are switched off.')).toBeInTheDocument();
  });
});

describe('login and logout', () => {
  it('signs in with a correct email and password and shows the account the server returned', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/login', demoMode: false });
    await heading('Sign in');
    await signInThroughForm(user, 'readonly@example.test');
    expect(await heading('Live')).toBeInTheDocument();
    expect(screen.getByTestId('account-email')).toHaveTextContent('readonly@example.test');
    expect(screen.getByTestId('account-role')).toHaveTextContent('Read only');
  });

  it('gives the same message for a wrong password and for an address with no account', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/login', demoMode: false });
    await heading('Sign in');

    await signInThroughForm(user, 'admin@example.test', 'not-the-password');
    const wrongPassword = (await screen.findByRole('alert')).textContent;

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Password'), 'x');
    await signInThroughForm(user, 'nobody@example.test', 'not-the-password');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('The email or password is not correct.');
    });
    expect(screen.getByRole('alert').textContent).toBe(wrongPassword);
    // Still on the sign-in page, and the password was cleared.
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
  });

  it('asks for the missing fields and moves focus to the first one', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/login', demoMode: false });
    await heading('Sign in');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('says a network failure is a network failure, not a wrong password', async () => {
    const user = userEvent.setup();
    const client = withOverrides(createMockAuthClient({ storage: null }), {
      signIn: () => Promise.reject(new AuthFailure('network')),
    });
    renderApp({ path: '/login', demoMode: false, client });
    await heading('Sign in');
    await signInThroughForm(user, 'admin@example.test');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server');
  });

  it('asks an unconfirmed account to confirm its email first', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient({
      storage: null,
      users: [{ email: 'pending@example.test', confirmed: false }],
    });
    renderApp({ path: '/login', demoMode: false, client });
    await heading('Sign in');
    await signInThroughForm(user, 'pending@example.test');
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirm your email address first');
  });

  it('signs out, returns to the sign-in page, and protects the pages again', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/analytics', demoMode: false, account: 'ADMIN' });
    await heading('Analytics');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await heading('Sign in')).toBeInTheDocument();
    expect(screen.queryByTestId('account-email')).toBeNull();
  });

  it('signs out from the mobile menu too', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/live', demoMode: false, account: 'READ_WRITE' });
    await heading('Live');
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(within(dialog).getByTestId('account-email')).toHaveTextContent('readwrite@example.test');
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    expect(await heading('Sign in')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends someone who is already signed in away from the sign-in page', async () => {
    renderApp({ path: '/login', demoMode: false, account: 'READ_ONLY' });
    expect(await heading('Live')).toBeInTheDocument();
  });

  it('moves focus to the new page title after signing in', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/login', demoMode: false });
    await heading('Sign in');
    await signInThroughForm(user, 'admin@example.test');
    expect(await heading('Live')).toHaveFocus();
  });
});

describe('registration', () => {
  async function fillRegister(
    user: UserEvent,
    email: string,
    password: string,
    confirm = password,
  ) {
    await user.type(screen.getByLabelText('Email'), email);
    await user.type(screen.getByLabelText('Password'), password);
    await user.type(screen.getByLabelText('Confirm password'), confirm);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
  }

  it('creates an account that needs email confirmation and signs nobody in', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient({ storage: null, requireConfirmation: true });
    renderApp({ path: '/register', demoMode: false, client });
    await heading('Create account');
    await fillRegister(user, 'new.person@example.test', 'a-long-password-1');
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(await client.getUser()).toBeNull();
  });

  it('shows the same result for an address that already has an account (no enumeration)', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient({ storage: null, requireConfirmation: true });
    renderApp({ path: '/register', demoMode: false, client });
    await heading('Create account');
    await fillRegister(user, 'admin@example.test', 'a-long-password-1');
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(screen.getByText(/If this address can be registered/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/already/i);
  });

  it('gives a new account no access: it lands on the waiting-for-an-invitation page', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient({ storage: null });
    renderApp({ path: '/register', demoMode: false, client });
    await heading('Create account');
    await fillRegister(user, 'fresh@example.test', 'a-long-password-1');
    expect(await heading('Waiting for an invitation')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Controls' })).toBeNull();
    expect(screen.getByTestId('account-role')).toHaveTextContent('No household');
  });

  it('checks the form before sending anything', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient({ storage: null, requireConfirmation: true });
    renderApp({ path: '/register', demoMode: false, client });
    await heading('Create account');
    await fillRegister(user, 'not-an-email', 'short', 'different');
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 12 characters.', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.queryByText('Check your email')).toBeNull();
  });

  it('shows the server weak-password rule', async () => {
    const user = userEvent.setup();
    const client = withOverrides(createMockAuthClient({ storage: null }), {
      signUp: () => Promise.reject(new AuthFailure('weak_password')),
    });
    renderApp({ path: '/register', demoMode: false, client });
    await heading('Create account');
    await fillRegister(user, 'x@example.test', 'a-long-password-1');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a longer or less common password',
    );
  });
});

describe('session restoration', () => {
  it('opens straight onto the page when a session already exists', async () => {
    renderApp({ path: '/analytics', demoMode: false, account: 'READ_WRITE' });
    expect(await heading('Analytics')).toBeInTheDocument();
  });

  it('restores the session after the page is reloaded, from what the library stored', async () => {
    const user = userEvent.setup();
    const first = createMockAuthClient({ storage: window.localStorage });
    const view = renderApp({ path: '/login', demoMode: false, client: first });
    await heading('Sign in');
    await signInThroughForm(user, 'readwrite@example.test');
    await heading('Live');
    view.unmount();

    // A new page load: a new client reading the same storage.
    renderApp({
      path: '/tariffs',
      demoMode: false,
      client: createMockAuthClient({ storage: window.localStorage }),
    });
    expect(await heading('Tariffs')).toBeInTheDocument();
    expect(screen.getByTestId('account-role')).toHaveTextContent('Read and write');
  });

  it('shows a loading state while the account loads, not the protected page', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = mockClientFor('ADMIN');
    const client = withOverrides(base, {
      loadAccount: async (user) => {
        await gate;
        return base.loadAccount(user);
      },
    });
    renderApp({ path: '/admin', demoMode: false, client });
    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent(
      'Loading your account',
    );
    expect(screen.queryByRole('heading', { level: 1, name: 'Admin' })).toBeNull();
    release();
    expect(await heading('Admin')).toBeInTheDocument();
  });
});

describe('protected routes', () => {
  it.each(['/live', '/analytics', '/tariffs', '/controls', '/automation', '/settings', '/admin'])(
    'sends a signed-out visitor from %s to the sign-in page',
    async (path) => {
      renderApp({ path, demoMode: false, account: null });
      expect(await heading('Sign in')).toBeInTheDocument();
    },
  );

  it('returns to the page that was asked for after signing in', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/tariffs', demoMode: false, account: null });
    await heading('Sign in');
    await signInThroughForm(user, 'readwrite@example.test');
    expect(await heading('Tariffs')).toBeInTheDocument();
  });

  it('shows the public pages without signing in', async () => {
    renderApp({ path: '/forgot-password', demoMode: false, account: null });
    expect(await heading('Reset your password')).toBeInTheDocument();
  });

  it('shows the not-found page to a signed-out visitor without revealing what exists', async () => {
    renderApp({ path: '/no-such-page', demoMode: false, account: null });
    expect(await heading('Page not found')).toBeInTheDocument();
  });
});

describe('role-aware navigation and READ_ONLY presentation', () => {
  it('READ_ONLY: sees the pages but not Admin, and writes are disabled with an explanation', async () => {
    renderApp({ path: '/tariffs', demoMode: false, account: 'READ_ONLY' });
    await heading('Tariffs');
    expect(navLabels()).toEqual([
      'Live',
      'Analytics',
      'Tariffs',
      'Controls',
      'Automation',
      'Settings',
    ]);
    const button = screen.getByRole('button', { name: 'New tariff' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Read-only access: you cannot make changes.');
    expect(screen.getByText('You have read-only access')).toBeInTheDocument();
    expect(screen.getByText(/The server checks this too/)).toBeInTheDocument();
  });

  it('READ_ONLY: the controls page explains that commands are unavailable', async () => {
    renderApp({ path: '/controls', demoMode: false, account: 'READ_ONLY' });
    await heading('Controls');
    expect(screen.getByText(/cannot send commands/)).toBeInTheDocument();
  });

  it('READ_WRITE: writes are enabled, there is no read-only notice, and Admin is hidden', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/tariffs', demoMode: false, account: 'READ_WRITE' });
    await heading('Tariffs');
    expect(navLabels()).not.toContain('Admin');
    expect(screen.queryByText('You have read-only access')).toBeNull();
    const button = screen.getByRole('button', { name: 'New tariff' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(await screen.findByRole('heading', { level: 2, name: 'New Tariff' })).toBeInTheDocument();
  });

  it('ADMIN: sees Admin in the navigation and can open it', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/live', demoMode: false, account: 'ADMIN' });
    await heading('Live');
    expect(navLabels()).toContain('Admin');
    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
        name: 'Admin',
      }),
    );
    expect(await heading('Admin')).toBeInTheDocument();
    expect(screen.getByTestId('account-role')).toHaveTextContent('Admin');
  });
});

describe('unauthorised direct access', () => {
  it.each(['READ_ONLY', 'READ_WRITE'] as const)(
    '%s who types /admin sees "Not authorised" and none of the admin page',
    async (account) => {
      renderApp({ path: '/admin', demoMode: false, account });
      expect(await heading('Not authorised')).toBeInTheDocument();
      expect(screen.queryByText('Members')).toBeNull();
      expect(screen.queryByRole('heading', { level: 1, name: 'Admin' })).toBeNull();
      await waitFor(() => expect(document.title).toBe('Not authorised - AutoPW3'));
      expect(screen.getByRole('link', { name: 'Go to Live' })).toHaveAttribute('href', '/live');
    },
  );

  it('a person with no household sees the waiting page at /admin, not the admin page', async () => {
    renderApp({ path: '/admin', demoMode: false, account: 'NO_HOUSEHOLD' });
    expect(await heading('Waiting for an invitation')).toBeInTheDocument();
    expect(screen.queryByText('Members')).toBeNull();
  });

  it('a signed-out visitor at /admin is sent to sign in', async () => {
    renderApp({ path: '/admin', demoMode: false, account: null });
    expect(await heading('Sign in')).toBeInTheDocument();
  });
});

describe('expired session', () => {
  it('sends the person to sign in with an explanation when the session ends while they are on a page', async () => {
    const client = mockClientFor('ADMIN');
    renderApp({ path: '/analytics', demoMode: false, client });
    await heading('Analytics');
    act(() => {
      client.expireSession();
    });
    expect(await heading('Sign in')).toBeInTheDocument();
    expect(screen.getByText('Your session has ended')).toBeInTheDocument();
  });

  it('treats a token the server refuses at start-up as expired', async () => {
    const client = withOverrides(mockClientFor('ADMIN'), {
      loadAccount: () => Promise.reject(new AuthFailure('expired_session')),
    });
    renderApp({ path: '/live', demoMode: false, client });
    expect(await heading('Sign in')).toBeInTheDocument();
    expect(screen.getByText('Your session has ended')).toBeInTheDocument();
  });

  it('returns to the page they were on after signing in again', async () => {
    const user = userEvent.setup();
    const client = mockClientFor('READ_WRITE');
    renderApp({ path: '/tariffs', demoMode: false, client });
    await heading('Tariffs');
    act(() => {
      client.expireSession();
    });
    await heading('Sign in');
    await signInThroughForm(user, 'readwrite@example.test');
    expect(await heading('Tariffs')).toBeInTheDocument();
  });

  it('lets code that sees a 401 end the session with markExpired', async () => {
    let expire: () => void = () => undefined;
    function Probe() {
      const auth = useAuth();
      expire = auth.markExpired;
      return <p>status: {auth.state.status}</p>;
    }
    const client = mockClientFor('ADMIN');
    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('status: authorised')).toBeInTheDocument();
    act(() => {
      expire();
    });
    expect(screen.getByText('status: expired')).toBeInTheDocument();
  });
});

describe('failures loading the account', () => {
  it('shows a retryable error, not a blank page, and recovers on retry', async () => {
    const user = userEvent.setup();
    const base = mockClientFor('READ_ONLY');
    let failing = true;
    const client = withOverrides(base, {
      loadAccount: (u) =>
        failing ? Promise.reject(new AuthFailure('network')) : base.loadAccount(u),
    });
    renderApp({ path: '/live', demoMode: false, client });
    expect(await screen.findByText('Could not load your account')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Live' })).toBeNull();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await heading('Live')).toBeInTheDocument();
  });

  it('does not show a role it could not confirm', async () => {
    const client = withOverrides(mockClientFor('ADMIN'), {
      loadAccount: () => Promise.reject(new AuthFailure('unknown')),
    });
    renderApp({ path: '/admin', demoMode: false, client });
    expect(await screen.findByText('Could not load your account')).toBeInTheDocument();
    expect(screen.queryByTestId('account-role')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });
});

describe('browser state cannot grant permission', () => {
  const TAMPER: Record<string, string> = {
    role: 'ADMIN',
    userRole: 'ADMIN',
    'autopw3.role': 'ADMIN',
    'autopw3.permissions': JSON.stringify({ role: 'ADMIN', canAdmin: true }),
    'supabase.auth.token': JSON.stringify({
      user: { app_metadata: { role: 'ADMIN' }, user_metadata: { role: 'ADMIN' } },
    }),
  };

  it('a READ_ONLY person who writes ADMIN into local storage is still READ_ONLY (acceptance test)', async () => {
    const user = userEvent.setup();
    const first = createMockAuthClient({ storage: window.localStorage });
    const view = renderApp({ path: '/login', demoMode: false, client: first });
    await heading('Sign in');
    await signInThroughForm(user, 'readonly@example.test');
    await heading('Live');
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();

    // The person edits browser state in every way they can think of, then reloads.
    for (const [key, value] of Object.entries(TAMPER)) window.localStorage.setItem(key, value);
    window.sessionStorage.setItem('role', 'ADMIN');
    view.unmount();

    renderApp({
      path: '/admin',
      demoMode: false,
      client: createMockAuthClient({ storage: window.localStorage }),
    });
    expect(await heading('Not authorised')).toBeInTheDocument();
    expect(screen.queryByText('Members')).toBeNull();
    expect(screen.getByTestId('account-role')).toHaveTextContent('Read only');
    expect(navLabels()).not.toContain('Admin');
    window.sessionStorage.clear();
  });

  it('keeps writes disabled for a READ_ONLY person whatever the browser says', async () => {
    for (const [key, value] of Object.entries(TAMPER)) window.localStorage.setItem(key, value);
    renderApp({ path: '/tariffs', demoMode: false, account: 'READ_ONLY' });
    await heading('Tariffs');
    expect(screen.getByRole('button', { name: 'New tariff' })).toBeDisabled();
  });

  it('a stored session token whose user was swapped for an admin is not a session', async () => {
    const admin = createMockAuthClient({ storage: null, signedInAs: 'admin@example.test' });
    const adminId = (await admin.getUser())?.id ?? '';
    // Hand-written token for the admin account, without the checksum the "server" would have made.
    window.localStorage.setItem(MOCK_SESSION_STORAGE_KEY, `mock.${adminId}.00000000`);
    renderApp({
      path: '/admin',
      demoMode: false,
      client: createMockAuthClient({ storage: window.localStorage }),
    });
    expect(await heading('Sign in')).toBeInTheDocument();
  });

  it('shows a role change made on the server the next time the tab is used, with no reload', async () => {
    const client = mockClientFor('READ_WRITE');
    renderApp({ path: '/tariffs', demoMode: false, client });
    await heading('Tariffs');
    expect(screen.getByRole('button', { name: 'New tariff' })).toBeEnabled();
    client.setRole('readwrite@example.test', 'READ_ONLY');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New tariff' })).toBeDisabled();
    });
    expect(screen.getByTestId('account-role')).toHaveTextContent('Read only');
  });
});

describe('no household and invitations', () => {
  it('shows a clear waiting screen with an invitation entry point and a way to sign out', async () => {
    renderApp({ path: '/live', demoMode: false, account: 'NO_HOUSEHOLD' });
    expect(await heading('Waiting for an invitation')).toBeInTheDocument();
    expect(screen.getByLabelText('Invitation link or code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign out' }).length).toBeGreaterThan(0);
  });

  it('refuses text that is not an invitation, and says where to look', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/live', demoMode: false, account: 'NO_HOUSEHOLD' });
    await heading('Waiting for an invitation');
    await user.type(screen.getByLabelText('Invitation link or code'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/does not look like an invitation/)).toBeInTheDocument();
    expect(screen.getByLabelText('Invitation link or code')).toHaveFocus();
  });

  it('joins a household from a pasted link and then sees the role the invitation gave', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/live', demoMode: false, account: 'NO_HOUSEHOLD' });
    await heading('Waiting for an invitation');
    await user.type(
      screen.getByLabelText('Invitation link or code'),
      `https://app.example/invite/${MOCK_INVITE_TOKEN}`,
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await heading('Accept invitation');
    expect(document.body).not.toHaveTextContent(MOCK_INVITE_TOKEN);
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await heading('Live')).toBeInTheDocument();
    expect(screen.getByTestId('account-role')).toHaveTextContent('Read only');
    expect(navLabels()).not.toContain('Admin');
  });

  it('opens the invitation link directly for a signed-in person', async () => {
    const user = userEvent.setup();
    renderApp({ path: `/invite/${MOCK_INVITE_TOKEN}`, demoMode: false, account: 'NO_HOUSEHOLD' });
    await heading('Accept invitation');
    // Opening the link changes nothing until the person chooses to accept.
    expect(screen.queryByRole('heading', { level: 1, name: 'Live' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await heading('Live')).toBeInTheDocument();
  });

  it('gives one message for an invitation that is used, unknown or withdrawn', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient({
      storage: null,
      signedInAs: 'nohome@example.test',
      invitations: [{ token: MOCK_INVITE_TOKEN }],
    });
    renderApp({ path: `/invite/${'cd'.repeat(32)}`, demoMode: false, client });
    await heading('Accept invitation');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    const unknown = (await screen.findByRole('alert')).textContent;
    expect(unknown).toContain('This invitation is not valid');
  });

  it('refuses a link with a malformed token without calling the server', async () => {
    renderApp({ path: '/invite/not-a-token', demoMode: false, account: 'READ_ONLY' });
    expect(await heading('Accept invitation')).toBeInTheDocument();
    expect(screen.getByText('Invitation not valid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
  });

  it('asks a signed-out visitor to sign in first, then brings them back to the invitation', async () => {
    const user = userEvent.setup();
    renderApp({ path: `/invite/${MOCK_INVITE_TOKEN}`, demoMode: false, account: null });
    await heading('Accept invitation');
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await heading('Sign in');
    await signInThroughForm(user, 'nohome@example.test');
    expect(await heading('Accept invitation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeInTheDocument();
  });
});

describe('password reset', () => {
  it('shows the same confirmation for an address with an account and one without', async () => {
    const user = userEvent.setup();
    const client = createMockAuthClient({ storage: null });
    const view = renderApp({ path: '/forgot-password', demoMode: false, client });
    await heading('Reset your password');
    await user.type(screen.getByLabelText('Email'), 'admin@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    const known = (await screen.findByText(/If an account exists/)).textContent;
    view.unmount();

    renderApp({ path: '/forgot-password', demoMode: false, client });
    await heading('Reset your password');
    await user.type(screen.getByLabelText('Email'), 'nobody@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect((await screen.findByText(/If an account exists/)).textContent).toBe(known);
    expect(client.resetRequests).toEqual(['admin@example.test', 'nobody@example.test']);
  });

  it('checks the address before sending', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/forgot-password', demoMode: false, account: null });
    await heading('Reset your password');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('reports a rate limit, which says nothing about the address', async () => {
    const user = userEvent.setup();
    const client = withOverrides(createMockAuthClient({ storage: null }), {
      requestPasswordReset: () => Promise.reject(new AuthFailure('rate_limited')),
    });
    renderApp({ path: '/forgot-password', demoMode: false, client });
    await heading('Reset your password');
    await user.type(screen.getByLabelText('Email'), 'admin@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('lets a person who followed the emailed link choose a new password', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/reset-password', demoMode: false, account: 'READ_WRITE' });
    await heading('Choose a new password');
    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    expect(await heading('Live')).toBeInTheDocument();
  });

  it('checks the new password before sending it', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/reset-password', demoMode: false, account: 'READ_WRITE' });
    await heading('Choose a new password');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'other');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveFocus();
  });

  it('explains an invalid or expired reset link', async () => {
    renderApp({ path: '/reset-password', demoMode: false, account: null });
    await heading('Choose a new password');
    expect(await screen.findByText('This reset link is not valid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

describe('email confirmation link', () => {
  it('signs a confirmed person in and goes to the live view', async () => {
    renderApp({ path: '/auth/callback', demoMode: false, account: 'READ_ONLY' });
    expect(await heading('Live')).toBeInTheDocument();
  });

  it('explains a link that did not sign anyone in', async () => {
    renderApp({ path: '/auth/callback', demoMode: false, account: null });
    expect(await screen.findByText('We could not sign you in from this link')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });
});

describe('start-up error', () => {
  it('shows the configuration problem instead of an app that cannot sign anyone in', () => {
    render(<StartupError message="Sign-in is not configured. Set VITE_SUPABASE_URL." />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'AutoPW3 cannot start' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_SUPABASE_URL');
  });
});

describe('accessibility (axe)', () => {
  const pages: Array<[string, string, Parameters<typeof renderApp>[0]]> = [
    ['sign in', '/login', { account: null }],
    ['create account', '/register', { account: null }],
    ['forgot password', '/forgot-password', { account: null }],
    ['reset link not valid', '/reset-password', { account: null }],
    ['reset password form', '/reset-password', { account: 'READ_WRITE' }],
    ['callback that failed', '/auth/callback', { account: null }],
    ['waiting for an invitation', '/live', { account: 'NO_HOUSEHOLD' }],
    ['accept invitation (signed in)', `/invite/${MOCK_INVITE_TOKEN}`, { account: 'NO_HOUSEHOLD' }],
    ['accept invitation (signed out)', `/invite/${MOCK_INVITE_TOKEN}`, { account: null }],
    ['invitation not valid', '/invite/nope', { account: 'READ_ONLY' }],
    ['not authorised', '/admin', { account: 'READ_ONLY' }],
    ['read-only tariffs', '/tariffs', { account: 'READ_ONLY' }],
    ['read-only controls', '/controls', { account: 'READ_ONLY' }],
    ['admin', '/admin', { account: 'ADMIN' }],
  ];

  it.each(pages)('%s has no violations', async (_name, path, options) => {
    const { container } = renderApp({ path, demoMode: false, ...options });
    // The loading placeholder has no level-1 heading, so this waits for the real page.
    await screen.findByRole('heading', { level: 1 });
    await expectNoAxeViolations(container, { landmarks: true });
  });

  it('a sign-in form with errors has no violations', async () => {
    const user = userEvent.setup();
    const { container } = renderApp({ path: '/login', demoMode: false, account: null });
    await heading('Sign in');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await expectNoAxeViolations(container, { landmarks: true });
  });

  it('the mobile menu with account controls has no violations', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/live', demoMode: false, account: 'ADMIN' });
    await heading('Live');
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await expectNoAxeViolations(screen.getByRole('dialog', { name: 'Menu' }));
  });
});

describe('AppFrame without a client', () => {
  it('renders in demo mode with no sign-in provider at all', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AppFrame
          config={{ demoMode: true, auth: { kind: 'none' }, telemetry: { kind: 'demo' } }}
        />
      </MemoryRouter>,
    );
    expect(await heading('Admin')).toBeInTheDocument();
  });
});
