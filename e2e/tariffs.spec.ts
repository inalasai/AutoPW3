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

test.describe('Tariff Manager E2E Smoke Tests', () => {
  test('creating an invalid tariff is blocked; valid tariff is saved', async ({ page }) => {
    // 1. Sign in as READ_WRITE user
    await signIn(page, 'readwrite@example.test');
    await expect(pageTitle(page)).toHaveText('Live');

    // 2. Navigate to /tariffs
    await page.goto('/tariffs');
    await expect(pageTitle(page)).toHaveText('Tariffs');

    // 3. Click New tariff
    await page.getByRole('button', { name: 'New tariff' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'New Tariff' })).toBeVisible();

    // 4. Introduce a gap by clearing windows or removing slots to make it invalid
    const removeButtons = page.getByRole('button', { name: 'Remove' });
    const count = await removeButtons.count();
    if (count > 1) {
      await removeButtons.nth(1).click();
    }

    // Verify blocked by validation
    await expect(page.getByText('Tariff cannot be saved:')).toBeVisible();
    await page.getByRole('button', { name: 'Create Tariff' }).click();
    await expect(
      page.getByText('Please resolve all validation errors before saving.'),
    ).toBeVisible();

    // 5. Load valid template and save
    await page.getByRole('button', { name: 'Example Templates' }).click();
    await expect(page.getByText('Example Tariff Templates')).toBeVisible();

    await page.getByRole('button', { name: /Day & Night Import \(TOU\)/i }).click();

    // Verify ready status
    await expect(page.getByText(/Tariff is valid and complete/i)).toBeVisible();

    // Save valid tariff
    await page.getByRole('button', { name: 'Create Tariff' }).click();
    await expect(page.getByText(/Saved "EXAMPLE day and night import/i)).toBeVisible();
  });
});
