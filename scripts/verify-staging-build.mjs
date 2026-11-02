import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { loadEnv } from 'vite';
import { readConfig } from '../apps/web/src/lib/config.ts';

const root = resolve('apps/web');
const env = loadEnv('staging', root, 'VITE_');
const config = readConfig(env, { isDev: false });
assert.equal(config.demoMode, false);
assert.equal(config.auth.kind, 'supabase');
assert.equal(config.auth.url, new URL(env['VITE_SUPABASE_URL']).origin);
assert.equal(config.auth.anonKey, env['VITE_SUPABASE_ANON_KEY'].trim());
assert.equal(config.telemetry.kind, 'demo');
assert.ok(!Object.keys(env).some((key) => /SECRET|PASSWORD|ENCRYPTION|PRIVATE_KEY/.test(key)));
const dist = join(root, 'dist');
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else files.push(file);
  }
}
walk(dist);
const javascript = files
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
assert.ok(
  /["'`]?MODE["'`]?\s*:\s*["'`]staging["'`]/.test(javascript),
  'Compiled staging mode missing',
);
assert.ok(javascript.includes(config.auth.url));
assert.ok(javascript.includes(config.auth.anonKey));
assert.ok(/stagingTeslaSites:(?:!0|true)/.test(javascript), 'Compiled site setup gate missing');
assert.ok(files.some((file) => /TeslaOAuthCallbackPage.*\.js$/.test(file)));
assert.ok(!files.some((file) => /mock-client|ComponentCatalogue/.test(file)));
assert.ok(readFileSync(join(dist, '_headers'), 'utf8').includes(config.auth.url));
const evidence = {
  mode: 'staging',
  demoMode: false,
  auth: 'supabase',
  expectedPublicKeyEmbedded: true,
  sitesEnabled: true,
  telemetry: 'DEMO',
  controls: 'disabled by staging UI/Worker gates',
  assets: files.sort().map((file) => ({
    path: relative(dist, file),
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  })),
};
mkdirSync('.wrangler/staging-integration', { recursive: true });
writeFileSync('.wrangler/staging-integration/build-check.json', JSON.stringify(evidence, null, 2));
console.log(
  'PASS: staging mode, real authentication, expected public config, site setup, demo telemetry and CSP.',
);
console.log(`Pinned ${evidence.assets.length} asset hashes; no credential values printed.`);
