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

test.describe('Safe Device Controls E2E Smoke Tests', () => {
  test('READ_ONLY role cannot dispatch commands or toggle pause', async ({ page }) => {
    // 1. Sign in as READ_ONLY user
    await signIn(page, 'readonly@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    // 2. Navigate to /controls
    await page.goto('/controls');
    await expect(pageTitle(page)).toHaveText('Controls');

    // 3. Verify read-only notice is visible
    await expect(page.getByText('You have read-only access')).toBeVisible();
    await expect(
      page.getByText(/You can view this page, but you cannot send commands/i),
    ).toBeVisible();

    // 4. Verify emergency pause and dispatch buttons are disabled
    await expect(page.getByRole('button', { name: 'Emergency Pause' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Apply Reserve/i })).toBeDisabled();

    // 5. Verify safety disclaimer and unsupported controls are visible
    await expect(page.getByTestId('safety-disclaimer')).toContainText(
      'Configuration Confirmed ≠ Physical Outcome Guaranteed',
    );
    await expect(page.getByText('Forced Grid Charging', { exact: true })).toBeVisible();
    await expect(page.getByText('Off-Grid Vehicle Reserve', { exact: true })).toBeVisible();
  });

  test('READ_WRITE user can toggle emergency automation pause', async ({ page }) => {
    // 1. Sign in as READ_WRITE user
    await signIn(page, 'readwrite@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    // 2. Navigate to /controls
    await page.goto('/controls');
    await expect(pageTitle(page)).toHaveText('Controls');

    // 3. Initial state is active
    const pauseBadge = page.getByTestId('automation-pause-status');
    await expect(pauseBadge).toHaveText('AUTOMATION ACTIVE');

    // 4. Click Emergency Pause
    const pauseButton = page.getByRole('button', { name: 'Emergency Pause' });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();

    // 5. Confirm dialog appears
    await expect(
      page.getByRole('heading', { level: 2, name: 'Emergency Pause All Automation?' }),
    ).toBeVisible();

    // 6. Confirm emergency pause
    await page.getByRole('button', { name: 'Emergency Pause Now' }).click();

    // 7. Verify badge updates to PAUSED
    await expect(pauseBadge).toHaveText('AUTOMATION PAUSED');
    await expect(page.getByRole('button', { name: 'Resume Automation' })).toBeVisible();

    // 8. Resume automation
    await page.getByRole('button', { name: 'Resume Automation' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Resume Automation Dispatch?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Resume Automation' }).nth(1).click();

    // 9. Status is back to ACTIVE
    await expect(pauseBadge).toHaveText('AUTOMATION ACTIVE');
  });
});
