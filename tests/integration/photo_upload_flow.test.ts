import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestFolder,
} from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import { getStorageUsageSummary } from '../../apps/api/src/services/storageService.js';

describe('Phase 10: Photo Upload Engine Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'UploadEnginePassword2026!';
  let authCookie: string;
  let otherAuthCookie: string;

  const EVENT_A_ID = 'e0000000-0000-0000-0000-000000000001';
  const EVENT_B_ID = 'e0000000-0000-0000-0000-000000000002';
  const FOREIGN_EVENT_ID = 'e0000000-0000-0000-0000-000000000099';

  const FOLDER_A_ID = 'f0000000-0000-0000-0000-000000000001';
  const FOLDER_B_ID = 'f0000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    db = createTestDatabase();

    // Photographer 1 (Sole Owner ID = 1)
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography');`
    );

    // Photographer 2 (Other Owner ID = 2 for IDOR / cross-owner tests)
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name)
       VALUES (2, 'other@photographer.com', '${passwordHash}', 'Other Studio');`
    );

    // Event A (Owned by photographer 1)
    insertTestEvent(db, {
      id: EVENT_A_ID,
      owner_id: 1,
      slug: 'wedding-a-2026',
      name: 'Event A — Grand Wedding',
    });

    // Event B (Also owned by photographer 1)
    insertTestEvent(db, {
      id: EVENT_B_ID,
      owner_id: 1,
      slug: 'wedding-b-2026',
      name: 'Event B — Sunset Reception',
    });

    // Foreign Event (Owned by photographer 2)
    insertTestEvent(db, {
      id: FOREIGN_EVENT_ID,
      owner_id: 2,
      slug: 'foreign-event-2026',
      name: 'Foreign Wedding',
    });

    // Folder A in Event A
    insertTestFolder(db, {
      id: FOLDER_A_ID,
      event_id: EVENT_A_ID,
      name: 'Ceremony',
      sort_order: 0,
    });

    // Folder B in Event B
    insertTestFolder(db, {
      id: FOLDER_B_ID,
      event_id: EVENT_B_ID,
      name: 'Reception',
      sort_order: 0,
    });

    const pgAdapter = db.adapters.createPg();
    pool = new pgAdapter.Pool();
    setDatabasePool(pool);

    // Authenticate photographer 1
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({
        email: 'photographer@studiolumina.photo',
        password: TEST_PASSWORD,
      });

    const cookieHeader = loginRes.headers['set-cookie'];
    const sessionCookie = Array.isArray(cookieHeader)
      ? cookieHeader.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : cookieHeader;
    authCookie = sessionCookie ? sessionCookie.split(';')[0] : '';

    // Authenticate photographer 2
    const otherLoginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({
        email: 'other@photographer.com',
        password: TEST_PASSWORD,
      });

    const otherCookieHeader = otherLoginRes.headers['set-cookie'];
    const otherSessionCookie = Array.isArray(otherCookieHeader)
      ? otherCookieHeader.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : otherCookieHeader;
    otherAuthCookie = otherSessionCookie ? otherSessionCookie.split(';')[0] : '';
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authorization and Access Control', () => {
    it('rejects unauthenticated presign batch request with 401', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/presign-batch`)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              filename: 'test.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 1024 * 1024,
            },
          ],
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('rejects upload presigning for an event owned by another photographer with 404', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/presign-batch`)
        .set('Cookie', otherAuthCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              filename: 'test.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 1024 * 1024,
            },
          ],
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('rejects upload presigning targeting a folder from another event with 400 INVALID_TARGET_FOLDER', async () => {
      // EVENT_A_ID trying to upload to FOLDER_B_ID (which belongs to EVENT_B_ID)
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          folderId: FOLDER_B_ID,
          items: [
            {
              filename: 'test.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 1024 * 1024,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_TARGET_FOLDER');
    });
  });

  describe('Presign Batch Endpoint (POST /api/events/:eventId/media/presign-batch)', () => {
    it('successfully generates presigned PUT descriptors for valid photo files', async () => {
      // Mock generatePresignedPutUrl on storageAdapter
      vi.spyOn(storageAdapter, 'generatePresignedPutUrl').mockResolvedValue({
        url: 'https://test-r2.cloudflarestorage.com/events/test?signature=abc',
        key: 'events/test',
        expiresInSeconds: 1800,
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
      });

      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              filename: 'wedding_01.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 8 * 1024 * 1024,
            },
            {
              filename: 'ring_detail.png',
              mimeType: 'image/png',
              sizeBytes: 4 * 1024 * 1024,
              folderId: FOLDER_A_ID,
            },
            {
              filename: 'portrait.webp',
              mimeType: 'image/webp',
              sizeBytes: 6 * 1024 * 1024,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(3);

      const [item1, item2, item3] = res.body.data.items;
      expect(item1.originalName).toBe('wedding_01.jpg');
      expect(item1.filename).toMatch(/^[0-9a-f-]+\.jpg$/);
      expect(item1.storageKey).toMatch(new RegExp(`^events/${EVENT_A_ID}/originals/`));
      expect(item1.uploadUrl).toBeDefined();

      expect(item2.folderId).toBe(FOLDER_A_ID);
      expect(item2.filename).toMatch(/^[0-9a-f-]+\.png$/);

      expect(item3.filename).toMatch(/^[0-9a-f-]+\.webp$/);
    });

    it('rejects vector SVG files with descriptive message', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              filename: 'graphic.svg',
              mimeType: 'image/svg+xml',
              sizeBytes: 2048,
            },
          ],
        });

      expect(res.status).toBe(415);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(res.body.error.message).toContain('Vector SVG files are not supported');
    });

    it('rejects HEIC/HEIF files with clear guidance', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              filename: 'iphone.heic',
              mimeType: 'image/heic',
              sizeBytes: 5 * 1024 * 1024,
            },
          ],
        });

      expect(res.status).toBe(415);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(res.body.error.message).toContain('HEIC/HEIF is not currently supported');
    });

    it('rejects files larger than 100 MB with 413 FILE_TOO_LARGE', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              filename: 'huge_raw.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 105 * 1024 * 1024, // 105 MB
            },
          ],
        });

      expect(res.status).toBe(413);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('rejects empty batch with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Confirm Upload Endpoint (POST /api/events/:eventId/media/confirm-upload)', () => {
    it('verifies R2 existence and creates media record in database', async () => {
      const mediaId = '00000000-0000-0000-0000-000000000010';
      const storageKey = `events/${EVENT_A_ID}/originals/${mediaId}.jpg`;

      // Mock headObject on storageAdapter to return verified object
      vi.spyOn(storageAdapter, 'headObject').mockResolvedValue({
        key: storageKey,
        sizeBytes: 15728640, // 15 MB
        contentType: 'image/jpeg',
        lastModified: new Date(),
      });

      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/confirm-upload`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              mediaId,
              storageKey,
              originalName: 'master_portrait.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 15728640,
              folderId: FOLDER_A_ID,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.confirmed).toHaveLength(1);
      expect(res.body.data.failed).toHaveLength(0);

      const confirmedItem = res.body.data.confirmed[0];
      expect(confirmedItem.id).toBe(mediaId);
      expect(confirmedItem.eventId).toBe(EVENT_A_ID);
      expect(confirmedItem.folderId).toBe(FOLDER_A_ID);
      expect(confirmedItem.status).toBe('uploaded');
      expect(confirmedItem.fileSize).toBe(15728640);
      expect(confirmedItem.storageKeyOriginal).toBe(storageKey);
    });

    it('rejects confirmation when storage object is missing in R2 without creating record', async () => {
      const missingMediaId = '00000000-0000-0000-0000-000000000020';
      const missingStorageKey = `events/${EVENT_A_ID}/originals/${missingMediaId}.jpg`;

      // Mock headObject to return null (not found in R2)
      vi.spyOn(storageAdapter, 'headObject').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/confirm-upload`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              mediaId: missingMediaId,
              storageKey: missingStorageKey,
              originalName: 'phantom_photo.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 5000000,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.confirmed).toHaveLength(0);
      expect(res.body.data.failed).toHaveLength(1);
      expect(res.body.data.failed[0].mediaId).toBe(missingMediaId);
      expect(res.body.data.failed[0].error).toContain('does not exist in R2 bucket');

      // Verify no row was inserted into media table
      const dbCheck = db.public.many(
        `SELECT id FROM media WHERE id = '${missingMediaId}';`
      );
      expect(dbCheck).toHaveLength(0);
    });

    it('is strictly idempotent on repeated confirmation calls', async () => {
      const mediaId = '00000000-0000-0000-0000-000000000030';
      const storageKey = `events/${EVENT_A_ID}/originals/${mediaId}.png`;

      vi.spyOn(storageAdapter, 'headObject').mockResolvedValue({
        key: storageKey,
        sizeBytes: 8388608,
        contentType: 'image/png',
      });

      // Call 1
      const res1 = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/confirm-upload`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              mediaId,
              storageKey,
              originalName: 'reception_stage.png',
              mimeType: 'image/png',
              sizeBytes: 8388608,
            },
          ],
        });

      expect(res1.status).toBe(200);
      expect(res1.body.data.confirmed).toHaveLength(1);

      // Call 2 (identical retry)
      const res2 = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/confirm-upload`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              mediaId,
              storageKey,
              originalName: 'reception_stage.png',
              mimeType: 'image/png',
              sizeBytes: 8388608,
            },
          ],
        });

      expect(res2.status).toBe(200);
      expect(res2.body.data.confirmed).toHaveLength(1);
      expect(res2.body.data.confirmed[0].id).toBe(mediaId);

      // Check database has exactly 1 row, not 2
      const rows = db.public.many(
        `SELECT id FROM media WHERE id = '${mediaId}';`
      );
      expect(rows).toHaveLength(1);
    });

    it('rejects confirmation with malformed or mismatched storage key', async () => {
      const mediaId = '00000000-0000-0000-0000-000000000040';
      // Storage key pointing to another event
      const mismatchedKey = `events/${EVENT_B_ID}/originals/${mediaId}.jpg`;

      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/confirm-upload`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              mediaId,
              storageKey: mismatchedKey,
              originalName: 'spoofed_key.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 1000000,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.confirmed).toHaveLength(0);
      expect(res.body.data.failed).toHaveLength(1);
      expect(res.body.data.failed[0].error).toContain('does not match expected originals pattern');
    });
  });

  describe('Media Query Endpoint (GET /api/events/:eventId/media)', () => {
    it('lists uploaded media items with folder metadata and pagination', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_A_ID}/media`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.media)).toBe(true);
      expect(res.body.meta.total).toBeGreaterThan(0);

      const items = res.body.data.media;
      const ceremonyItem = items.find((i: any) => i.folderId === FOLDER_A_ID);
      expect(ceremonyItem).toBeDefined();
      expect(ceremonyItem.folderName).toBe('Ceremony');
    });

    it('filters media by folderId', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_A_ID}/media?folderId=${FOLDER_A_ID}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      res.body.data.media.forEach((item: any) => {
        expect(item.folderId).toBe(FOLDER_A_ID);
      });
    });

    it('filters media by root (uncategorized)', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_A_ID}/media?folderId=root`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      res.body.data.media.forEach((item: any) => {
        expect(item.folderId).toBeNull();
      });
    });
  });

  describe('Storage Accounting Integration (Phase 9 & 10 Cohesion)', () => {
    it('includes verified uploaded originals in application-tracked storage summary', async () => {
      const summary = await getStorageUsageSummary(1);
      expect(summary.totalBytes).toBeGreaterThan(0);
      expect(summary.breakdown.originalPhotosBytes).toBeGreaterThan(0);
      expect(summary.mediaCounts.photos).toBeGreaterThan(0);
    });

    it('excludes failed media records from storage calculations', async () => {
      // Insert a failed media record directly into the DB
      const failedId = '00000000-0000-0000-0000-000000000099';
      db.public.none(
        `INSERT INTO media (
          id, event_id, type, filename, original_name, mime_type, file_size, storage_key_original, status
        ) VALUES (
          '${failedId}', '${EVENT_A_ID}', 'photo', '${failedId}.jpg', 'failed.jpg', 'image/jpeg', 999999999, 'events/${EVENT_A_ID}/originals/${failedId}.jpg', 'failed'
        );`
      );

      const summary = await getStorageUsageSummary(1);
      // Ensure the 999MB from the failed item was not added
      expect(summary.totalBytes).toBeLessThan(999999999);
    });
  });
});
