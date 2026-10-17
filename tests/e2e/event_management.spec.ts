import { test, expect } from '@playwright/test';

test.describe('Event Management Lifecycle Journeys', () => {
  const uniqueEventName = `E2E Playwright Event ${Date.now()}`;
  const clientName = 'Sophia & Alexander';
  const folderName = 'Reception Highlights';

  test.beforeEach(async ({ page }) => {
    // Authenticate as photographer
    await page.goto('/');
    await page.locator('input[type="email"]').fill('photographer@studiolumina.photo');
    await page.locator('input[type="password"]').fill('photographer123');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('button', { hasText: /Create Event/i })).toBeVisible({ timeout: 10000 });
  });

  test('Creates a new photography event with custom settings and verifies persistence', async ({ page }) => {
    // Open Create Event Modal
    await page.locator('button', { hasText: /Create Event/i }).first().click();
    await expect(page.locator('.modal-container')).toBeVisible();
    await expect(page.locator('.modal-title')).toContainText(/Create Photography Event/i);

    // Fill event metadata
    await page.locator('input[name="name"]').fill(uniqueEventName);
    await page.locator('input[name="client_name"]').fill(clientName);
    await page.locator('input[name="location"]').fill('The Glasshouse Pavilion');

    // Submit event creation
    const submitBtn = page.locator('.modal-container button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Verify modal closes and EventDetailView opens with the event name
    await expect(page.locator('.modal-container')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText(uniqueEventName);

    // Verify event detail buttons are present (New Folder, Upload, Settings)
    const newFolderBtn = page.locator('button', { hasText: /New Folder/i });
    await expect(newFolderBtn).toBeVisible();

    // Create a Ceremony Folder inside this event
    await newFolderBtn.click();
    await expect(page.locator('.modal-container')).toBeVisible();
    const folderInput = page.locator('.modal-container input[type="text"]');
    await folderInput.fill(folderName);
    await folderInput.press('Enter');

    // Verify folder is listed in ceremony tabs
    await expect(page.locator('.modal-container')).not.toBeVisible();
    await expect(page.locator('body')).toContainText(folderName);

    // Navigate back to Events list
    const backBtn = page.locator('button', { hasText: /Back to Events/i }).or(page.locator('button:has(svg.lucide-arrow-left)'));
    if (await backBtn.first().isVisible()) {
      await backBtn.first().click();
    } else {
      await page.locator('button', { hasText: /Events & Galleries/i }).first().click();
    }

    // Verify event is listed in the Events gallery list
    await expect(page.locator('body')).toContainText(uniqueEventName);

    // Reload page to verify persistence in database
    await page.reload();
    await expect(page.locator('body')).toContainText(uniqueEventName);
  });
});
