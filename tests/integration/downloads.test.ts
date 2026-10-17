import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { IMemoryDb } from 'pg-mem';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
  insertTestDownloadJob,
} from '../helpers/db_test_helper.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import * as queueManager from '../../apps/api/src/services/queue/queueManager.js';
import {
  processZipGenerationJob,
  cleanupExpiredDownloadJobs,
} from '../../apps/api/src/services/downloadService.js';
import { createGuestSession, GUEST_COOKIE_NAME_PREFIX } from '../../apps/api/src/services/guestSessionService.js';

describe('Phase 21: Photo & Video Download System Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const EVENT_ENABLED_ID = 'e0000000-0000-0000-0000-000000000001';
  const EVENT_DISABLED_ID = 'e0000000-0000-0000-0000-000000000002';
  const EVENT_PRIVATE_ID = 'e0000000-0000-0000-0000-000000000003';
  const EVENT_EXPIRED_ID = 'e0000000-0000-0000-0000-000000000004';
  const EVENT_PIN_ID = 'e0000000-0000-0000-0000-000000000005';
  const EVENT_OTHER_ID = 'e0000000-0000-0000-0000-000000000006';

  const MEDIA_PHOTO_1 = 'b0000000-0000-0000-0000-000000000001';
  const MEDIA_PHOTO_2 = 'b0000000-0000-0000-0000-000000000002';
  const MEDIA_VIDEO_1 = 'b0000000-0000-0000-0000-000000000003';
  const MEDIA_OTHER_EVENT = 'b0000000-0000-0000-0000-000000000004';

  const PIN_RAW = '654321';
  let pinGuestToken: string;

  beforeAll(async () => {
    db = createTestDatabase();
    const pgAdapter = db.adapters.createPg();
    pool = new pgAdapter.Pool();
    setDatabasePool(pool);

    insertTestPhotographer(db, { id: 1 });

    const pinHash = await bcrypt.hash(PIN_RAW, 10);

    // 1. Event with downloads enabled
    insertTestEvent(db, {
      id: EVENT_ENABLED_ID,
      slug: 'wedding-downloads-enabled',
      name: 'Summer Wedding (Downloads Enabled)',
      status: 'active',
      visibility: 'public',
      public_until: new Date(Date.now() + 86400000).toISOString(),
      allow_downloads: true,
    });

    // 2. Event with downloads disabled
    insertTestEvent(db, {
      id: EVENT_DISABLED_ID,
      slug: 'wedding-downloads-disabled',
      name: 'Autumn Wedding (Downloads Disabled)',
      status: 'active',
      visibility: 'public',
      public_until: new Date(Date.now() + 86400000).toISOString(),
      allow_downloads: false,
    });

    // 3. Private event with downloads enabled
    insertTestEvent(db, {
      id: EVENT_PRIVATE_ID,
      slug: 'wedding-private',
      name: 'Private Wedding',
      status: 'active',
      visibility: 'private',
      allow_downloads: true,
    });

    // 4. Expired event with downloads enabled
    insertTestEvent(db, {
      id: EVENT_EXPIRED_ID,
      slug: 'wedding-expired',
      name: 'Expired Wedding',
      status: 'active',
      visibility: 'public',
      public_until: new Date(Date.now() - 3600000).toISOString(), // expired 1h ago
      allow_downloads: true,
    });

    // 5. PIN protected event
    insertTestEvent(db, {
      id: EVENT_PIN_ID,
      slug: 'wedding-pin-protected',
      name: 'PIN Protected Wedding',
      status: 'active',
      visibility: 'public',
      public_until: new Date(Date.now() + 86400000).toISOString(),
      pin_enabled: true,
      pin_hash: pinHash,
      allow_downloads: true,
    });

    // 6. Other event for event isolation checks
    insertTestEvent(db, {
      id: EVENT_OTHER_ID,
      slug: 'other-wedding',
      name: 'Other Wedding',
      status: 'active',
      visibility: 'public',
      allow_downloads: true,
    });

    // Insert Media Items
    insertTestMedia(db, {
      id: MEDIA_PHOTO_1,
      event_id: EVENT_ENABLED_ID,
      type: 'photo',
      filename: 'ceremony_vows.jpg',
      storage_key_original: `events/${EVENT_ENABLED_ID}/originals/${MEDIA_PHOTO_1}.jpg`,
      storage_key_preview: `events/${EVENT_ENABLED_ID}/previews/${MEDIA_PHOTO_1}.jpg`,
      file_size: 4500000,
      status: 'ready',
    });

    insertTestMedia(db, {
      id: MEDIA_PHOTO_2,
      event_id: EVENT_ENABLED_ID,
      type: 'photo',
      filename: 'first_dance.jpg',
      storage_key_original: `events/${EVENT_ENABLED_ID}/originals/${MEDIA_PHOTO_2}.jpg`,
      storage_key_preview: `events/${EVENT_ENABLED_ID}/previews/${MEDIA_PHOTO_2}.jpg`,
      file_size: 5200000,
      status: 'ready',
    });

    insertTestMedia(db, {
      id: MEDIA_VIDEO_1,
      event_id: EVENT_ENABLED_ID,
      type: 'video',
      filename: 'toast_speech.mp4',
      storage_key_original: `events/${EVENT_ENABLED_ID}/videos/${MEDIA_VIDEO_1}.mp4`,
      storage_key_preview: `events/${EVENT_ENABLED_ID}/previews/${MEDIA_VIDEO_1}.jpg`,
      file_size: 25000000,
      status: 'ready',
    });

    insertTestMedia(db, {
      id: MEDIA_OTHER_EVENT,
      event_id: EVENT_OTHER_ID,
      type: 'photo',
      filename: 'unauthorized_photo.jpg',
      storage_key_original: `events/${EVENT_OTHER_ID}/originals/${MEDIA_OTHER_EVENT}.jpg`,
      file_size: 3000000,
      status: 'ready',
    });

    const session = await createGuestSession(EVENT_PIN_ID);
    pinGuestToken = session.token;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Default Storage Mocks
    vi.spyOn(storageAdapter, 'generatePresignedGetUrl').mockImplementation(async (opts) => ({
      url: `https://mock-r2.studiolumina.photo/${opts.key}?expires=900&signature=valid-sig&disposition=${encodeURIComponent(opts.responseContentDisposition || '')}`,
      expiresInSeconds: opts.expiresInSeconds,
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000).toISOString(),
    }));

    vi.spyOn(storageAdapter, 'getObject').mockImplementation(async (key) => {
      return Buffer.from(`mock-binary-data-for-${key}`);
    });

    vi.spyOn(storageAdapter, 'putObject').mockImplementation(async () => {});
    vi.spyOn(storageAdapter, 'deleteObject').mockImplementation(async () => {});

    vi.spyOn(queueManager, 'enqueueZipJob').mockImplementation(async () => 'mock-job-id');
  });

  describe('1. Individual Photo and Video Downloads', () => {
    it('returns 200 with presigned GET URL and safe Content-Disposition for original photo', async () => {
      const res = await request(app)
        .get(`/api/guest/gallery/wedding-downloads-enabled/download/${MEDIA_PHOTO_1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.mediaId).toBe(MEDIA_PHOTO_1);
      expect(res.body.data.filename).toBe('ceremony_vows.jpg');
      expect(res.body.data.downloadUrl).toContain('ceremony_vows.jpg');
      expect(res.body.data.downloadUrl).toContain('mock-r2.studiolumina.photo');
      expect(res.body.data.expiresInSeconds).toBe(900);
      expect(res.body.data.fileSize).toBe(4500000);
    });

    it('redirects with 302 to presigned R2 URL when redirect=true is requested', async () => {
      const res = await request(app)
        .get(`/api/guest/gallery/wedding-downloads-enabled/download/${MEDIA_PHOTO_1}?redirect=true`)
        .expect(302);

      expect(res.headers.location).toContain('mock-r2.studiolumina.photo');
      expect(res.headers.location).toContain(MEDIA_PHOTO_1);
    });

    it('allows individual video downloads for supported video items', async () => {
      const res = await request(app)
        .get(`/api/guest/gallery/wedding-downloads-enabled/download/${MEDIA_VIDEO_1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.mediaId).toBe(MEDIA_VIDEO_1);
      expect(res.body.data.filename).toBe('toast_speech.mp4');
      expect(res.body.data.downloadUrl).toContain('mock-r2.studiolumina.photo');
      expect(res.body.data.fileSize).toBe(25000000);
    });

    it('supports direct route alias /api/media/download/:mediaId', async () => {
      const res = await request(app)
        .get(`/api/media/download/${MEDIA_PHOTO_1}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.mediaId).toBe(MEDIA_PHOTO_1);
      expect(res.body.data.filename).toBe('ceremony_vows.jpg');
    });
  });

  describe('2. Authoritative Policy: Downloads Disabled Enforcement', () => {
    it('denies individual photo download with 403 when allow_downloads is false', async () => {
      // Insert photo into downloads-disabled event
      const disabledPhotoId = 'b0000000-0000-0000-0000-000000000010';
      insertTestMedia(db, {
        id: disabledPhotoId,
        event_id: EVENT_DISABLED_ID,
        type: 'photo',
        filename: 'disabled_photo.jpg',
        storage_key_original: `events/${EVENT_DISABLED_ID}/originals/${disabledPhotoId}.jpg`,
        status: 'ready',
      });

      const res = await request(app)
        .get(`/api/guest/gallery/wedding-downloads-disabled/download/${disabledPhotoId}`)
        .expect(403);

      expect(res.body.error.message).toContain('Downloads are disabled');
    });

    it('denies bulk ZIP creation with 403 when allow_downloads is false', async () => {
      const res = await request(app)
        .post('/api/guest/gallery/wedding-downloads-disabled/download-zip')
        .send({})
        .expect(403);

      expect(res.body.error.message).toContain('Downloads are disabled');
    });
  });

  describe('3. Authoritative Policy: Visibility, Expiry, and PIN Access', () => {
    it('denies downloads with 403 when gallery is private', async () => {
      const privatePhotoId = 'b0000000-0000-0000-0000-000000000020';
      insertTestMedia(db, {
        id: privatePhotoId,
        event_id: EVENT_PRIVATE_ID,
        type: 'photo',
        filename: 'private_photo.jpg',
        storage_key_original: `events/${EVENT_PRIVATE_ID}/originals/${privatePhotoId}.jpg`,
        status: 'ready',
      });

      const res = await request(app)
        .get(`/api/guest/gallery/wedding-private/download/${privatePhotoId}`)
        .expect(403);

      expect(res.body.error.message).toContain('private');
    });

    it('denies downloads with 410 when gallery public window has expired', async () => {
      const expiredPhotoId = 'b0000000-0000-0000-0000-000000000030';
      insertTestMedia(db, {
        id: expiredPhotoId,
        event_id: EVENT_EXPIRED_ID,
        type: 'photo',
        filename: 'expired_photo.jpg',
        storage_key_original: `events/${EVENT_EXPIRED_ID}/originals/${expiredPhotoId}.jpg`,
        status: 'ready',
      });

      const res = await request(app)
        .get(`/api/guest/gallery/wedding-expired/download/${expiredPhotoId}`)
        .expect(410);

      expect(res.body.error.message).toContain('expired');
    });

    it('requires PIN authorization for PIN-protected galleries', async () => {
      const pinPhotoId = 'b0000000-0000-0000-0000-000000000040';
      insertTestMedia(db, {
        id: pinPhotoId,
        event_id: EVENT_PIN_ID,
        type: 'photo',
        filename: 'pin_photo.jpg',
        storage_key_original: `events/${EVENT_PIN_ID}/originals/${pinPhotoId}.jpg`,
        status: 'ready',
      });

      // Without session -> 401
      await request(app)
        .get(`/api/guest/gallery/wedding-pin-protected/download/${pinPhotoId}`)
        .expect(401);

      // With valid PIN session header -> 200
      const authorizedRes = await request(app)
        .get(`/api/guest/gallery/wedding-pin-protected/download/${pinPhotoId}`)
        .set('x-guest-token', pinGuestToken)
        .expect(200);

      expect(authorizedRes.body.success).toBe(true);
      expect(authorizedRes.body.data.mediaId).toBe(pinPhotoId);
    });
  });

  describe('4. Event Isolation & Media Validation', () => {
    it('rejects downloading media from another event under a foreign slug (Cross-Event Defense)', async () => {
      // Attempt to download MEDIA_OTHER_EVENT (belonging to EVENT_OTHER_ID) through EVENT_ENABLED_ID slug
      const res = await request(app)
        .get(`/api/guest/gallery/wedding-downloads-enabled/download/${MEDIA_OTHER_EVENT}`)
        .expect(404);

      expect(res.body.error.message).toContain('not found');
    });

    it('rejects malformed UUIDs with 400 Validation Error', async () => {
      await request(app)
        .get('/api/guest/gallery/wedding-downloads-enabled/download/not-a-valid-uuid')
        .expect(400);
    });
  });

  describe('5. Bulk ZIP Download Workflow & Background Worker', () => {
    it('creates a bulk download job and enqueues BullMQ task with 202 Accepted', async () => {
      const res = await request(app)
        .post('/api/guest/gallery/wedding-downloads-enabled/download-zip')
        .send({
          mediaIds: [MEDIA_PHOTO_1, MEDIA_PHOTO_2],
        })
        .expect(202);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.requestedCount).toBe(2);
      expect(res.body.data.jobId).toBeDefined();

      const jobId = res.body.data.jobId;

      // Status polling before completion
      const statusRes = await request(app)
        .get(`/api/guest/gallery/wedding-downloads-enabled/download-jobs/${jobId}`)
        .expect(200);

      expect(statusRes.body.data.status).toBe('pending');
      expect(statusRes.body.data.downloadUrl).toBeNull();
    });

    it('rejects bulk download when selection exceeds MAX_BULK_DOWNLOAD_ITEMS (500)', async () => {
      const excessiveIds = Array.from({ length: 501 }, (_, i) => {
        const hex = (i + 100).toString(16).padStart(12, '0');
        return `b0000000-0000-0000-0000-${hex}`;
      });

      const res = await request(app)
        .post('/api/guest/gallery/wedding-downloads-enabled/download-zip')
        .send({ mediaIds: excessiveIds })
        .expect(400);

      expect(JSON.stringify(res.body.error)).toContain('500');
    });

    it('rejects empty selection array with 400 NoMediaSelectedError', async () => {
      const res = await request(app)
        .post('/api/guest/gallery/wedding-downloads-enabled/download-zip')
        .send({ mediaIds: [] })
        .expect(400);

      expect(res.body.error.message).toContain('No media');
    });

    it('executes processZipGenerationJob: streams media, creates ZIP, uploads to R2, updates status', async () => {
      // 1. Create job
      const createRes = await request(app)
        .post('/api/guest/gallery/wedding-downloads-enabled/download-zip')
        .send({
          mediaIds: [MEDIA_PHOTO_1, MEDIA_PHOTO_2],
        })
        .expect(202);

      const jobId = createRes.body.data.jobId;

      // 2. Execute BullMQ worker task directly
      await processZipGenerationJob({
        jobId,
        eventId: EVENT_ENABLED_ID,
        mediaIds: [MEDIA_PHOTO_1, MEDIA_PHOTO_2],
        timestamp: Date.now(),
      });

      // 3. Verify putObject was invoked with deterministic export key
      expect(storageAdapter.putObject).toHaveBeenCalledWith(
        `events/${EVENT_ENABLED_ID}/exports/${jobId}.zip`,
        expect.any(Buffer),
        'application/zip'
      );

      // 4. Poll status: must now be completed with download URL
      const completedRes = await request(app)
        .get(`/api/guest/gallery/wedding-downloads-enabled/download-jobs/${jobId}`)
        .expect(200);

      expect(completedRes.body.data.status).toBe('completed');
      expect(completedRes.body.data.progress).toBe(100);
      expect(completedRes.body.data.processedCount).toBe(2);
      expect(completedRes.body.data.downloadUrl).toContain('mock-r2.studiolumina.photo');

      // 5. Test archive redirect endpoint
      const archiveRes = await request(app)
        .get(`/api/guest/gallery/wedding-downloads-enabled/download-jobs/${jobId}/download`)
        .expect(302);

      expect(archiveRes.headers.location).toContain('mock-r2.studiolumina.photo');
    });
  });

  describe('6. Temporary Archive Expiration & Retention Sweeper', () => {
    it('refuses access to expired archives past retention window', async () => {
      const expiredJobId = 'd0000000-0000-0000-0000-000000000099';
      insertTestDownloadJob(db, {
        id: expiredJobId,
        event_id: EVENT_ENABLED_ID,
        status: 'completed',
        storage_key: `events/${EVENT_ENABLED_ID}/exports/${expiredJobId}.zip`,
        expires_at: new Date(Date.now() - 3600000), // Expired 1 hour ago
      });

      const res = await request(app)
        .get(`/api/guest/gallery/wedding-downloads-enabled/download-jobs/${expiredJobId}`)
        .expect(404);

      expect(res.body.error.message).toContain('expired');
    });

    it('cleanupExpiredDownloadJobs purges expired R2 archives without touching original media', async () => {
      const sweeperJobId = 'd0000000-0000-0000-0000-000000000088';
      insertTestDownloadJob(db, {
        id: sweeperJobId,
        event_id: EVENT_ENABLED_ID,
        status: 'completed',
        storage_key: `events/${EVENT_ENABLED_ID}/exports/${sweeperJobId}.zip`,
        expires_at: new Date(Date.now() - 7200000), // Expired 2 hours ago
      });

      const cleanedResult = await cleanupExpiredDownloadJobs();
      expect(cleanedResult.deleted).toBeGreaterThanOrEqual(1);

      // Verify R2 deletion was called for the export zip
      expect(storageAdapter.deleteObject).toHaveBeenCalledWith(
        `events/${EVENT_ENABLED_ID}/exports/${sweeperJobId}.zip`
      );

      // Verify original media items in DB still exist completely intact!
      const photo1Check = db.public.query(
        `SELECT id, status FROM media WHERE id = '${MEDIA_PHOTO_1}'`
      );
      expect(photo1Check.rows.length).toBe(1);
      expect(photo1Check.rows[0].status).toBe('ready');

      const photo2Check = db.public.query(
        `SELECT id, status FROM media WHERE id = '${MEDIA_PHOTO_2}'`
      );
      expect(photo2Check.rows.length).toBe(1);
      expect(photo2Check.rows[0].status).toBe('ready');
    });
  });
});
