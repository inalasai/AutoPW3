import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { loadEnv } from 'vite';

const APP = 'https://staging-fixture.autopw3.test';
// Match the public build configuration; all requests are intercepted below, including Auth.
const PROJECT = new URL(loadEnv('staging', resolve('apps/web'), 'VITE_')['VITE_SUPABASE_URL']!)
  .origin;
const DIST = resolve('apps/web/dist');
const USER = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';
type Mode = 'normal' | 'lost-link' | 'reauth' | 'recovery' | 'expired' | 'limited' | 'oauth';

async function fixture(page: Page, mode: Mode = 'normal') {
  const evidence = {
    discoveries: 0,
    connections: 0,
    writes: 0,
    keys: [] as string[],
    unexpected: [] as string[],
  };
  const user = {
    id: USER,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'admin@example.test',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const access = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: USER, role: 'authenticated', aud: 'authenticated', iss: `${PROJECT}/auth/v1`, exp })}.fixture-signature`;
  const session = {
    access_token: access,
    refresh_token: 'fixture-browser-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  const site = {
    id: SITE,
    householdId: HOUSEHOLD,
    provider: 'TESLA',
    providerSiteId: '123456789',
    name: 'Staging fixture energy',
    timezone: 'Europe/Dublin',
    connectionState: 'CONNECTING',
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const cors = {
      'access-control-allow-origin': APP,
      'access-control-allow-headers':
        'authorization,apikey,content-type,x-client-info,x-supabase-api-version',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    if (url.origin === PROJECT) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (url.pathname === '/auth/v1/token') return json(session);
      if (url.pathname === '/auth/v1/user') return json(user);
      if (url.pathname === '/auth/v1/logout') return json({});
      if (url.pathname === '/rest/v1/user_profiles')
        return json([{ user_id: USER, display_name: 'Fixture ADMIN', locale: 'en' }]);
      if (url.pathname === '/rest/v1/household_members')
        return json([
          {
            household_id: HOUSEHOLD,
            role: 'ADMIN',
            households: { id: HOUSEHOLD, name: 'Fixture household' },
          },
        ]);
    }
    if (url.origin === APP) {
      if (url.pathname.endsWith('/provider/tesla/connect')) {
        evidence.connections++;
        expect(request.postDataJSON()).toEqual({ enableControls: false, restart: true });
        expect(request.headers()['authorization']).toBe(`Bearer ${access}`);
        const query = new URLSearchParams({
          client_id: 'fixture-client',
          response_type: 'code',
          redirect_uri: `${APP}/api/v1/provider/tesla/callback`,
          scope: 'openid offline_access energy_device_data',
          state: 'fixture-state',
          code_challenge: 'fixture-challenge',
          code_challenge_method: 'S256',
        });
        return json({ authorizeUrl: `https://auth.tesla.com/oauth2/v3/authorize?${query}` });
      }
      if (url.pathname.endsWith('/provider/tesla/discovered-sites')) {
        evidence.discoveries++;
        expect(request.headers()['authorization']).toBe(`Bearer ${access}`);
        if (mode === 'expired')
          return json(
            { error: { code: 'UNAUTHENTICATED', message: 'Expired', requestId: 'fixture' } },
            401,
          );
        if (mode === 'limited')
          return json(
            { error: { code: 'RATE_LIMITED', message: 'Wait', requestId: 'fixture' } },
            429,
          );
        if (mode === 'reauth' || mode === 'recovery')
          return json(
            {
              error: {
                code: 'CONFLICT',
                message: 'Recovery required',
                requestId: 'fixture',
                details: [
                  {
                    path: 'provider.tesla',
                    issue:
                      mode === 'reauth'
                        ? 'TESLA_REAUTHORIZATION_REQUIRED'
                        : 'TESLA_RECOVERY_REQUIRED',
                  },
                ],
              },
            },
            409,
          );
        return json({ items: [{ providerSiteId: site.providerSiteId, name: site.name }] });
      }
      if (url.pathname === `/api/v1/households/${HOUSEHOLD}/sites` && request.method() === 'POST') {
        expect(request.headers()['authorization']).toBe(`Bearer ${access}`);
        expect(request.postDataJSON()).toEqual({ providerSiteId: site.providerSiteId });
        evidence.keys.push(request.headers()['idempotency-key']!);
        const created = evidence.writes === 0;
        if (created) evidence.writes++;
        if (mode === 'lost-link' && evidence.keys.length === 1) return route.abort('failed');
        return json({ site, created }, created ? 201 : 200);
      }
      if (url.pathname.startsWith('/api/'))
        return json(
          {
            error: {
              code: 'NOT_IMPLEMENTED',
              message: 'Fixture endpoint unavailable',
              requestId: 'fixture',
            },
          },
          501,
        );
      const path = resolve(DIST, decodeURIComponent(url.pathname).replace(/^\//, ''));
      if (path !== DIST && !path.startsWith(DIST + sep)) return route.abort();
      const file = url.pathname.startsWith('/assets/') ? path : resolve(DIST, 'index.html');
      const type = file.endsWith('.js')
        ? 'application/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : 'text/html';
      return route.fulfill({ contentType: type, body: await readFile(file) });
    }
    if (mode === 'oauth' && url.origin === 'https://auth.tesla.com')
      return route.fulfill({ contentType: 'text/html', body: '<h1>Fixture Tesla consent</h1>' });
    // Includes Tesla: no fixture is ever allowed to contact a real provider or hosted service.
    evidence.unexpected.push(url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
  return evidence;
}

async function login(page: Page) {
  await page.goto(`${APP}/settings`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('DEMO MODE:', { exact: false })).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Find Tesla energy sites' })).toBeVisible();
}

async function choose(page: Page) {
  await page.getByRole('button', { name: 'Find Tesla energy sites' }).click();
  await page.getByLabel('Authorized Tesla energy site').selectOption('123456789');
  await page.getByRole('button', { name: 'Link selected site' }).click();
}

test('built staging login, site setup, exactly-once link retry and labelled demo telemetry', async ({
  page,
}) => {
  const evidence = await fixture(page, 'lost-link');
  await login(page);
  const controls = page.getByRole('switch', { name: 'Enable Powerwall Remote Controls' });
  await expect(controls).toBeDisabled();
  await expect(controls).not.toBeChecked();
  await choose(page);
  await expect(page.getByRole('alert')).toContainText('Retry linking');
  await page.getByRole('button', { name: 'Retry linking site' }).click();
  await expect(page.getByText('This Tesla energy site was already linked.')).toBeVisible();
  await expect(page.getByText(`Persisted site: ${SITE}`)).toBeVisible();
  expect(evidence.keys[0]).toBe(evidence.keys[1]);
  await page.reload();
  await choose(page);
  await expect(page.getByText('This Tesla energy site was already linked.')).toBeVisible();
  expect(evidence.writes).toBe(1);
  await page.goto(`${APP}/live`);
  await expect(page.getByRole('heading', { name: 'Demo scenario' })).toBeVisible();
  await expect(page.getByText('DEMO MODE:', { exact: false })).toHaveCount(0);
  expect(evidence.unexpected).toEqual([]);
});

for (const mode of ['reauth', 'recovery'] as const)
  test(`built staging presents ${mode} without retries, logout or reconnect`, async ({ page }) => {
    const evidence = await fixture(page, mode);
    await login(page);
    await page.getByRole('button', { name: 'Find Tesla energy sites' }).click();
    await expect(page.getByRole('alert')).toContainText(
      mode === 'reauth' ? 'explicitly reconnect Tesla' : 'uncertain outcome',
    );
    await expect(page.getByRole('button', { name: 'Find Tesla energy sites' })).toBeDisabled();
    expect(evidence.discoveries).toBe(1);
    expect(evidence.connections).toBe(0);
    expect(evidence.writes).toBe(0);
    expect(evidence.unexpected).toEqual([]);
  });

test('built staging distinguishes expired Supabase session from Tesla reauthorization', async ({
  page,
}) => {
  const evidence = await fixture(page, 'expired');
  await login(page);
  await page.getByRole('button', { name: 'Find Tesla energy sites' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(evidence.discoveries).toBe(1);
  expect(evidence.unexpected).toEqual([]);
});

test('built staging starts read-only Tesla OAuth only after the explicit manual action', async ({
  page,
}) => {
  const evidence = await fixture(page, 'oauth');
  await login(page);
  expect(evidence.connections).toBe(0);
  await page.getByText('Connect or reconnect Tesla (manual)', { exact: true }).click();
  expect(evidence.connections).toBe(0);
  await page.getByRole('button', { name: 'Start read-only Tesla authorization' }).click();
  await expect(page.getByRole('heading', { name: 'Fixture Tesla consent' })).toBeVisible();
  expect(evidence.connections).toBe(1);
  expect(evidence.discoveries).toBe(0);
  expect(evidence.writes).toBe(0);
  expect(evidence.unexpected).toEqual([]);
});

test('built staging rate limit offers only a manual retry', async ({ page }) => {
  const evidence = await fixture(page, 'limited');
  await login(page);
  await page.getByRole('button', { name: 'Find Tesla energy sites' }).click();
  await expect(page.getByRole('alert')).toContainText('Wait before retrying');
  expect(evidence.discoveries).toBe(1);
  expect(evidence.writes).toBe(0);
  expect(evidence.unexpected).toEqual([]);
});
