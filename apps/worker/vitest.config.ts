import { defineConfig } from 'vitest/config';

// Worker handlers are plain functions of (Request, Env, ExecutionContext), so TASK-02 tests call
// them directly in Node. A workerd-based pool can be added later if a test needs real bindings.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
