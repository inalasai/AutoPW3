import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../AuthProvider';
import type { AuthClient } from '../types';
import { TeslaOAuthCallbackPage } from './TeslaOAuthCallbackPage';

const id = '11111111-1111-4111-8111-111111111111';
function client(loggedIn = true): AuthClient {
  return {
    getUser: async () => (loggedIn ? { id, email: null } : null),
    loadAccount: async () => ({
      profile: { userId: id, displayName: null, locale: null },
      memberships: [{ householdId: id, name: 'Fixture', role: 'ADMIN' }],
    }),
    completeTeslaOAuth: vi.fn().mockRejectedValue(new Error('fixture-sensitive-error')),
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    updatePassword: vi.fn(),
    acceptInvitation: vi.fn(),
    subscribe: () => () => undefined,
  };
}
afterEach(() => {
  window.history.replaceState(null, '', '/');
});
describe('staging Tesla browser completion bridge', () => {
  it('completes with the current authenticated account and navigates without exposing the code', async () => {
    window.history.replaceState(
      null,
      '',
      `/auth/tesla/callback#tesla_state=${id}&tesla_code=fixture-code`,
    );
    const auth = client();
    vi.mocked(auth.completeTeslaOAuth!).mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={['/auth/tesla/callback']}>
        <AuthProvider client={auth}>
          <Routes>
            <Route path="/auth/tesla/callback" element={<TeslaOAuthCallbackPage />} />
            <Route path="/settings" element={<p>Connection complete</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText('Connection complete');
    expect(auth.completeTeslaOAuth).toHaveBeenCalledExactlyOnceWith({
      state: id,
      code: 'fixture-code',
    });
    expect(window.location.hash).toBe('');
  });
  it('removes the callback code from history and completes only once even under StrictMode', async () => {
    window.history.replaceState(
      null,
      '',
      `/auth/tesla/callback#tesla_state=${id}&tesla_code=fixture-code`,
    );
    const auth = client();
    render(
      <StrictMode>
        <MemoryRouter>
          <AuthProvider client={auth}>
            <TeslaOAuthCallbackPage />
          </AuthProvider>
        </MemoryRouter>
      </StrictMode>,
    );
    await screen.findByText(/Tesla connection was not completed/);
    expect(auth.completeTeslaOAuth).toHaveBeenCalledExactlyOnceWith({
      state: id,
      code: 'fixture-code',
    });
    expect(window.location.hash).toBe('');
    expect(document.body.textContent).not.toContain('fixture-code');
    expect(document.body.textContent).not.toContain('fixture-sensitive-error');
    expect(window.sessionStorage.length).toBe(0);
  });
  it('cannot complete when the browser is logged out', async () => {
    window.history.replaceState(
      null,
      '',
      `/auth/tesla/callback#tesla_state=${id}&tesla_code=fixture-code`,
    );
    const auth = client(false);
    render(
      <MemoryRouter>
        <AuthProvider client={auth}>
          <TeslaOAuthCallbackPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText(/Tesla connection was not completed/);
    expect(auth.completeTeslaOAuth).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });
  it('does not complete a stale refreshed callback page without its fragment', async () => {
    const auth = client();
    render(
      <MemoryRouter>
        <AuthProvider client={auth}>
          <TeslaOAuthCallbackPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Tesla connection was not completed/)).toBeInTheDocument(),
    );
    expect(auth.completeTeslaOAuth).not.toHaveBeenCalled();
  });
});
