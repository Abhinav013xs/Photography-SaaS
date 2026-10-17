import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { assertValidStorageKey } from '../../server/storage/r2.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestMedia,
  insertTestFaceEmbedding,
} from '../helpers/db_test_helper.js';
import type { IMemoryDb } from 'pg-mem';

describe('Phase 36: Production Security, Privacy & Biometric Protection Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'SecurePhotographer2026!';
  let authCookie: string;
  let validJpegBuffer: Buffer;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    db = createTestDatabase();
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography'),
              (2, 'other@studiolumina.photo', '${passwordHash}', 'Studio Other', 'Commercial Photography')
       ON CONFLICT (id) DO NOTHING;`
    );

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);

    // Create valid test image buffers
    validJpegBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 150, b: 100 } },
    })
      .jpeg()
      .toBuffer();

    // Authenticate photographer 1
    const loginRes = await request(app).post('/api/auth/login').send({
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

  // =========================================================================
  // 1. Storage Key Security & Path Traversal Immunity
  // =========================================================================
  describe('Storage Key & Path Traversal Defense', () => {
    it('accepts strictly formatted deterministic storage keys', () => {
      const validKey = 'events/e3600000-0000-0000-0000-000000000001/originals/photo1.jpg';
      expect(assertValidStorageKey(validKey)).toBe(true);
    });

    it('rejects keys containing path traversal sequences (..)', () => {
      expect(() => {
        assertValidStorageKey('events/e3600000-0000-0000-0000-000000000001/originals/../../secret.txt');
      }).toThrow(/path traversal/i);
    });

    it('rejects keys containing backslashes or null bytes', () => {
      expect(() => {
        assertValidStorageKey('events/e3600000-0000-0000-0000-000000000001\\originals\\photo.jpg');
      }).toThrow(/path traversal/i);

      expect(() => {
        assertValidStorageKey('events/e3600000-0000-0000-0000-000000000001/originals/photo\0.jpg');
      }).toThrow(/path traversal/i);
    });

    it('rejects keys with non-UUID event identifiers', () => {
      expect(() => {
        assertValidStorageKey('events/not-a-valid-uuid/originals/photo.jpg');
      }).toThrow(/invalid event uuid/i);
    });

    it('rejects keys with unauthorized storage categories', () => {
      expect(() => {
        assertValidStorageKey('events/e3600000-0000-0000-0000-000000000001/database/dump.sql');
      }).toThrow(/category "database" is not permitted/i);
    });
  });

  // =========================================================================
  // 2. Download Authorization & IDOR Defense
  // =========================================================================
  describe('Download Authorization & Event Boundary Enforcement', () => {
    it('denies downloads for private galleries (fails closed with 403 Forbidden)', async () => {
      const eventId = 'e3600000-0000-0000-0000-000000000010';
      const mediaId = 'd3600000-0000-0000-0000-000000000010';

      insertTestEvent(db, {
        id: eventId,
        owner_id: 1,
        slug: 'private-security-event',
        visibility: 'private', // Gallery is private
        status: 'active',
        allow_downloads: true,
      });

      insertTestMedia(db, {
        id: mediaId,
        event_id: eventId,
        status: 'ready',
        filename: 'wedding_private.jpg',
      });

      // Guest attempts to download photo from private gallery
      const res = await request(app).get(`/api/media/download/${mediaId}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(['FORBIDDEN', 'AUTHORIZATION_REQUIRED']).toContain(res.body.error.code);
    });

    it('denies downloads for expired galleries (fails closed with 410 Gone)', async () => {
      const eventId = 'e3600000-0000-0000-0000-000000000011';
      const mediaId = 'd3600000-0000-0000-0000-000000000011';

      // Past date: expired 2 days ago
      const expiredDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

      insertTestEvent(db, {
        id: eventId,
        owner_id: 1,
        slug: 'expired-security-event',
        visibility: 'public',
        status: 'active',
        public_until: expiredDate,
        allow_downloads: true,
      });

      insertTestMedia(db, {
        id: mediaId,
        event_id: eventId,
        status: 'ready',
        filename: 'wedding_expired.jpg',
      });

      const res = await request(app).get(`/api/media/download/${mediaId}`);
      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GALLERY_EXPIRED');
    });

    it('denies downloads when photographer has disabled downloads toggle', async () => {
      const eventId = 'e3600000-0000-0000-0000-000000000012';
      const mediaId = 'd3600000-0000-0000-0000-000000000012';

      insertTestEvent(db, {
        id: eventId,
        owner_id: 1,
        slug: 'no-downloads-event',
        visibility: 'public',
        status: 'active',
        allow_downloads: false, // Photographer turned off downloads
      });

      insertTestMedia(db, {
        id: mediaId,
        event_id: eventId,
        status: 'ready',
        filename: 'wedding_no_dl.jpg',
      });

      const res = await request(app).get(`/api/media/download/${mediaId}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOWNLOADS_DISABLED');
    });

    it('denies bulk ZIP download triggers on private or expired events', async () => {
      const eventId = 'e3600000-0000-0000-0000-000000000013';

      insertTestEvent(db, {
        id: eventId,
        owner_id: 1,
        slug: 'bulk-private-event',
        visibility: 'private',
        status: 'active',
        allow_downloads: true,
      });

      const res = await request(app).post(`/api/media/download-zip/${eventId}`).send({});
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 3. Upload Security & Malicious File Rejection
  // =========================================================================
  describe('File Upload Security & Input Validation', () => {
    it('rejects files with dangerous double extensions (e.g. photo.php.jpg)', async () => {
      const eventId = 'e3600000-0000-0000-0000-000000000020';
      insertTestEvent(db, { id: eventId, owner_id: 1 });

      const res = await request(app)
        .post(`/api/events/${eventId}/media/presign-batch`)
        .set('Cookie', authCookie)
        .send({
          items: [
            {
              filename: 'exploit.php.jpg', // Dangerous double extension
              fileSizeBytes: 1024,
              mimeType: 'image/jpeg',
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/dangerous double extension|validation/i);
    });

    it('rejects filenames with directory traversal characters or control characters', async () => {
      const eventId = 'e3600000-0000-0000-0000-000000000021';
      insertTestEvent(db, { id: eventId, owner_id: 1 });

      const res = await request(app)
        .post(`/api/events/${eventId}/media/presign-batch`)
        .set('Cookie', authCookie)
        .send({
          items: [
            {
              filename: '../../etc/passwd.jpg',
              fileSizeBytes: 1024,
              mimeType: 'image/jpeg',
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects disallowed MIME types and non-whitelisted extensions', async () => {
      const eventId = 'e3600000-0000-0000-0000-000000000022';
      insertTestEvent(db, { id: eventId, owner_id: 1 });

      const res = await request(app)
        .post(`/api/events/${eventId}/media/presign-batch`)
        .set('Cookie', authCookie)
        .send({
          items: [
            {
              filename: 'trojan.exe',
              fileSizeBytes: 1024,
              mimeType: 'application/octet-stream',
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 4. Authentication Timing Defense & Enumeration Protection
  // =========================================================================
  describe('Authentication Security & Timing Attack Mitigation', () => {
    it('returns generic error on bad credentials without revealing account existence', async () => {
      const resNonexistent = await request(app).post('/api/auth/login').send({
        email: 'does_not_exist@example.com',
        password: 'SomePassword123!',
      });

      expect(resNonexistent.status).toBe(401);
      expect(resNonexistent.body.success).toBe(false);
      expect(resNonexistent.body.error.message).toMatch(/invalid email or password/i);

      const resWrongPass = await request(app).post('/api/auth/login').send({
        email: 'photographer@studiolumina.photo',
        password: 'IncorrectPassword999!',
      });

      expect(resWrongPass.status).toBe(401);
      expect(resWrongPass.body.success).toBe(false);
      expect(resWrongPass.body.error.message).toMatch(/invalid email or password/i);
    });

    it('enforces password policy on password update (minimum 8 chars)', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .set('Cookie', authCookie)
        .send({
          currentPassword: TEST_PASSWORD,
          newPassword: 'short', // Too short
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 5. Biometric Privacy & Zero-Retention Verification
  // =========================================================================
  describe('Biometric Privacy & Zero Retention', () => {
    it('verifies that face search does not retain query selfies or expose raw embeddings', async () => {
      const eventId = 'e3600000-0000-0000-0000-000000000030';
      insertTestEvent(db, {
        id: eventId,
        owner_id: 1,
        slug: 'biometric-privacy-event',
        visibility: 'public',
        face_search_enabled: true,
      });

      const mediaId = 'd3600000-0000-0000-0000-000000000030';
      insertTestMedia(db, {
        id: mediaId,
        event_id: eventId,
        status: 'ready',
      });

      // Insert an indexed face for this event
      const sampleEmbedding = new Array(128).fill(0.088);
      insertTestFaceEmbedding(db, {
        event_id: eventId,
        photo_id: mediaId,
        embedding: sampleEmbedding,
      });

      // Search request
      const res = await request(app)
        .post(`/api/events/${eventId}/face-search`)
        .send({
          image: `data:image/jpeg;base64,${validJpegBuffer.toString('base64')}`,
        });

      // The response MUST NOT contain any raw 128-D vector arrays
      const resString = JSON.stringify(res.body);
      expect(resString).not.toContain('"embedding":[');
      expect(resString).not.toContain('"vector":[');

      // Verify no permanent guest table exists in database
      const tables = db.public.many(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`
      );
      const tableNames = tables.map((t: any) => t.table_name);
      expect(tableNames).not.toContain('guests');
      expect(tableNames).not.toContain('guest_biometrics');
      expect(tableNames).not.toContain('guest_selfies');
    });
  });
});
