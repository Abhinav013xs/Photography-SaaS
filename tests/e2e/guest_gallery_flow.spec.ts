import { test, expect } from '@playwright/test';

test.describe('Guest Gallery Portal Journeys', () => {
  let eventSlug = '';
  const eventName = `E2E Gala ${Date.now()}`;
  const pinCode = '4321';

  test.beforeAll(async ({ request }) => {
    // Authenticate via API to retrieve token
    const loginRes = await request.post('http://localhost:5000/api/auth/login', {
      data: {
        email: 'photographer@studiolumina.photo',
        password: 'photographer123',
      },
    });
    const { token } = await loginRes.json();

    // Create a deterministic PIN-protected event
    const eventRes = await request.post('http://localhost:5000/api/events', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: eventName,
        client_name: 'Charlotte & David',
        event_date: '2026-10-15',
        location: 'Belvedere Estate',
        visibility: 'public',
        public_days: 30,
        pin_enabled: true,
        pin: pinCode,
        allow_downloads: true,
        face_search_enabled: true,
      },
    });
    const eventData = await eventRes.json();
    eventSlug = eventData.event.slug;

    // Add a ceremony folder
    await request.post(`http://localhost:5000/api/events/${eventData.event.id}/folders`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sunset Reception' },
    });
  });

  test('Guest is challenged for PIN and unlocks gallery with valid credentials', async ({ page }) => {
    // Navigate directly to public guest gallery route
    await page.goto(`/gallery/${eventSlug}`);

    // Verify PIN challenge screen
    await expect(page.locator('h2')).toContainText(/Protected Gallery/i);
    await expect(page.locator('body')).toContainText(eventName);

    const pinInput = page.locator('input[type="password"]');
    const unlockBtn = page.locator('button[type="submit"]');

    // Attempt invalid PIN
    await pinInput.fill('0000');
    await unlockBtn.click();
    await expect(page.locator('body')).toContainText(/Invalid PIN|Incorrect/i);

    // Enter correct PIN
    await pinInput.fill(pinCode);
    await unlockBtn.click();

    // Verify gallery is unlocked and displays event branding
    await expect(page.locator('h1')).toContainText(eventName);
    await expect(page.locator('body')).toContainText('Sunset Reception');
    await expect(page.locator('button', { hasText: /Find My Photos/i })).toBeVisible();
  });

  test('Guest attempting to access non-existent or trashed gallery sees appropriate screen', async ({ page }) => {
    await page.goto('/gallery/non-existent-invalid-slug-999');
    await expect(page.locator('body')).toContainText(/Gallery not found|Private Gallery/i);
  });
});
