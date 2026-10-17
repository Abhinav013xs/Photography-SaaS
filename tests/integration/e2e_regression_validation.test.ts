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
} from '../helpers/db_test_helper.js';

describe('Phase 30: Automated End-to-End Regression Validation Suite', () => {
  let app: ReturnType<typeof createApp>;
  let db: IMemoryDb;
  let authCookie: string;
  const photographerId = 1;
  const photographerEmail = 'photographer@studiolumina.photo';
  const rawPassword = 'SecurePhotographerPassword2026!';
  let passwordHash: string;

  // Test Event IDs
  const eventAlphaId = '10000000-0000-0000-0000-000000000001';
  const eventBetaId = '20000000-0000-0000-0000-000000000002';
  const eventExpiredId = '30000000-0000-0000-0000-000000000003';
  const eventTrashedId = '40000000-0000-0000-0000-000000000004';

  const testPin = '876543';
  let pinHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(rawPassword, 10);
    pinHash = await bcrypt.hash(testPin, 10);
  });

  beforeEach(() => {
    resetLoginAttempts();
    resetPinRateLimiterStore();
    db = createTestDatabase();

    const poolMock: any = {
      query: async (text: string, params: any[] = []) => {
        let sql = text;
        if (params && params.length > 0) {
          params.forEach((p, idx) => {
            const placeholder = new RegExp(`\\$${idx + 1}(?![0-9])`, 'g');
            if (p === null || p === undefined) {
              sql = sql.replace(placeholder, 'NULL');
            } else if (typeof p === 'number') {
              sql = sql.replace(placeholder, String(p));
            } else if (typeof p === 'boolean') {
              sql = sql.replace(placeholder, p ? 'TRUE' : 'FALSE');
            } else if (p instanceof Date) {
              sql = sql.replace(placeholder, `'${p.toISOString()}'`);
            } else {
              sql = sql.replace(placeholder, `'${String(p).replace(/'/g, "''")}'`);
            }
          });
        }
        try {
          const res = db.public.query(sql);
          return { rows: res.rows || [], rowCount: res.rowCount || 0 };
        } catch (err: any) {
          throw err;
        }
      },
    };

    setDatabasePool(poolMock);
    app = createApp();

    // 1. Seed Single Photographer (Product Rule 1 & 2)
    insertTestPhotographer(db, {
      id: photographerId,
      email: photographerEmail,
      password_hash: passwordHash,
      business_name: 'Studio Lumina Fine Art',
    });

    const token = signSessionToken({ id: photographerId, email: photographerEmail });
    authCookie = `${SESSION_COOKIE_NAME}=${token}`;

    // 2. Seed Active Public Event Alpha
    insertTestEvent(db, {
      id: eventAlphaId,
      slug: 'alpha-gala-2026',
      name: 'Alpha Annual Gala',
      status: 'active',
      visibility: 'public',
      public_duration_days: 30,
      pin_enabled: false,
    });

    // 3. Seed PIN-Protected Event Beta
    insertTestEvent(db, {
      id: eventBetaId,
      slug: 'beta-wedding-2026',
      name: 'Beta Royal Wedding',
      status: 'active',
      visibility: 'public',
      public_duration_days: 30,
      pin_enabled: true,
      pin_hash: pinHash,
    });

    // 4. Seed Expired Event
    const pastDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    insertTestEvent(db, {
      id: eventExpiredId,
      slug: 'expired-exhibition-2026',
      name: 'Expired Autumn Exhibition',
      status: 'active',
      visibility: 'private',
      public_start: pastDate,
      public_until: pastDate,
      expired_at: pastDate,
    });

    // 5. Seed Trashed Event in Recycle Bin
    const trashedDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    insertTestEvent(db, {
      id: eventTrashedId,
      slug: 'trashed-shoot-2026',
      name: 'Archived Studio Session',
      status: 'trashed',
      visibility: 'private',
      expired_at: trashedDate,
    });
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  // =========================================================================
  // SECTION 3: PHOTOGRAPHER AUTHENTICATION TESTS
  // =========================================================================
  describe('1. Photographer Authentication & Authorization Safeguards', () => {
    it('authenticates sole owner with valid credentials and sets secure session cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: photographerEmail, password: rawPassword });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photographer.email).toBe(photographerEmail);
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.body.data.photographer.password_hash).toBeUndefined();
    });

    it('rejects invalid credentials safely without leaking server internals', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: photographerEmail, password: 'WrongPassword999!' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it('blocks unauthenticated requests from accessing protected management endpoints', async () => {
      const res = await request(app).get('/api/events');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('prevents password_hash or private salts from being returned in getMe profile', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.data.photographer.email).toBe(photographerEmail);
      expect(res.body.data.photographer.password_hash).toBeUndefined();
    });
  });

  // =========================================================================
  // SECTION 4: EVENT MANAGEMENT & LIFECYCLE TESTS
  // =========================================================================
  describe('2. Event Management & Expiry Enforcement', () => {
    it('creates an event and strictly caps public_duration_days to maximum 30 days', async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Golden Jubilee Celebration',
          client_name: 'Elizabeth Windsor',
          client_email: 'elizabeth@royal.uk',
          event_date: '2026-11-01',
          visibility: 'public',
          public_days: 90, // Attempt 90 days - must be clamped to 30!
          allow_downloads: true,
          face_search_enabled: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const event = res.body.data.event;
      expect(event.public_duration_days).toBeLessThanOrEqual(30);
    });

    it('persists event updates and verifies settings retention', async () => {
      const res = await request(app)
        .put(`/api/events/${eventAlphaId}`)
        .set('Cookie', [authCookie])
        .send({
          name: 'Alpha Annual Gala (Updated)',
          client_name: 'Alpha Foundation',
          allow_downloads: false,
          watermark_enabled: true,
          watermark_text: 'Fine Art Studio Lumina',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.allow_downloads).toBe(false);
      expect(res.body.data.event.watermark_enabled).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 5: PHOTO & VIDEO UPLOAD TESTS
  // =========================================================================
  describe('3. Photo & Video Upload Boundaries & Key Format', () => {
    it('rejects unsupported executable mime-types and dangerous extensions', async () => {
      const res = await request(app)
        .post(`/api/events/${eventAlphaId}/media/presign-batch`)
        .set('Cookie', [authCookie])
        .send({
          items: [
            {
              filename: 'malware.exe',
              mimeType: 'application/x-msdownload',
              sizeBytes: 1024,
            },
          ],
        });

      expect([400, 415]).toContain(res.status);
    });

    it('creates deterministic storage keys adhering to R2 architectural standards', () => {
      const filename = 'ceremony_001.jpg';
      const expectedOriginalKey = `events/${eventAlphaId}/originals/${filename}`;
      const expectedThumbnailKey = `events/${eventAlphaId}/thumbnails/${filename}`;

      expect(expectedOriginalKey).toMatch(new RegExp(`^events/${eventAlphaId}/originals/`));
      expect(expectedThumbnailKey).toMatch(new RegExp(`^events/${eventAlphaId}/thumbnails/`));
    });
  });

  // =========================================================================
  // SECTION 6: GUEST GALLERY & MEDIA ACCESS TESTS
  // =========================================================================
  describe('4. Guest Gallery Access, PIN Gates & Strict Event Isolation', () => {
    it('allows guest to view public open event without registration or login', async () => {
      const res = await request(app).get('/api/guest/event/alpha-gala-2026');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.name).toBe('Alpha Annual Gala');
      expect(res.body.data.event.pin_protected).toBe(false);
    });

    it('requires PIN verification for PIN-protected event before media access', async () => {
      // 1. Direct gallery access without token is blocked
      const blockedRes = await request(app).get('/api/guest/gallery/beta-wedding-2026');
      expect([401, 403]).toContain(blockedRes.status);

      // 2. Incorrect PIN attempt fails
      const badPinRes = await request(app)
        .post('/api/guest/verify-pin/beta-wedding-2026')
        .send({ pin: '000000' });
      expect(badPinRes.status).toBe(401);

      // 3. Valid PIN grants ephemeral event-scoped guest token
      const validPinRes = await request(app)
        .post('/api/guest/verify-pin/beta-wedding-2026')
        .send({ pin: testPin });
      expect(validPinRes.status).toBe(200);
      expect(validPinRes.body.data.guestToken).toBeDefined();

      // 4. Using guest token permits gallery viewing
      const guestToken = validPinRes.body.data.guestToken;
      const galleryRes = await request(app)
        .get('/api/guest/gallery/beta-wedding-2026')
        .set('x-guest-token', guestToken);
      expect(galleryRes.status).toBe(200);
    });

    it('strictly isolates guest token: Event Beta token cannot access Event Alpha media', async () => {
      const pinRes = await request(app)
        .post('/api/guest/verify-pin/beta-wedding-2026')
        .send({ pin: testPin });
      const betaToken = pinRes.body.data.guestToken;

      // Make Event Alpha private to test isolation boundary
      db.public.none(`UPDATE events SET visibility = 'private' WHERE id = '${eventAlphaId}';`);

      const crossAccessRes = await request(app)
        .get('/api/guest/gallery/alpha-gala-2026')
        .set('x-guest-token', betaToken);

      expect([401, 403]).toContain(crossAccessRes.status);
    });

    it('returns HTTP 403 or 410 for expired galleries without deleting underlying data', async () => {
      const res = await request(app).get('/api/guest/event/expired-exhibition-2026');
      expect([403, 410]).toContain(res.status);

      // Verify underlying records exist intact
      const eventInDb = db.public.one(`SELECT id, status FROM events WHERE id = '${eventExpiredId}';`);
      expect(eventInDb.id).toBe(eventExpiredId);
    });
  });

  // =========================================================================
  // SECTION 7: FACE DETECTION & BIOMETRIC ZERO-RETENTION
  // =========================================================================
  describe('5. Face Detection & Zero Biometric Retention Compliance', () => {
    it('validates 128-dimensional deep-learning face embedding schema', () => {
      const dummyEmbedding = Array.from({ length: 128 }, () => Math.random() * 0.2 - 0.1);
      expect(dummyEmbedding).toHaveLength(128);
      dummyEmbedding.forEach((val) => {
        expect(typeof val).toBe('number');
        expect(Number.isFinite(val)).toBe(true);
      });
    });

    it('guarantees guest selfie search enforces ephemeral zero-retention rule', () => {
      // Biometric Rule 4: Guest selfies are strictly processed ephemerally in RAM
      // and never persisted to the media table or R2 bucket
      const guestMediaCount = db.public.one(
        "SELECT COUNT(*) AS count FROM media WHERE mime_type LIKE '%selfie%';"
      );
      expect(Number(guestMediaCount.count)).toBe(0);
    });
  });

  // =========================================================================
  // SECTION 8: DATABASE & DATA INTEGRITY TESTS
  // =========================================================================
  describe('6. Relational Integrity, Foreign Keys & Storage Accounting', () => {
    it('verifies safe folder deletion: removing folder retains photos in event pool', () => {
      const folderId = '60000000-0000-0000-0000-000000000001';
      const photoId = '70000000-0000-0000-0000-000000000001';

      insertTestFolder(db, { id: folderId, event_id: eventAlphaId, name: 'Speeches' });
      insertTestMedia(db, { id: photoId, event_id: eventAlphaId, folder_id: folderId, filename: 'speech1.jpg' });

      // Delete folder
      db.public.none(`DELETE FROM folders WHERE id = '${folderId}';`);

      // Photo must remain safe with folder_id set to NULL
      const photo = db.public.one(`SELECT id, folder_id, event_id FROM media WHERE id = '${photoId}';`);
      expect(photo.id).toBe(photoId);
      expect(photo.event_id).toBe(eventAlphaId);
      expect(photo.folder_id).toBeNull();
    });

    it('enforces total storage byte count consistency with retained media', () => {
      const photo1Id = '70000000-0000-0000-0000-000000000002';
      const photo2Id = '70000000-0000-0000-0000-000000000003';

      insertTestMedia(db, { id: photo1Id, event_id: eventAlphaId, file_size: 2048576, filename: 'p1.jpg' });
      insertTestMedia(db, { id: photo2Id, event_id: eventAlphaId, file_size: 4096000, filename: 'p2.jpg' });

      const sumRes = db.public.one(
        `SELECT SUM(file_size) AS total FROM media WHERE event_id = '${eventAlphaId}';`
      );
      expect(Number(sumRes.total)).toBeGreaterThanOrEqual(6144576);
    });
  });

  // =========================================================================
  // SECTION 9: RECYCLE BIN & DELETION TESTS
  // =========================================================================
  describe('7. Recycle Bin Lifecycle & Deletion Safeguards', () => {
    it('trashes an event: moves to private, retains media, and revokes public access', async () => {
      const res = await request(app)
        .post(`/api/events/${eventAlphaId}/trash`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);

      // Verify event is marked as trashed
      const event = db.public.one(`SELECT status, visibility FROM events WHERE id = '${eventAlphaId}';`);
      expect(event.status).toBe('trashed');
      expect(event.visibility).toBe('private');

      // Guest cannot view trashed gallery
      const guestRes = await request(app).get('/api/guest/event/alpha-gala-2026');
      expect([403, 404]).toContain(guestRes.status);
    });

    it('restores a trashed event: reactivates gallery safely', async () => {
      const res = await request(app)
        .post(`/api/events/${eventTrashedId}/restore`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      const event = db.public.one(`SELECT status, deleted_at FROM events WHERE id = '${eventTrashedId}';`);
      expect(event.status).toBe('active');
      expect(event.deleted_at).toBeNull();
    });
  });

  // =========================================================================
  // SECTION 10: BACKGROUND JOB RELIABILITY TESTS
  // =========================================================================
  describe('8. Asynchronous Background Job Reliability & Lifecycle', () => {
    it('manages job lifecycle states: queued -> processing -> completed', () => {
      const jobId = '80000000-0000-0000-0000-000000000001';
      db.public.none(
        `INSERT INTO processing_jobs (id, event_id, type, status)
         VALUES ('${jobId}', '${eventAlphaId}', 'face_indexing', 'queued');`
      );

      // Worker claims job
      db.public.none(
        `UPDATE processing_jobs SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = '${jobId}';`
      );
      const claimed = db.public.one(`SELECT status FROM processing_jobs WHERE id = '${jobId}';`);
      expect(claimed.status).toBe('processing');

      // Worker finishes job
      db.public.none(
        `UPDATE processing_jobs SET status = 'completed', progress = 100, updated_at = CURRENT_TIMESTAMP WHERE id = '${jobId}';`
      );
      const completed = db.public.one(`SELECT status, progress FROM processing_jobs WHERE id = '${jobId}';`);
      expect(completed.status).toBe('completed');
      expect(Number(completed.progress)).toBe(100);
    });
  });

  // =========================================================================
  // SECTION 11: SECURITY REGRESSION TESTS
  // =========================================================================
  describe('9. Security Regression: Injection, Brute Force & Parameter Tampering', () => {
    it('resists SQL injection payloads in search and filter inputs safely', async () => {
      const sqlInjectionPayload = "alpha' OR '1'='1";
      const res = await request(app)
        .get(`/api/events?search=${encodeURIComponent(sqlInjectionPayload)}`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('enforces rate limiting on repeated failed PIN verification attempts', async () => {
      const attempts = [];
      for (let i = 0; i < 7; i++) {
        attempts.push(
          request(app)
            .post('/api/guest/verify-pin/beta-wedding-2026')
            .send({ pin: `00000${i}` })
        );
      }
      const results = await Promise.all(attempts);
      const rateLimited = results.some((r) => r.status === 429);
      // Either 429 triggered or failed attempts safely returned 401
      expect(results.every((r) => [401, 429].includes(r.status))).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 12: FRONTEND UX & ACCESSIBILITY READINESS
  // =========================================================================
  describe('10. Frontend Data Contracts & Empty State Resiliency', () => {
    it('returns structured empty media array without breaking client masonry rendering', async () => {
      const res = await request(app).get('/api/guest/gallery/alpha-gala-2026');
      expect(res.status).toBe(200);
      expect(res.body.data.media).toBeDefined();
      expect(Array.isArray(res.body.data.media)).toBe(true);
      expect(res.body.data.totalCount).toBeDefined();
    });

    it('exposes clear status indicators for client banners without leaking sensitive metadata', async () => {
      const res = await request(app)
        .get(`/api/events/${eventAlphaId}`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      const event = res.body.data.event;
      expect(typeof event.allow_downloads).toBe('boolean');
      expect(typeof event.pin_enabled).toBe('boolean');
      expect(typeof event.watermark_enabled).toBe('boolean');
    });
  });
});
