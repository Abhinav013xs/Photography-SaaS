import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { createTestDatabase } from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { clearMemoryRateLimitStore } from '../../apps/api/src/middleware/rateLimiter.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';

describe('Phase 24 — Photographer Event Settings & Centralized Event Control Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'SettingsMasterPassword2026!';
  let authCookie: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    db = createTestDatabase();
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography');`
    );

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);

    // Authenticate photographer
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'photographer@studiolumina.photo',
        password: TEST_PASSWORD,
      });

    const rawCookies = loginRes.header['set-cookie'];
    const sessionCookie = Array.isArray(rawCookies)
      ? rawCookies.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : rawCookies;

    authCookie = sessionCookie.split(';')[0];
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  beforeEach(() => {
    clearMemoryRateLimitStore();
    resetPinRateLimiterStore();
  });

  // Helper to create an event
  async function createTestEvent(overrides: Record<string, any> = {}) {
    const res = await request(app)
      .post('/api/events')
      .set('Cookie', [authCookie])
      .send({
        name: overrides.name || 'Editorial Royal Wedding',
        client_name: overrides.client_name || 'Princess Anya',
        client_email: overrides.client_email || 'anya@royalty.com',
        event_date: overrides.event_date || '2026-11-20',
        location: overrides.location || 'Lake Palace, Udaipur',
        description: overrides.description || 'Grand celebrations',
        status: overrides.status || 'active',
        visibility: overrides.visibility || 'public',
        public_duration_days: overrides.public_duration_days || 30,
        pin_enabled: overrides.pin_enabled ?? false,
        pin: overrides.pin,
        allow_downloads: overrides.allow_downloads ?? true,
        allow_photo_downloads: overrides.allow_photo_downloads ?? true,
        allow_bulk_downloads: overrides.allow_bulk_downloads ?? true,
        allow_video_downloads: overrides.allow_video_downloads ?? true,
        watermark_enabled: overrides.watermark_enabled ?? false,
        watermark_text: overrides.watermark_text || 'Studio Lumina',
        face_search_enabled: overrides.face_search_enabled ?? true,
        ...overrides,
      });

    expect(res.status).toBe(201);
    return res.body.data.event;
  }

  describe('1. Retrieving and Updating Event Settings & Persistence', () => {
    it('should retrieve comprehensive event settings including granular download flags and watermarks', async () => {
      const event = await createTestEvent({
        name: 'Settings Test Event',
        client_name: 'Client A',
        watermark_enabled: true,
        watermark_text: 'Custom Mark',
      });

      const getRes = await request(app)
        .get(`/api/events/${event.id}`)
        .set('Cookie', [authCookie]);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.event.id).toBe(event.id);
      expect(getRes.body.data.event.name).toBe('Settings Test Event');
      expect(getRes.body.data.event.watermark_text).toBe('Custom Mark');
      expect(getRes.body.data.event.allow_photo_downloads).toBe(true);
      expect(getRes.body.data.event.allow_bulk_downloads).toBe(true);
      expect(getRes.body.data.event.allow_video_downloads).toBe(true);
      expect(getRes.body.data.event.face_search_enabled).toBe(true);
    });

    it('should update event settings via PUT/PATCH and persist all fields across reloads', async () => {
      const event = await createTestEvent({ name: 'Before Update' });

      const updateRes = await request(app)
        .put(`/api/events/${event.id}`)
        .set('Cookie', [authCookie])
        .send({
          name: 'After Update Title',
          description: 'Updated descriptions',
          location: 'Monaco Harbor',
          public_duration_days: 14,
          allow_downloads: true,
          allow_photo_downloads: false,
          allow_bulk_downloads: true,
          allow_video_downloads: false,
          watermark_enabled: true,
          watermark_text: 'MONACO ARCHIVE',
          watermark_opacity: 0.65,
          watermark_position: 'bottom-center',
          watermark_size: 'large',
          watermark_color: 'white',
          face_search_enabled: false,
        });

      expect(updateRes.status).toBe(200);
      const updated = updateRes.body.data.event;
      expect(updated.name).toBe('After Update Title');
      expect(updated.location).toBe('Monaco Harbor');
      expect(updated.public_duration_days).toBe(14);
      expect(updated.allow_photo_downloads).toBe(false);
      expect(updated.allow_bulk_downloads).toBe(true);
      expect(updated.allow_video_downloads).toBe(false);
      expect(updated.watermark_text).toBe('MONACO ARCHIVE');
      expect(updated.watermark_opacity).toBe(0.65);
      expect(updated.watermark_position).toBe('bottom-center');
      expect(updated.watermark_size).toBe('large');
      expect(updated.watermark_color).toBe('white');
      expect(updated.face_search_enabled).toBe(false);

      // Verify persistence by reloading from database
      const reloadRes = await request(app)
        .get(`/api/events/${event.id}`)
        .set('Cookie', [authCookie]);

      expect(reloadRes.status).toBe(200);
      expect(reloadRes.body.data.event.name).toBe('After Update Title');
      expect(reloadRes.body.data.event.allow_photo_downloads).toBe(false);
      expect(reloadRes.body.data.event.face_search_enabled).toBe(false);
    });
  });

  describe('2. Strict Isolation Between Events', () => {
    it('modifying settings on Event A must never alter settings on Event B', async () => {
      const eventA = await createTestEvent({
        name: 'Event Alpha',
        allow_photo_downloads: true,
        watermark_text: 'Alpha Mark',
      });

      const eventB = await createTestEvent({
        name: 'Event Beta',
        allow_photo_downloads: true,
        watermark_text: 'Beta Mark',
      });

      // Update Event A
      await request(app)
        .put(`/api/events/${eventA.id}`)
        .set('Cookie', [authCookie])
        .send({
          allow_photo_downloads: false,
          watermark_text: 'MODIFIED ALPHA',
        });

      // Fetch Event B and verify it remains completely unchanged
      const resB = await request(app)
        .get(`/api/events/${eventB.id}`)
        .set('Cookie', [authCookie]);

      expect(resB.body.data.event.name).toBe('Event Beta');
      expect(resB.body.data.event.allow_photo_downloads).toBe(true);
      expect(resB.body.data.event.watermark_text).toBe('Beta Mark');
    });
  });

  describe('3. Public vs Private Visibility & Guest Access', () => {
    it('should permit guest access when event is public and active', async () => {
      const event = await createTestEvent({ visibility: 'public' });

      const guestRes = await request(app).get(`/api/guest/event/${event.slug}`);
      expect(guestRes.status).toBe(200);
      expect(guestRes.body.data.event.name).toBe(event.name);
    });

    it('should deny guest access with 403 when gallery is switched to private', async () => {
      const event = await createTestEvent({ visibility: 'public' });

      // Switch to private
      await request(app)
        .patch(`/api/events/${event.id}/visibility`)
        .set('Cookie', [authCookie])
        .send({ visibility: 'private' });

      const guestRes = await request(app).get(`/api/guest/event/${event.slug}`);
      expect(guestRes.status).toBe(403);
    });
  });

  describe('4. PIN Protection Enforcement', () => {
    it('should enable PIN and require guests to enter correct PIN', async () => {
      const event = await createTestEvent({
        pin_enabled: true,
        pin: '9842',
        visibility: 'public',
      });

      // Guest metadata should indicate pin_protected = true
      const metaRes = await request(app).get(`/api/guest/event/${event.slug}`);
      expect(metaRes.status).toBe(200);
      expect(metaRes.body.data.event.pin_protected).toBe(true);
      expect(metaRes.body.data.event.pin_hash).toBeUndefined(); // Never exposed

      // Accessing gallery without PIN should be rejected with 401
      const galleryRes = await request(app).get(`/api/guest/gallery/${event.slug}`);
      expect(galleryRes.status).toBe(401);

      // Verify incorrect PIN is rejected
      const failPin = await request(app)
        .post(`/api/guest/verify-pin/${event.slug}`)
        .send({ pin: '0000' });
      expect(failPin.status).toBe(401);

      // Verify correct PIN succeeds and issues guest token
      const successPin = await request(app)
        .post(`/api/guest/verify-pin/${event.slug}`)
        .send({ pin: '9842' });
      expect(successPin.status).toBe(200);
      expect(successPin.body.data.guestToken).toBeDefined();

      // Accessing gallery with guest token succeeds
      const authorizedGallery = await request(app)
        .get(`/api/guest/gallery/${event.slug}`)
        .set('x-guest-token', successPin.body.data.guestToken);
      expect(authorizedGallery.status).toBe(200);
    });
  });

  describe('5. Granular Download Permissions Server-Side Enforcement', () => {
    it('should reject bulk download job creation if allow_bulk_downloads is disabled', async () => {
      const event = await createTestEvent({
        allow_downloads: true,
        allow_bulk_downloads: false,
        visibility: 'public',
      });

      const res = await request(app)
        .post(`/api/guest/gallery/${event.slug}/download-zip`)
        .send({ mediaIds: [] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DOWNLOADS_DISABLED');
    });

    it('should reject download request if master allow_downloads is disabled', async () => {
      const event = await createTestEvent({
        allow_downloads: false,
        visibility: 'public',
      });

      const res = await request(app)
        .post(`/api/guest/gallery/${event.slug}/download-zip`)
        .send({ mediaIds: [] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DOWNLOADS_DISABLED');
    });
  });

  describe('6. AI Face Search Disabling Server Enforcement', () => {
    it('should reject guest face search with 403 when face_search_enabled is false', async () => {
      const event = await createTestEvent({
        face_search_enabled: false,
        visibility: 'public',
      });

      // Dummy base64 1x1 png
      const dummySelfie = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const searchRes = await request(app)
        .post(`/api/guest/face-search/${event.slug}`)
        .send({ image: dummySelfie });

      expect(searchRes.status).toBe(403);
      expect(searchRes.body.error.code).toBe('FACE_SEARCH_DISABLED');
    });
  });

  describe('7. Watermark Settings Versioning & Master Non-Destruction', () => {
    it('should increment watermark_version when watermark settings change', async () => {
      const event = await createTestEvent({
        watermark_enabled: true,
        watermark_text: 'V1 Mark',
      });

      expect(event.watermark_version).toBe(1);

      // Update watermark text
      const updateRes = await request(app)
        .put(`/api/events/${event.id}`)
        .set('Cookie', [authCookie])
        .send({
          watermark_text: 'V2 Mark Updated',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.event.watermark_version).toBe(2);
    });
  });

  describe('8. Lifecycle: Active vs Archived vs Trashed', () => {
    it('should transition between active, archived, and trashed states correctly', async () => {
      const event = await createTestEvent({ visibility: 'public' });

      // 1. Archive event
      const archiveRes = await request(app)
        .post(`/api/events/${event.id}/archive`)
        .set('Cookie', [authCookie]);
      expect(archiveRes.status).toBe(200);

      // Verify archived event is hidden from guests
      const guestRes = await request(app).get(`/api/guest/event/${event.slug}`);
      expect(guestRes.status).toBe(403);

      // 2. Restore / unarchive event
      const restoreRes = await request(app)
        .post(`/api/events/${event.id}/restore`)
        .set('Cookie', [authCookie]);
      expect(restoreRes.status).toBe(200);

      // 3. Move to Recycle Bin
      const trashRes = await request(app)
        .post(`/api/events/${event.id}/trash`)
        .set('Cookie', [authCookie]);
      expect(trashRes.status).toBe(200);
      expect(trashRes.body.data.status).toBe('trashed');

      // Verify it appears in bin
      const binRes = await request(app)
        .get('/api/events/bin')
        .set('Cookie', [authCookie]);
      expect(binRes.status).toBe(200);
      expect(binRes.body.data.events.some((e: any) => e.id === event.id)).toBe(true);
    });
  });
});
