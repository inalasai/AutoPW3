import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { readConfig } from './src/lib/config';
import { withConnectSrc } from './src/lib/csp';

/**
 * Adds the Supabase origin (from the public `VITE_SUPABASE_URL`) to `connect-src` in the built `_headers`.
 * Demo mode and mock sign-in add nothing. A malformed origin or policy fails the build.
 */
function cspConnectSrc(): Plugin {
  let origin: string | null = null;
  let outDir = '';
  return {
    name: 'autopw3-csp-connect-src',
    apply: 'build',
    configResolved(resolved) {
      const env = loadEnv(
        resolved.mode,
        resolved.envDir === false ? resolved.root : resolved.envDir,
        'VITE_',
      );
      const auth = readConfig(env, { isDev: false }).auth;
      origin = auth.kind === 'supabase' ? auth.url : null;
      outDir = join(resolved.root, resolved.build.outDir);
    },
    closeBundle: {
      order: 'post',
      handler() {
        if (origin === null) return;
        const file = join(outDir, '_headers');
        writeFileSync(file, withConnectSrc(readFileSync(file, 'utf8'), origin));
      },
    },
  };
}

// `/api/*` is proxied to the local Worker (`npm run dev:worker`) so the browser uses same-origin
// requests in development as in production. The proxy target is not a secret.
export default defineConfig({
  plugins: [react(), tailwindcss(), cspConnectSrc()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
