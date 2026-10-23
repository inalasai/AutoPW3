import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `/api/*` is proxied to the local Worker (`npm run dev:worker`) so the browser uses same-origin
// requests in development as in production. The proxy target is not a secret.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
