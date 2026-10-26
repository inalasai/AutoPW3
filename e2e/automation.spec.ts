import { expect, test, type Page } from '@playwright/test';

function pageTitle(page: Page) {
  return page.locator('h1#page-title');
}

const PASSWORD = 'mock-password-12';

async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('Automation Engine E2E Smoke Tests', () => {
  test('READ_ONLY role cannot create rules or toggle pause', async ({ page }) => {
    // 1. Sign in as READ_ONLY user
    await signIn(page, 'readonly@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    // 2. Navigate to /automation
    await page.goto('/automation');
    await expect(pageTitle(page)).toHaveText('Automation');

    // 3. Verify read-only notice is visible
    await expect(page.getByText('You have read-only access')).toBeVisible();
    await expect(
      page.getByText(/You can view this page, but you cannot change rules/i),
    ).toBeVisible();

    // 4. Verify emergency pause and create buttons are disabled
    await expect(page.getByRole('button', { name: 'Emergency Pause' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'New rule' })).toBeDisabled();

    // 5. Verify safety disclaimer is visible
    await expect(page.getByTestId('automation-safety-notice')).toContainText(
      'Real Automation is Off by Default',
    );
  });

  test('READ_WRITE user can toggle emergency automation pause', async ({ page }) => {
    // 1. Sign in as READ_WRITE user
    await signIn(page, 'readwrite@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    // 2. Navigate to /automation
    await page.goto('/automation');
    await expect(pageTitle(page)).toHaveText('Automation');

    // 3. Initial state is active
    const pauseBadge = page.getByTestId('automation-pause-status');
    await expect(pauseBadge).toHaveText('AUTOMATION ACTIVE');

    // 4. Click Emergency Pause
    const pauseButton = page.getByRole('button', { name: 'Emergency Pause' });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();

    // 5. Confirm dialog opens
    await expect(
      page.getByRole('heading', { level: 2, name: 'Emergency Pause All Automation?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Emergency Pause Now' }).click();

    // 6. Badge updates to paused
    await expect(pauseBadge).toHaveText('AUTOMATION PAUSED');

    // 7. Resume automation
    const resumeButton = page.getByRole('button', { name: 'Resume Automation' });
    await resumeButton.click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Resume Automated Rules?' }),
    ).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Resume Automation' }).click();

    // 8. Badge returns to active
    await expect(pauseBadge).toHaveText('AUTOMATION ACTIVE');
  });
});
