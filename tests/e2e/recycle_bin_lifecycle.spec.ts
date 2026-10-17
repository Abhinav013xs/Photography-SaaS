import { test, expect } from '@playwright/test';

test.describe('Recycle Bin & Event Restoration Lifecycle', () => {
  const eventName = `E2E Bin Event ${Date.now()}`;
  let eventId = '';

  test.beforeAll(async ({ request }) => {
    // Authenticate
    const loginRes = await request.post('http://localhost:5000/api/auth/login', {
      data: {
        email: 'photographer@studiolumina.photo',
        password: 'photographer123',
      },
    });
    const { token } = await loginRes.json();

    // Create event
    const createRes = await request.post('http://localhost:5000/api/events', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: eventName,
        client_name: 'Genevieve & Julian',
        event_date: '2026-11-20',
        location: 'Château de Lumina',
        visibility: 'public',
        public_days: 30,
      },
    });
    const createData = await createRes.json();
    eventId = createData.event.id;

    // Move to Recycle Bin
    await request.post(`http://localhost:5000/api/events/${eventId}/trash`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  test('Photographer views trashed event in Recycle Bin, restores it, and confirms it reappears in active galleries', async ({ page }) => {
    // Authenticate in browser
    await page.goto('/');
    await page.locator('input[type="email"]').fill('photographer@studiolumina.photo');
    await page.locator('input[type="password"]').fill('photographer123');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('button', { hasText: /Create Event/i })).toBeVisible({ timeout: 10000 });

    // Navigate to Recycle Bin
    await page.locator('button', { hasText: /Recycle Bin/i }).first().click();
    await expect(page.locator('h1, h2')).toContainText(/Recycle Bin/i);

    // Verify the trashed event is displayed
    const eventCard = page.locator('.bin-event-row').filter({ hasText: eventName });
    await expect(eventCard).toBeVisible({ timeout: 10000 });
    await expect(eventCard).toContainText(/remaining|Auto-purges/i);

    // Click Restore button on the event
    const restoreBtn = eventCard.locator('button', { hasText: /Restore/i });
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click({ force: true });

    // Verify success toast or removal from bin
    await expect(page.locator('body')).toContainText(/restored successfully|Success/i);

    // Switch back to Events & Galleries view
    await page.locator('button', { hasText: /Events & Galleries/i }).first().click();

    // Verify event is now present in active events list
    await expect(page.locator('body')).toContainText(eventName);
  });
});
