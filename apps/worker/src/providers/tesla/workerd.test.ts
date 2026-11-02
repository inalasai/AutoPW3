import { execFileSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'rolldown';
import { it } from 'vitest';

it('runs browser correlation and Tesla HTTP flows in workerd without forwarding redirects', async () => {
  const require = createRequire(import.meta.url);
  const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
  const workerd = wranglerRequire('workerd') as { default: string };
  const directory = mkdtempSync(join(tmpdir(), 'autopw3-tesla-workerd-'));
  const files = ['entry.ts', 'worker.js', 'mock.js', 'config.capnp', 'workerd.capnp', 'output.log'];
  let output: number | undefined;
  try {
    copyFileSync(
      wranglerRequire.resolve('workerd/workerd.capnp'),
      join(directory, 'workerd.capnp'),
    );
    writeFileSync(
      join(directory, 'entry.ts'),
      `
      import { TeslaClient, TeslaApiError } from ${JSON.stringify(fileURLToPath(new URL('./client.ts', import.meta.url)))};
      import { TeslaHttpError } from ${JSON.stringify(fileURLToPath(new URL('./http.ts', import.meta.url)))};
      import { RequestBudget } from ${JSON.stringify(fileURLToPath(new URL('../../lib/request-budget.ts', import.meta.url)))};
      import { exchangeAuthorizationCode, refreshAccessToken, TeslaOAuthError } from ${JSON.stringify(fileURLToPath(new URL('./oauth.ts', import.meta.url)))};
      import { createOAuthBrowserCookie, oauthBrowserLeaseKey, readOAuthBrowserCookie } from ${JSON.stringify(fileURLToPath(new URL('../../lib/staging-tesla-oauth-cookie.ts', import.meta.url)))};
      const base = 'https://fleet-api.prd.eu.vn.cloud.tesla.com';
      const access = 'fixture-access';
      const codeOptions = { clientId: 'fixture-client', clientSecret: 'fixture-secret', redirectUri: 'https://app-fixture.invalid/callback', code: 'fixture-code', codeVerifier: 'fixture-verifier', audience: base };
      const refreshOptions = { clientId: 'fixture-client', clientSecret: 'fixture-secret', refreshToken: 'fixture-refresh' };
      function check(ok, label) { if (!ok) throw new Error(label); }
      async function rejected(operation, predicate) {
        let error;
        try { await operation(); } catch (caught) { error = caught; }
        check(error && predicate(error), 'fixture_redirect_mapping_failed');
        const rendered = String(error) + JSON.stringify(error);
        for (const value of ['fixture-access', 'fixture-secret', 'fixture-refresh', 'fixture-code', 'redirect-fixture.invalid', 'private-body-canary'])
          check(!rendered.includes(value), 'fixture_sensitive_error');
      }
      export default { async test() {
        const key = crypto.getRandomValues(new Uint8Array(32));
        const now = Date.now();
        const state = crypto.randomUUID();
        const cookie = (await createOAuthBrowserCookie({ state, sessionId: crypto.randomUUID(), householdId: crypto.randomUUID(), expiresAt: now + 600000, leaseKey: await oauthBrowserLeaseKey(crypto.randomUUID()), leaseOwner: crypto.randomUUID() }, key, now)).split(';')[0];
        const request = new Request('https://app-fixture.invalid/callback', { headers: { cookie } });
        const binding = await readOAuthBrowserCookie(request, key, now);
        check(binding?.state === state && binding.secret.length === 64, 'fixture_cookie_crypto_failed');
        check(await readOAuthBrowserCookie(request, key, now + 600000) === null, 'fixture_cookie_expiry_failed');
        check(await readOAuthBrowserCookie(request, crypto.getRandomValues(new Uint8Array(32)), now) === null, 'fixture_cookie_key_failed');
        const client = new TeslaClient();
        check((await client.listProducts(base, access))[0]?.energySiteId === '123', 'fixture_products_failed');
        check((await client.getRegion(access, base)).fleetApiBaseUrl === base, 'fixture_region_failed');
        check((await client.getLiveStatus(base, '123', access)).percentage_charged === 73, 'fixture_live_failed');
        check((await exchangeAuthorizationCode(codeOptions)).access_token === access, 'fixture_exchange_failed');
        check((await refreshAccessToken(refreshOptions)).refresh_token === 'fixture-refresh', 'fixture_refresh_failed');
        const injected = new TeslaClient(function(input, init) {
          check(this === globalThis, 'fixture_receiver_failed');
          return globalThis.fetch(input, init);
        });
        check((await injected.listProducts(base, access)).length === 1, 'fixture_injection_failed');
        for (const status of [301, 302, 303, 307, 308]) {
          await globalThis.fetch('https://fixture-control.invalid/mode?status=' + status);
          await rejected(() => client.listProducts(base, access), e => e instanceof TeslaApiError && e.statusCode === status);
          await rejected(() => client.getRegion(access, base), e => e instanceof TeslaHttpError && e.kind === 'HTTP' && e.status === status);
          await rejected(() => client.getLiveStatus(base, '123', access), e => e instanceof TeslaHttpError && e.kind === 'HTTP' && e.status === status);
          await rejected(() => exchangeAuthorizationCode(codeOptions), e => e instanceof TeslaOAuthError && e.error === 'authorization_exchange_failed' && e.statusCode === 502);
          await rejected(() => refreshAccessToken(refreshOptions), e => e instanceof TeslaOAuthError && e.error === 'token_refresh_failed' && e.statusCode === status);
        }
        const stats = await (await globalThis.fetch('https://fixture-control.invalid/stats')).json();
        check(stats.destinationHits === 0 && stats.calls === 31, 'fixture_destination_or_retry_failed');
        const budget = new RequestBudget();
        const boundedStats = await (await budget.fetcher()('https://fixture-control.invalid/stats')).json();
        check(boundedStats.calls === 31, 'fixture_budget_fetch_failed');
        budget.dispose();
        let closed = false;
        try { budget.check(); } catch { closed = true; }
        check(closed, 'fixture_budget_disposal_failed');
      }};
    `,
    );
    const bundle = await build({
      input: join(directory, 'entry.ts'),
      platform: 'browser',
      write: false,
      output: { format: 'esm' },
    });
    const chunk = bundle.output.find((entry) => entry.type === 'chunk');
    if (!chunk || bundle.output.length !== 1) throw new Error('Expected one local workerd bundle');
    writeFileSync(join(directory, 'worker.js'), chunk.code);
    // globalOutbound routes every URL to this fixture service. No real Tesla requests are possible.
    writeFileSync(
      join(directory, 'mock.js'),
      `
      let status = 0, calls = 0, destinationHits = 0;
      function check(ok) { if (!ok) throw new Error('fixture_request_shape_failed'); }
      export default { async fetch(request) {
        const url = new URL(request.url);
        if (url.hostname === 'fixture-control.invalid') {
          if (url.pathname === '/mode') status = Number(url.searchParams.get('status'));
          return Response.json({ calls, destinationHits });
        }
        if (url.hostname === 'redirect-fixture.invalid') { destinationHits++; return Response.json({}); }
        calls++;
        check(request.redirect === 'manual');
        if (url.hostname === 'fleet-auth.prd.vn.cloud.tesla.com') {
          check(url.pathname === '/oauth2/v3/token' && request.method === 'POST');
          const form = new URLSearchParams(await request.text());
          check(form.get('client_id') === 'fixture-client' && form.get('client_secret') === 'fixture-secret');
          if (form.get('grant_type') === 'authorization_code')
            check(form.get('code') === 'fixture-code' && form.get('code_verifier') === 'fixture-verifier' && form.get('audience') === 'https://fleet-api.prd.eu.vn.cloud.tesla.com');
          else check(form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'fixture-refresh');
          if (status) return new Response('private-body-canary', { status, headers: { location: 'https://redirect-fixture.invalid/credential-target' } });
          return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'openid offline_access energy_device_data' });
        }
        check(url.hostname === 'fleet-api.prd.eu.vn.cloud.tesla.com' && request.method === 'GET');
        check(request.headers.get('authorization') === 'Bearer fixture-access');
        if (status) return new Response('private-body-canary', { status, headers: { location: 'https://redirect-fixture.invalid/credential-target' } });
        if (url.pathname === '/api/1/products') return Response.json({ response: [{ energy_site_id: '123', site_name: 'Fixture' }] });
        if (url.pathname === '/api/1/users/region') return Response.json({ response: { region: 'eu', fleet_api_base_url: 'https://fleet-api.prd.eu.vn.cloud.tesla.com' } });
        check(url.pathname === '/api/1/energy_sites/123/live_status');
        return Response.json({ response: { percentage_charged: 73 } });
      }};
    `,
    );
    writeFileSync(
      join(directory, 'config.capnp'),
      `
      using Workerd = import "workerd.capnp";
      const config :Workerd.Config = (services = [
        (name="tesla-test",worker=(compatibilityDate="2026-10-01",globalOutbound="mock",modules=[(name="worker.js",esModule=embed "worker.js")])),
        (name="mock",worker=(compatibilityDate="2026-10-01",modules=[(name="mock.js",esModule=embed "mock.js")]))
      ]);
    `,
    );
    output = openSync(join(directory, 'output.log'), 'w');
    try {
      // File-backed stdio supports the Windows sandbox without skipping runtime assertions.
      execFileSync(workerd.default, ['test', join(directory, 'config.capnp'), 'tesla-test'], {
        stdio: ['ignore', output, output],
        windowsHide: true,
        timeout: 20_000,
      });
    } catch {
      const label = readFileSync(join(directory, 'output.log'), 'utf8').match(
        /fixture_[a-z_]+/,
      )?.[0];
      throw new Error(label ?? 'Local Tesla workerd regression failed');
    }
  } finally {
    if (output !== undefined) closeSync(output);
    for (const file of files)
      if (existsSync(join(directory, file))) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
}, 30_000);
