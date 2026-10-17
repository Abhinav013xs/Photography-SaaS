import { test, expect } from '@playwright/test';

test.describe('Photographer Authentication Journeys', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure fresh session
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('Login view renders with Studio Lumina branding and credentials fields', async ({ page }) => {
    await page.goto('/');

    // Check title and branding
    await expect(page.locator('h1')).toContainText('STUDIO LUMINA');
    await expect(page.locator('body')).toContainText(/Photographer Portal/i);

    // Form inputs and submit button
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText(/Sign In/i);
  });

  test('Invalid credentials display safe error message and prevent dashboard access', async ({ page }) => {
    await page.goto('/');

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    // Fill incorrect credentials
    await emailInput.fill('intruder@example.com');
    await passwordInput.fill('WrongPassword999!');
    await submitBtn.click();

    // Verify error alert
    const errorAlert = page.locator('.modal-backdrop, div').filter({ hasText: /Invalid|rejected|unauthorized|failed/i }).first();
    await expect(errorAlert).toBeVisible({ timeout: 5000 });

    // Ensure we are still unauthenticated
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await expect(page.locator('button', { hasText: /Create Event/i })).not.toBeVisible();
  });

  test('Valid credentials authenticate successfully and persist across page reload', async ({ page }) => {
    await page.goto('/');

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    // Default seeded credentials
    await emailInput.fill('photographer@studiolumina.photo');
    await passwordInput.fill('photographer123');
    await submitBtn.click();

    // Verify transition to Master Dashboard
    await expect(page.locator('button', { hasText: /Create Event/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button', { hasText: /Events & Galleries/i })).toBeVisible();

    // Reload page to verify session persistence via localStorage / token
    await page.reload();
    await expect(page.locator('button', { hasText: /Create Event/i })).toBeVisible({ timeout: 10000 });
  });

  test('Logout invalidates the session and returns to login view', async ({ page }) => {
    await page.goto('/');

    // Authenticate
    await page.locator('input[type="email"]').fill('photographer@studiolumina.photo');
    await page.locator('input[type="password"]').fill('photographer123');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('button', { hasText: /Create Event/i })).toBeVisible({ timeout: 10000 });

    // Click logout
    const logoutBtn = page.locator('button[title="Logout"]');
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Verify redirected back to Login screen
    await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button', { hasText: /Create Event/i })).not.toBeVisible();
  });
});
