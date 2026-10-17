import { test, expect } from '@playwright/test';

test.describe('E2E Foundation Smoke Tests', () => {
  test('Root page boots and displays Studio Lumina Foundation', async ({ page }) => {
    await page.goto('/');

    // Verify title and brand presence
    await expect(page).toHaveTitle(/Studio Lumina/i);
    const brandElement = page.locator('h1, h2, .brand-title').first();
    await expect(brandElement).toBeVisible();
    await expect(page.locator('body')).toContainText(/Studio Lumina/i);
  });
});
