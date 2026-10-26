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

test.describe('Analytics E2E Smoke Tests', () => {
  test('navigates to analytics, verifies summary cards, switches ranges and accessible table view', async ({
    page,
  }) => {
    // 1. Sign in as READ_WRITE user
    await signIn(page, 'readwrite@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    // 2. Navigate to /analytics
    await page.goto('/analytics');
    await expect(pageTitle(page)).toHaveText('Analytics');

    // 3. Verify demo telemetry banner and summary cards
    await expect(page.getByText('DEMO TELEMETRY:')).toBeVisible();
    await expect(page.getByText('Solar Generated')).toBeVisible();
    await expect(page.getByText('Home Demand')).toBeVisible();
    await expect(page.getByText('Grid Import', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Battery Charged')).toBeVisible();
    await expect(page.getByText('Net Cost', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Net Savings', { exact: true })).toBeVisible();

    // 4. Verify assumptions disclosure panel
    await page.getByRole('button', { name: /assumptions/i }).click();
    await expect(page.getByText(/Financial & Energy Model Disclosures/i)).toBeVisible();
    await expect(page.getByText(/A-01 \(Standing charges\):/i)).toBeVisible();

    // 5. Change range preset to Week
    await page.getByText('Week', { exact: true }).click();
    await expect(page.getByText(/Period: 2026-06-21 to 2026-06-27/i)).toBeVisible();

    // 6. Switch to accessible table view
    await page.getByRole('button', { name: 'View as Table' }).first().click();
    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByText('Solar (kWh)')).toBeVisible();

    // 7. Switch to Cost tab
    await page.getByRole('tab', { name: 'Cost & Net Invoicing' }).click();
    await expect(page.getByText('Electricity Invoicing & Net Cost')).toBeVisible();
  });
});
