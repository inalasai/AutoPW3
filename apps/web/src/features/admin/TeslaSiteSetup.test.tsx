import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { MOCK_HOUSEHOLD_ID, MOCK_PASSWORD } from '../auth/mock/mock-client';
import { createSupabaseAuthClient } from '../auth/supabase-client';
import { TeslaSiteFailure } from '../auth/tesla-sites';
import { mockClientFor, renderApp } from '../../test/render';
import { TeslaSiteSetup } from './TeslaSiteSetup';

const first = { providerSiteId: '123456789', name: 'Tesla supplied name' };
const second = { providerSiteId: '987654321', name: null };
const persisted = {
  created: true,
  site: {
    id: '22222222-2222-4222-8222-222222222222',
    householdId: MOCK_HOUSEHOLD_ID,
    provider: 'TESLA' as const,
    ...first,
    name: 'Persisted Tesla name',
    timezone: 'Europe/Dublin',
    connectionState: 'CONNECTING' as const,
  },
};
function setup(role: 'ADMIN' | 'READ_ONLY' | 'READ_WRITE' = 'ADMIN', loggedIn = true) {
  const base = mockClientFor(loggedIn ? role : null);
  const discover = vi.fn().mockResolvedValue({ items: [first, second] });
  const link = vi.fn().mockResolvedValue(persisted);
  const client = { ...base, teslaSites: { discover, link } };
  const view = render(
    <AuthProvider client={client}>
      <TeslaSiteSetup />
    </AuthProvider>,
  );
  return { ...view, base, client, discover, link };
}
async function choose(id = first.providerSiteId) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Find Tesla energy sites' }));
  await user.selectOptions(await screen.findByLabelText('Authorized Tesla energy site'), id);
  return user;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('staging Settings Tesla site onboarding', () => {
  it('makes no automatic provider request and never claims a demo ACTIVE connection', async () => {
    const { discover, link } = setup();
    await screen.findByRole('button', { name: 'Find Tesla energy sites' });
    expect(discover).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
    expect(screen.queryByText('Tesla Fleet API Connected')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('energy_cmds');
  });

  it('shows discovered names/IDs and the actual persisted result only after linking', async () => {
    const { base, discover, link } = setup();
    const user = await choose();
    expect(
      screen.getByRole('option', { name: `Name not provided — ${second.providerSiteId}` }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Persisted site:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Link selected site' }));
    await screen.findByText('Tesla energy site linked.');
    expect(screen.getByText(`Persisted site: ${persisted.site.id}`)).toBeInTheDocument();
    expect(screen.getByText(/Persisted Tesla name/)).toBeInTheDocument();
    expect(screen.getByText(/Connection state: CONNECTING/)).toBeInTheDocument();
    const current = await base.getUser();
    expect(discover.mock.calls[0]?.[0]).toEqual({
      userId: current?.id,
      householdId: MOCK_HOUSEHOLD_ID,
    });
    expect(link.mock.calls[0]?.[0]).toEqual({
      userId: current?.id,
      householdId: MOCK_HOUSEHOLD_ID,
    });
    expect(link.mock.calls[0]?.[1]).toBe(first.providerSiteId);
    expect(link.mock.calls[0]?.[2]).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(screen.getByRole('button', { name: 'Link selected site' })).toBeDisabled();
  });

  it('keeps the same key after an ambiguous link error, then displays the duplicate result', async () => {
    const { link } = setup();
    link
      .mockRejectedValueOnce(new TeslaSiteFailure('unavailable'))
      .mockResolvedValueOnce({ ...persisted, created: false });
    const user = await choose();
    await user.click(screen.getByRole('button', { name: 'Link selected site' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Retry linking to check the same operation safely/,
    );
    await user.click(screen.getByRole('button', { name: 'Retry linking site' }));
    await screen.findByText('This Tesla energy site was already linked.');
    expect(link).toHaveBeenCalledTimes(2);
    expect(link.mock.calls[1]?.[2]).toBe(link.mock.calls[0]?.[2]);
    expect(link.mock.calls[1]?.[1]).toBe(first.providerSiteId);
  });

  it('uses a new key for an explicitly changed selection and blocks overlapping submissions', async () => {
    const { link } = setup();
    let finish: ((value: typeof persisted) => void) | undefined;
    link.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = await choose();
    await user.dblClick(screen.getByRole('button', { name: 'Link selected site' }));
    expect(link).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Authorized Tesla energy site')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Find Tesla energy sites' })).toBeDisabled();
    await act(async () => {
      finish?.(persisted);
    });
    await user.selectOptions(
      screen.getByLabelText('Authorized Tesla energy site'),
      second.providerSiteId,
    );
    link.mockResolvedValue({
      ...persisted,
      site: { ...persisted.site, providerSiteId: second.providerSiteId },
    });
    await user.click(screen.getByRole('button', { name: 'Link selected site' }));
    await screen.findByText('Tesla energy site linked.');
    expect(link.mock.calls[1]?.[2]).not.toBe(link.mock.calls[0]?.[2]);
  });

  it('shows empty results without inventing sites or offering a link', async () => {
    const { discover } = setup();
    discover.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find Tesla energy sites' }));
    await screen.findByText('No Tesla energy sites were returned for this account.');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it.each(['READ_ONLY', 'READ_WRITE'] as const)(
    'does not offer discovery or linking to %s members',
    async (role) => {
      const { discover, link } = setup(role);
      await screen.findByText(/A current household ADMIN/);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(discover).not.toHaveBeenCalled();
      expect(link).not.toHaveBeenCalled();
    },
  );

  it('does not request data when signed out', async () => {
    const { discover } = setup('ADMIN', false);
    await screen.findByText(/Sign in to manage/);
    expect(discover).not.toHaveBeenCalled();
  });

  it('treats API 401 as session expiry rather than falling back to demo', async () => {
    const { discover } = setup();
    discover.mockRejectedValue(new TeslaSiteFailure('expired_session'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find Tesla energy sites' }));
    await screen.findByText(/Sign in to manage/);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Tesla Fleet API Connected')).not.toBeInTheDocument();
  });

  it.each([
    'forbidden',
    'conflict',
    'rate_limited',
    'invalid_request',
    'invalid_response',
    'unavailable',
  ] as const)('handles %s without disclosing raw server errors', async (kind) => {
    const { discover } = setup();
    discover.mockRejectedValue(new TeslaSiteFailure(kind));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find Tesla energy sites' }));
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('never renders or logs unknown exception messages', async () => {
    const logs = ['log', 'warn', 'error', 'info', 'debug'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined),
    );
    const { discover } = setup();
    discover.mockRejectedValue(new Error('fixture-sensitive-provider-details'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find Tesla energy sites' }));
    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain('fixture-sensitive-provider-details');
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it.each(['reauthorization_required', 'recovery_required'] as const)(
    'stops rediscovery and shows explicit %s without signing out',
    async (kind) => {
      const { discover, link } = setup();
      discover.mockRejectedValue(new TeslaSiteFailure(kind));
      const user = userEvent.setup();
      const find = await screen.findByRole('button', { name: 'Find Tesla energy sites' });
      await user.click(find);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        kind === 'reauthorization_required' ? /explicitly reconnect Tesla/ : /uncertain outcome/,
      );
      expect(find).toBeDisabled();
      await user.click(find);
      expect(discover).toHaveBeenCalledOnce();
      expect(link).not.toHaveBeenCalled();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByText(/Sign in to manage/)).not.toBeInTheDocument();
    },
  );

  it('aborts and ignores late results after logout', async () => {
    const { base, discover, link } = setup();
    let finish: ((value: { items: (typeof first)[] }) => void) | undefined;
    discover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find Tesla energy sites' }));
    const signal = discover.mock.calls[0]?.[1] as AbortSignal;
    await act(async () => {
      await base.signOut();
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish?.({ items: [first] });
    });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(link).not.toHaveBeenCalled();
  });

  it('ignores an old linking result after account switching and clears the old selection', async () => {
    const { base, link } = setup();
    base.setRole('readwrite@example.test', 'ADMIN');
    let finish: ((value: typeof persisted) => void) | undefined;
    link.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = await choose();
    await user.click(screen.getByRole('button', { name: 'Link selected site' }));
    const signal = link.mock.calls[0]?.[3] as AbortSignal;
    await act(async () => {
      await base.signIn('readwrite@example.test', MOCK_PASSWORD);
    });
    await waitFor(() => {
      expect(signal.aborted).toBe(true);
    });
    await act(async () => {
      finish?.(persisted);
    });
    expect(screen.queryByText(/Persisted site:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('drops pending results when current ADMIN authority is revoked', async () => {
    const { base, discover } = setup();
    let finish: ((value: { items: (typeof first)[] }) => void) | undefined;
    discover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Find Tesla energy sites' }));
    base.setRole('admin@example.test', 'READ_ONLY');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await screen.findByText(/A current household ADMIN/);
    await act(async () => {
      finish?.({ items: [first] });
    });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('aborts old household discovery and clears its selection after a household change', async () => {
    const { base, client, discover } = setup();
    const user = await choose();
    let finish: ((value: { items: (typeof first)[] }) => void) | undefined;
    discover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Find Tesla energy sites' }));
    const signal = discover.mock.calls[1]?.[1] as AbortSignal;
    const current = await base.getUser();
    const account = await base.loadAccount(current!);
    client.loadAccount = async () => ({
      ...account,
      memberships: [
        {
          householdId: '33333333-3333-4333-8333-333333333333',
          name: 'Other household',
          role: 'ADMIN',
        },
      ],
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => {
      expect(signal.aborted).toBe(true);
    });
    await act(async () => {
      finish?.({ items: [first] });
    });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(/Other household/)).toBeInTheDocument();
  });

  it('integrates Settings with the private adapter, without legacy Tesla status or control calls', async () => {
    const base = mockClientFor('ADMIN');
    const current = await base.getUser();
    const privateToken = 'fixture-internal-browser-token';
    const { teslaSites } = createSupabaseAuthClient(
      { url: 'https://fixture.supabase.co', anonKey: 'sb_publishable_fixture' },
      {
        stagingTeslaSites: true,
        origin: 'https://staging.example',
        client: {
          auth: {
            getSession: async () => ({
              data: { session: { user: current, access_token: privateToken } },
              error: null,
            }),
          },
        } as unknown as SupabaseClient,
      },
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/provider/tesla/discovered-sites'))
        return new Response(JSON.stringify({ items: [first] }));
      if (url.endsWith('/sites') && init?.method === 'POST')
        return new Response(JSON.stringify(persisted), { status: 201 });
      return new Response('{}', { status: 502 }); // Other staging API routes remain fail-closed.
    });
    vi.stubGlobal('fetch', fetcher);
    renderApp({ path: '/settings', demoMode: false, client: { ...base, teslaSites: teslaSites! } });
    const user = await choose();
    await user.click(screen.getByRole('button', { name: 'Link selected site' }));
    await screen.findByText(`Persisted site: ${persisted.site.id}`);
    expect(screen.queryByText('Tesla Fleet API Connected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect Tesla' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(privateToken);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).not.toMatch(
        /\/provider\/tesla$|\/commands|\/live_status|\/connect|\/callback/,
      );
      if (String(url).startsWith('https://staging.example/')) {
        expect(init?.headers).toMatchObject({ authorization: `Bearer ${privateToken}` });
      }
    }
  });
});
