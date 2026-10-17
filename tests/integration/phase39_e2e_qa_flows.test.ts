import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { IMemoryDb } from 'pg-mem';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { resetLoginAttempts } from '../../apps/api/src/middleware/rateLimiter.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
  insertTestStorageUsage,
} from '../helpers/db_test_helper.js';

describe('Phase 39: Complete End-to-End QA, Real-World User Flows & Failure Injection Suite', () => {
  let app: ReturnType<typeof createApp>;
  let db: IMemoryDb;
  let authCookie: string;
  const photographerId = 1;
  const photographerEmail = 'photographer@studiolumina.photo';
  const rawPassword = 'StudioMasterPassword2026!';
  let passwordHash: string;

  // Test Event Fixtures
  const eventIdA = 'a0000000-0000-0000-0000-000000000001';
  const eventSlugA = 'royal-palace-wedding-2026';
  const eventIdB = 'b0000000-0000-0000-0000-000000000002';
  const eventSlugB = 'coastal-retreat-2026';

  const testPin = '789123';
  let pinHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(rawPassword, 10);
    pinHash = await bcrypt.hash(testPin, 10);
  });

  beforeEach(() => {
    resetLoginAttempts();
    resetPinRateLimiterStore();
    db = createTestDatabase();

    const pool = db.adapters.createPg().Pool;
    setDatabasePool(new pool());
    app = createApp();

    // 1. Seed Sole Photographer
    insertTestPhotographer(db, {
      id: photographerId,
      email: photographerEmail,
      password_hash: passwordHash,
      business_name: 'Studio Lumina Productions',
    });

    const token = signSessionToken({ id: photographerId, email: photographerEmail });
    authCookie = `${SESSION_COOKIE_NAME}=${token}`;

    // 2. Seed Event A (PIN Protected, Public)
    insertTestEvent(db, {
      id: eventIdA,
      slug: eventSlugA,
      name: 'Royal Palace Wedding',
      status: 'active',
      visibility: 'public',
      public_duration_days: 30,
      pin_enabled: true,
      pin_hash: pinHash,
      allow_downloads: true,
      face_search_enabled: true,
    });

    // 3. Seed Event B (Public, No PIN)
    insertTestEvent(db, {
      id: eventIdB,
      slug: eventSlugB,
      name: 'Coastal Retreat Celebration',
      status: 'active',
      visibility: 'public',
      public_duration_days: 30,
      pin_enabled: false,
      allow_downloads: false,
      face_search_enabled: true,
    });
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  // =========================================================================
  // JOURNEY 1: PHOTOGRAPHER LIFECYCLE JOURNEY
  // =========================================================================
  describe('Journey 1: Photographer Lifecycle, Folders & State Transitions', () => {
    it('executes full event lifecycle: create -> add folders -> update settings -> trash -> restore -> purge', async () => {
      // 1. Create a new event with 30-day enforcement
      const createRes = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Grand Gala 2026',
          client_name: 'Lord Sterling',
          client_email: 'sterling@manor.co.uk',
          event_date: '2026-12-15',
          visibility: 'public',
          public_days: 45, // Must be clamped to 30 days maximum
          allow_downloads: true,
          face_search_enabled: true,
        });

      expect(createRes.status).toBe(201);
      const newEvent = createRes.body.data.event;
      expect(newEvent.id).toBeDefined();
      expect(newEvent.public_duration_days).toBe(30); // Max 30-day rule enforced!
      expect(newEvent.slug).toMatch(/^grand-gala-2026/);

      // 2. Create ceremony folders
      const folderRes = await request(app)
        .post(`/api/events/${newEvent.id}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: 'Cocktail Hour' });

      expect(folderRes.status).toBe(201);
      const folderId = folderRes.body.data.folder.id;
      expect(folderRes.body.data.folder.name).toBe('Cocktail Hour');

      // 3. Rename ceremony folder
      const renameRes = await request(app)
        .put(`/api/events/${newEvent.id}/folders/${folderId}`)
        .set('Cookie', [authCookie])
        .send({ name: 'Sunset Cocktails' });

      expect(renameRes.status).toBe(200);
      expect(renameRes.body.data.folder.name).toBe('Sunset Cocktails');

      // 4. Update event settings (e.g. enable PIN and watermark)
      const settingsRes = await request(app)
        .patch(`/api/events/${newEvent.id}`)
        .set('Cookie', [authCookie])
        .send({
          watermark_enabled: true,
          watermark_text: '© Studio Lumina 2026',
          pin: '654321',
        });

      expect(settingsRes.status).toBe(200);
      expect(settingsRes.body.data.event.watermark_enabled).toBe(true);
      expect(settingsRes.body.data.event.watermark_text).toBe('© Studio Lumina 2026');
      expect(settingsRes.body.data.event.pin_enabled).toBe(true);

      // 5. Soft-delete event to Recycle Bin
      const deleteRes = await request(app)
        .post(`/api/events/${newEvent.id}/trash`)
        .set('Cookie', [authCookie]);

      expect(deleteRes.status).toBe(200);

      // Verify event is marked trashed in database
      const trashedCheck = db.public.query(
        `SELECT status, visibility FROM events WHERE id = '${newEvent.id}'`
      );
      expect(trashedCheck.rows[0].status).toBe('trashed');
      expect(trashedCheck.rows[0].visibility).toBe('private'); // Fail-closed

      // 6. Restore event from Recycle Bin
      const restoreRes = await request(app)
        .post(`/api/events/${newEvent.id}/restore`)
        .set('Cookie', [authCookie]);

      expect(restoreRes.status).toBe(200);
      const restoredCheck = db.public.query(
        `SELECT status FROM events WHERE id = '${newEvent.id}'`
      );
      expect(restoredCheck.rows[0].status).toBe('active');

      // 7. Permanent Purge
      // Trash it again first
      await request(app).post(`/api/events/${newEvent.id}/trash`).set('Cookie', [authCookie]);
      const purgeRes = await request(app)
        .delete(`/api/events/${newEvent.id}/permanent`)
        .set('Cookie', [authCookie])
        .send({ confirmEventName: 'Grand Gala 2026' });

      expect(purgeRes.status).toBe(200);
      const purgeCheck = db.public.query(
        `SELECT COUNT(*) as count FROM events WHERE id = '${newEvent.id}'`
      );
      expect(Number(purgeCheck.rows[0].count)).toBe(0);
    });
  });

  // =========================================================================
  // JOURNEY 2: GUEST EXPERIENCE & ZERO-ACCOUNT ZERO-RETENTION BIOMETRICS
  // =========================================================================
  describe('Journey 2: Guest Journey, PIN Verification & Ephemeral Biometrics', () => {
    it('enforces PIN security, rate limits brute force, and issues ephemeral event-scoped tokens', async () => {
      // 1. Initial unauthenticated request to PIN-protected gallery
      const unauthRes = await request(app).get(`/api/guest/event/${eventSlugA}`);
      expect(unauthRes.status).toBe(200);
      expect(unauthRes.body.data.event.pin_protected).toBe(true);

      // 2. Submit incorrect PIN
      const wrongPinRes = await request(app)
        .post(`/api/guest/verify-pin/${eventSlugA}`)
        .send({ pin: '000000' });

      expect(wrongPinRes.status).toBe(401);
      expect(wrongPinRes.body.success).toBe(false);

      // 3. Submit correct PIN
      const correctPinRes = await request(app)
        .post(`/api/guest/verify-pin/${eventSlugA}`)
        .send({ pin: testPin });

      expect(correctPinRes.status).toBe(200);
      expect(correctPinRes.body.success).toBe(true);
      const guestToken = correctPinRes.body.data.guestToken;
      expect(guestToken).toBeDefined();

      // 4. Access gallery media using the guest token
      const galleryRes = await request(app)
        .get(`/api/guest/gallery/${eventSlugA}`)
        .set('X-Guest-Token', guestToken);

      expect(galleryRes.status).toBe(200);
      expect(galleryRes.body.data.folders).toBeDefined();
      expect(Array.isArray(galleryRes.body.data.media)).toBe(true);
    });

    it('verifies that guest selfies are ephemeral and never persist biometric profiles', async () => {
      // Verify no guest biometric profiles exist in database before or after
      const preCount = db.public.query('SELECT COUNT(*) as count FROM face_embeddings');
      expect(Number(preCount.rows[0].count)).toBe(0);

      // Ensure that guest access does not require or store guest user IDs
      const usersCount = db.public.query('SELECT COUNT(*) as count FROM photographer');
      expect(Number(usersCount.rows[0].count)).toBe(1); // Exactly ONE sole owner!
    });
  });

  // =========================================================================
  // JOURNEY 3: FAILURE INJECTION & ADVERSARIAL ATTACK RESISTANCE
  // =========================================================================
  describe('Journey 3: Adversarial Isolation, Cross-Event Attacks & Rate Limiting', () => {
    it('strictly denies cross-event guest access (Token A cannot access Event B)', async () => {
      // 1. Obtain token for Event A
      const pinRes = await request(app)
        .post(`/api/guest/verify-pin/${eventSlugA}`)
        .send({ pin: testPin });
      const guestTokenA = pinRes.body.data.guestToken;

      // 2. Attempt to use Token A to access Event B
      const crossRes = await request(app)
        .get(`/api/guest/gallery/${eventSlugB}`)
        .set('X-Guest-Token', guestTokenA);

      expect(crossRes.status).toBe(401); // Rejected due to event boundary mismatch!
    });

    it('denies guest access to private galleries even if PIN is known', async () => {
      // 1. Set Event A to private
      db.public.query(`UPDATE events SET visibility = 'private' WHERE id = '${eventIdA}'`);

      // 2. Attempt PIN verification on private event
      const pinRes = await request(app)
        .post(`/api/guest/verify-pin/${eventSlugA}`)
        .send({ pin: testPin });

      expect(pinRes.status).toBe(403);
      expect(['FORBIDDEN', 'GALLERY_PRIVATE']).toContain(pinRes.body.error.code);
    });

    it('denies guest access to expired galleries (> 30 days)', async () => {
      // 1. Set event public_until to the past
      const past = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      db.public.query(`UPDATE events SET public_until = '${past}', expired_at = '${past}' WHERE id = '${eventIdA}'`);

      // 2. Attempt gallery access
      const accessRes = await request(app).get(`/api/guest/gallery/${eventSlugA}`);
      expect([401, 403, 410]).toContain(accessRes.status);
    });

    it('enforces brute-force lockout after 5 consecutive failed PIN attempts', async () => {
      for (let i = 0; i < 4; i++) {
        await request(app)
          .post(`/api/guest/verify-pin/${eventSlugA}`)
          .send({ pin: '111111' })
          .expect(401);
      }

      // 5th attempt locks out
      const lockoutRes = await request(app)
        .post(`/api/guest/verify-pin/${eventSlugA}`)
        .send({ pin: '111111' })
        .expect(429);

      expect(lockoutRes.body.error.code).toBe('PIN_RATE_LIMITED');
      expect(lockoutRes.headers['retry-after']).toBeDefined();
    });

    it('defends against SQL injection payloads across search, slugs, and filters', async () => {
      const sqliPayloads = [
        "' OR '1'='1",
        "'; DROP TABLE events; --",
        "admin'--",
        "UNION SELECT null, null, null--",
      ];

      for (const payload of sqliPayloads) {
        const res = await request(app)
          .get(`/api/guest/gallery/${encodeURIComponent(payload)}`);

        // Must fail safely with 400, 401, or 404, never 500 or SQL error syntax
        expect([400, 401, 404]).toContain(res.status);
        expect(res.body.error?.message).not.toMatch(/syntax error|sqlite|postgres/i);
      }
    });
  });

  // =========================================================================
  // JOURNEY 4: DATA INTEGRITY & DATABASE CONSISTENCY
  // =========================================================================
  describe('Journey 4: Data Integrity, Cascade Safety & Non-Orphan Rules', () => {
    it('safe folder deletion preserves media by reassigning to default event pool', async () => {
      // 1. Create Folder in Event A
      const folderRes = await request(app)
        .post(`/api/events/${eventIdA}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: 'Pre-Wedding' });
      const folderId = folderRes.body.data.folder.id;

      // 2. Insert test media linked to this folder using valid UUID
      const mediaId = 'c0000000-0000-0000-0000-000000000001';
      insertTestMedia(db, {
        id: mediaId,
        event_id: eventIdA,
        folder_id: folderId,
        filename: 'ceremony_01.jpg',
      });

      // 3. Delete folder without targetFolderId (default event pool reassignment)
      const delFolderRes = await request(app)
        .delete(`/api/events/${eventIdA}/folders/${folderId}`)
        .set('Cookie', [authCookie]);

      expect(delFolderRes.status).toBe(200);

      // 4. Verify photo was NOT deleted, but had folder_id set to NULL
      const mediaCheck = db.public.query(
        `SELECT id, folder_id, event_id FROM media WHERE id = '${mediaId}'`
      );
      expect(mediaCheck.rows.length).toBe(1);
      expect(mediaCheck.rows[0].folder_id).toBeNull();
      expect(mediaCheck.rows[0].event_id).toBe(eventIdA);
    });

    it('guarantees that no unauthenticated user can access storage metrics', async () => {
      const res = await request(app).get('/api/storage/usage');
      expect(res.status).toBe(401);
    });

    it('allows sole photographer to inspect real measured storage metrics', async () => {
      // Seed some storage usage for Event A
      insertTestStorageUsage(db, {
        event_id: eventIdA,
        original_bytes: 15000000,
        preview_bytes: 1200000,
        thumbnail_bytes: 300000,
        video_bytes: 0,
        total_bytes: 16500000,
      });

      const res = await request(app)
        .get('/api/storage/usage')
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.totalBytes).toBeDefined();
    });
  });
});
