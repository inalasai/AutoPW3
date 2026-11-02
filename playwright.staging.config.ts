import { defineConfig, devices } from '@playwright/test';

/** Production-built staging UI; every network request is fulfilled or aborted by the fixture. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'staging-tesla.pw.ts',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], trace: 'off', video: 'off', screenshot: 'off' },
});
