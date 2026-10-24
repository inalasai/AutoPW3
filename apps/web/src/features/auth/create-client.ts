import type { AuthConfig } from '../../lib/config';
import type { AuthClient } from './types';

/**
 * Build the identity adapter the configuration asks for. Adapters are loaded on demand, so demo mode ships
 * neither the Supabase library nor the mock.
 *  - `none` (demo mode): no sign-in, so no client.
 *  - `supabase`: the live adapter.
 *  - `mock`: the in-memory adapter. `import.meta.env.DEV` is a build-time constant, so in a production build the
 *    branch and the dynamic import are removed and the mock is not in the bundle (checked in the handoff).
 *  - `invalid`: throws with the reason, which the start-up screen shows.
 */
export async function createAuthClient(auth: AuthConfig): Promise<AuthClient | null> {
  switch (auth.kind) {
    case 'none':
      return null;
    case 'supabase': {
      const { createSupabaseAuthClient } = await import('./supabase-client');
      return createSupabaseAuthClient({ url: auth.url, anonKey: auth.anonKey });
    }
    case 'mock': {
      if (import.meta.env.DEV) {
        const { createDevMockAuthClient } = await import('./mock/mock-client');
        return createDevMockAuthClient();
      }
      throw new Error('The mock sign-in is available only in a development build.');
    }
    case 'invalid':
      throw new Error(auth.reason);
  }
}
