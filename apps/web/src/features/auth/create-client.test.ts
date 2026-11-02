import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthClient } from './create-client';
import { createSupabaseAuthClient } from './supabase-client';

vi.mock('./supabase-client', () => ({ createSupabaseAuthClient: vi.fn(() => ({})) }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('staging site client construction', () => {
  it.each(['staging', 'production', 'development', 'test'])(
    'enables site operations only in an explicit staging build (%s)',
    async (mode) => {
      vi.stubEnv('MODE', mode);
      await createAuthClient({
        kind: 'supabase',
        url: 'https://fixture.supabase.co',
        anonKey: 'sb_publishable_fixture',
      });
      expect(createSupabaseAuthClient).toHaveBeenCalledExactlyOnceWith(
        { url: 'https://fixture.supabase.co', anonKey: 'sb_publishable_fixture' },
        {
          stagingTeslaOAuthSessionPolicy: mode === 'staging',
          stagingTeslaSites: mode === 'staging',
        },
      );
    },
  );
});
