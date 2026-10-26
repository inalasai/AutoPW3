import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Coverage is measured on demand (`npm run test:coverage -w @autopw3/domain`), not in `npm test`.
    // It is reported for the tariff engine only (TASK-10); other domain modules are not measured yet.
    coverage: {
      provider: 'v8',
      include: ['src/tariff/**/*.ts', 'src/accounting/**/*.ts'],
      exclude: [
        'src/tariff/**/*.test.ts',
        'src/tariff/test-helpers.ts',
        'src/accounting/**/*.test.ts',
        'src/accounting/test-helpers.ts',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
});
