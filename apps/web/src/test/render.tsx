import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Role } from '@autopw3/shared';
import { AppFrame } from '../app/App';
import type { EffectsMode } from '../app/effects';
import type { TelemetryConfig } from '../lib/config';
import type { AuthClient } from '../features/auth/types';
import { createMockAuthClient } from '../features/auth/mock/mock-client';
import type { MockAuthClient } from '../features/auth/mock/mock-client';

/** Who is signed in when the app starts: a role, a person with no household, or nobody. */
export type TestAccount = Role | 'NO_HOUSEHOLD' | null;

const ACCOUNT_EMAIL: Record<Role | 'NO_HOUSEHOLD', string> = {
  READ_ONLY: 'readonly@example.test',
  READ_WRITE: 'readwrite@example.test',
  ADMIN: 'admin@example.test',
  NO_HOUSEHOLD: 'nohome@example.test',
};

export interface RenderAppOptions {
  path?: string;
  /** Demo mode (default): no sign-in, every page open. Set `false` for the sign-in behaviour. */
  demoMode?: boolean;
  /** With demo mode off: who is already signed in. `null` means nobody. Default `null`. */
  account?: TestAccount;
  /** With demo mode off: supply your own client, for example one made with `createMockAuthClient`. */
  client?: AuthClient;
  /** `null` leaves the choice to the provider (stored value, then system preference). */
  effects?: EffectsMode | null;
  /** Where the Live View gets readings. Default: demo in demo mode, live (no provider yet) otherwise. */
  telemetry?: TelemetryConfig;
}

/** A mock identity client with one account of each kind, already signed in as `account` (or nobody). */
export function mockClientFor(account: TestAccount): MockAuthClient {
  return createMockAuthClient({
    storage: null,
    ...(account !== null ? { signedInAs: ACCOUNT_EMAIL[account] } : {}),
  });
}

/** Render the whole app (providers, layouts, routes) at a path with a memory router. */
export function renderApp({
  path = '/live',
  demoMode = true,
  account = null,
  client,
  effects = 'on',
  telemetry = { kind: demoMode ? 'demo' : 'live' },
}: RenderAppOptions = {}) {
  const authClient = demoMode ? null : (client ?? mockClientFor(account));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppFrame
        config={{ demoMode, auth: demoMode ? { kind: 'none' } : { kind: 'mock' }, telemetry }}
        authClient={authClient}
        {...(effects !== null ? { initialEffects: effects } : {})}
      />
    </MemoryRouter>,
  );
}
