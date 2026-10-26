import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PASSWORD = 'mock-password-12';

async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

function pageTitle(page: Page) {
  return page.locator('h1#page-title');
}

test.describe('Administration & Settings E2E Smoke Tests', () => {
  test('READ_ONLY role is blocked from accessing /admin', async ({ page }) => {
    // 1. Sign in as READ_ONLY user
    await signIn(page, 'readonly@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    // 2. Navigate to /admin
    await page.goto('/admin');

    // 3. Verify blocked by RequireRole minimum="ADMIN"
    await expect(pageTitle(page)).toHaveText('Not authorised');
    await expect(
      page.getByText(/Your role in this household does not allow you to open this page/i),
    ).toBeVisible();
  });

  test('ADMIN role can access /admin and manage members, audit, and settings', async ({ page }) => {
    // 1. Sign in as ADMIN user
    await signIn(page, 'admin@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    // 2. Navigate to /admin
    await page.goto('/admin');
    await expect(pageTitle(page)).toHaveText('Admin');

    // 3. Member Directory tab (default tab)
    await expect(page.getByRole('textbox', { name: 'Search members' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invite Member' })).toBeVisible();

    // 4. Open Invite Member modal
    await page.getByRole('button', { name: 'Invite Member' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Invite Household Member' }),
    ).toBeVisible();

    // Fill invitation form
    await page.getByLabel('Invitee Email (Optional)').fill('newguest@example.test');
    await page.getByLabel('Initial Role').selectOption('READ_WRITE');
    await page.getByRole('button', { name: 'Create Invitation' }).click();

    // Verify invitation link created with copy action
    await expect(page.getByText('Invitation Created')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy Link' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // 5. Switch to Audit History tab
    await page.getByRole('tab', { name: 'Audit History' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Audit Log' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Household audit log' })).toBeVisible();

    // 6. Switch to Household Settings tab
    await page.getByRole('tab', { name: 'Household Settings' }).click();
    await expect(page.getByText('Tesla Connection Status')).toBeVisible();
    await expect(page.getByLabel('Monthly Spend Cap (USD)')).toBeVisible();

    // 7. Switch to Privacy & Data tab
    await page.getByRole('tab', { name: 'Privacy & Data' }).click();
    await expect(page.getByRole('button', { name: 'Export Household Data (JSON)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export My Account Data (JSON)' })).toBeVisible();
    await expect(page.getByText('Privacy Operations & Erasure')).toBeVisible();
  });

  test('READ_ONLY user can access /settings', async ({ page }) => {
    // 1. Sign in as READ_ONLY user
    await signIn(page, 'readonly@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    // 2. Navigate to /settings
    await page.goto('/settings');
    await expect(pageTitle(page)).toHaveText('Settings');

    // 3. Verify settings tabs are visible and functional
    await expect(page.getByRole('tab', { name: 'Household Settings' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Privacy & Data' })).toBeVisible();
  });
});
