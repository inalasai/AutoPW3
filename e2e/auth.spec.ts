import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Authentication smoke test (TASK-07). Runs against the in-memory mock identity provider (development build,
 * `VITE_AUTH_MODE=mock`). The accounts below are seeded by `DEV_MOCK_USERS` in
 * `apps/web/src/features/auth/mock/mock-client.ts`; the password is a test value, not a credential.
 *
 * The mock "server" lives in page memory, so every test starts from the same seed after a fresh page load.
 */
const PASSWORD = 'mock-password-12';
const MOCK_SESSION_KEY = 'autopw3.mock-session';

async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

function pageTitle(page: Page) {
  return page.locator('h1#page-title');
}

test.describe('registration and sign-in', () => {
  test('a new account can register and gets no access until invited', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email', { exact: true }).fill('fresh.person@example.test');
    await page.getByLabel('Password', { exact: true }).fill('a-long-password-1');
    await page.getByLabel('Confirm password').fill('a-long-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(pageTitle(page)).toHaveText('Waiting for an invitation');
  });

  test('sign in, session restoration across a reload, and sign out', async ({ page, viewport }) => {
    await signIn(page, 'readonly@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    await page.reload();
    await expect(pageTitle(page)).toHaveText('Live');

    // On a phone the account controls live in the menu drawer.
    if (viewport !== null && viewport.width < 640) {
      await page.getByRole('button', { name: 'Open menu' }).click();
    }
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(pageTitle(page)).toHaveText('Sign in');
  });

  test('a wrong password gives one generic message', async ({ page }) => {
    await signIn(page, 'readonly@example.test', 'not-the-password');
    await expect(page.getByRole('alert')).toContainText('The email or password is not correct.');
    await expect(pageTitle(page)).toHaveText('Sign in');
  });
});

test.describe('protected routes', () => {
  test('a signed-out visitor is sent to sign in, then back to the page they asked for', async ({
    page,
  }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/login$/);
    await expect(pageTitle(page)).toHaveText('Sign in');

    await page.getByLabel('Email').fill('readonly@example.test');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/analytics$/);
  });
});

test.describe('permission-aware interface', () => {
  test('READ_ONLY sees no Admin entry and gets the unauthorised page on /admin', async ({
    page,
    viewport,
  }) => {
    await signIn(page, 'readonly@example.test');
    await expect(pageTitle(page)).toHaveText('Live');
    if (viewport !== null && viewport.width >= 640) {
      await expect(
        page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Admin' }),
      ).toHaveCount(0);
    }

    await page.goto('/admin');
    await expect(pageTitle(page)).toHaveText('Not authorised');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('READ_ONLY sees controls disabled with the reason', async ({ page }) => {
    await signIn(page, 'readonly@example.test');
    await page.goto('/tariffs');
    const newTariff = page.getByRole('button', { name: 'New tariff' });
    await expect(newTariff).toBeDisabled();
    await expect(
      page.getByText('Read-only access: you cannot make changes.').first(),
    ).toBeVisible();
  });

  test('ADMIN can open /admin', async ({ page }) => {
    await signIn(page, 'admin@example.test');
    await page.goto('/admin');
    await expect(pageTitle(page)).toHaveText('Admin');
  });
});

test.describe('browser state cannot grant permission', () => {
  test('editing storage to say ADMIN has no effect', async ({ page }) => {
    await signIn(page, 'readonly@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    await page.evaluate((sessionKey) => {
      for (const key of ['role', 'userRole', 'autopw3.role', 'autopw3.permissions', 'isAdmin']) {
        localStorage.setItem(key, 'ADMIN');
        sessionStorage.setItem(key, 'ADMIN');
      }
      // The only thing the mock keeps in the browser is a signed session token. Swap it for a forged one.
      localStorage.setItem(sessionKey, 'mock.11111111-1111-4111-8111-000000000003.deadbeef');
    }, MOCK_SESSION_KEY);

    await page.goto('/admin');
    // A forged token is ignored, so the visitor is signed out and asked to sign in; it never opens Admin.
    await expect(pageTitle(page)).not.toHaveText('Admin');
    await expect(pageTitle(page)).toHaveText('Sign in');
  });

  test('a role change only edited in storage does not survive a reload for a real session', async ({
    page,
  }) => {
    await signIn(page, 'readonly@example.test');
    await page.evaluate(() => {
      localStorage.setItem('role', 'ADMIN');
    });
    await page.reload();
    await page.goto('/admin');
    await expect(pageTitle(page)).toHaveText('Not authorised');
  });
});

test.describe('expired session', () => {
  test('an expired session returns to sign in with an explanation', async ({ page }) => {
    await signIn(page, 'readwrite@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    await page.evaluate(() => {
      (
        window as unknown as { __AUTOPW3_MOCK_AUTH__: { expireSession: () => void } }
      ).__AUTOPW3_MOCK_AUTH__.expireSession();
    });

    await expect(pageTitle(page)).toHaveText('Sign in');
    await expect(page.getByText('Your session has ended')).toBeVisible();
  });
});
