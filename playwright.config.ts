import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests (TASK-07).
 *
 * The web app runs from the Vite dev server with `VITE_DEMO_MODE=false` and `VITE_AUTH_MODE=mock`, which
 * swaps Supabase Auth for the in-memory mock identity provider. Nothing here needs a credential, a network
 * connection to Supabase, or Docker. The mock exists only in development builds.
 *
 * A separate port keeps this run apart from a developer's own `npm run dev` on 5173.
 */
const PORT = 5183;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } },
    },
  ],
  webServer: {
    command: `npm run dev -w @autopw3/web -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_DEMO_MODE: 'false',
      VITE_AUTH_MODE: 'mock',
    },
  },
});
