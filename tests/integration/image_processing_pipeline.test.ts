import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestMedia,
} from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import {
  processPhoto,
  imageProcessingQueue,
} from '../../apps/api/src/services/imageProcessingService.js';
import { getStorageUsageSummary } from '../../apps/api/src/services/storageService.js';
import { MediaNotFoundError } from '@photography-saas/errors';

describe('Phase 11: Image Processing Pipeline Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'PipelinePassword2026!';
  let authCookie: string;

  const EVENT_A_ID = 'e0000000-0000-0000-0000-000000000001';
  const EVENT_B_ID = 'e0000000-0000-0000-0000-000000000002';
  const FOREIGN_EVENT_ID = 'e0000000-0000-0000-0000-000000000099';

  // Helper to generate a valid test JPEG in memory
  async function createSampleJpeg(width = 2000, height = 1500): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 197, g: 160, b: 89 }, // Champagne bronze
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    db = createTestDatabase();

    // Photographer 1 (Sole Owner ID = 1)
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina');`
    );

    // Photographer 2 (Other Owner ID = 2 for IDOR tests)
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name)
       VALUES (2, 'other@photographer.com', '${passwordHash}', 'Other Studio');`
    );

    // Event A (Owner 1)
    insertTestEvent(db, {
      id: EVENT_A_ID,
      owner_id: 1,
      slug: 'wedding-a-2026',
      name: 'Event A — Grand Wedding',
    });

    // Event B (Owner 1)
    insertTestEvent(db, {
      id: EVENT_B_ID,
      owner_id: 1,
      slug: 'event-b-2026',
      name: 'Event B — Sunset Gala',
    });

    // Foreign Event (Owner 2)
    insertTestEvent(db, {
      id: FOREIGN_EVENT_ID,
      owner_id: 2,
      slug: 'foreign-event-2026',
      name: 'Foreign Wedding',
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
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    imageProcessingQueue.clear();
  });

  describe('1. Core Processing Workflow (processPhoto)', () => {
    it('downloads original, generates derivatives, uploads to R2, and marks ready', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000001';
      const storageKeyOriginal = `events/${EVENT_A_ID}/originals/${mediaId}.jpg`;
      const originalBytes = await createSampleJpeg(2000, 1500);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_A_ID,
        filename: `${mediaId}.jpg`,
        file_size: originalBytes.length,
        storage_key_original: storageKeyOriginal,
        status: 'uploaded',
      });

      // Mock storageAdapter getObject and putObject
      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(originalBytes);
      const putObjectSpy = vi.spyOn(storageAdapter, 'putObject').mockImplementation(async (key, body) => ({
        key,
        sizeBytes: Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body as string),
      }));

      const result = await processPhoto(mediaId, EVENT_A_ID);

      expect(result.status).toBe('ready');
      expect(result.mediaId).toBe(mediaId);
      expect(result.width).toBe(2000);
      expect(result.height).toBe(1500);
      expect(result.thumbnailKey).toBe(`events/${EVENT_A_ID}/thumbnails/${mediaId}.webp`);
      expect(result.previewKey).toBe(`events/${EVENT_A_ID}/previews/${mediaId}.webp`);
      expect(result.thumbnailSize).toBeGreaterThan(0);
      expect(result.previewSize).toBeGreaterThan(0);

      // Verify two derivatives were stored in R2 (thumbnail and preview)
      expect(putObjectSpy).toHaveBeenCalledTimes(2);
      expect(putObjectSpy).toHaveBeenCalledWith(
        `events/${EVENT_A_ID}/thumbnails/${mediaId}.webp`,
        expect.any(Buffer),
        'image/webp',
        expect.anything()
      );
      expect(putObjectSpy).toHaveBeenCalledWith(
        `events/${EVENT_A_ID}/previews/${mediaId}.webp`,
        expect.any(Buffer),
        'image/webp',
        expect.anything()
      );

      // Verify database record was updated
      const row = db.public.one(`SELECT * FROM media WHERE id = '${mediaId}'`);
      expect(row.status).toBe('ready');
      expect(row.storage_key_thumbnail).toBe(`events/${EVENT_A_ID}/thumbnails/${mediaId}.webp`);
      expect(row.storage_key_preview).toBe(`events/${EVENT_A_ID}/previews/${mediaId}.webp`);
      expect(Number(row.thumbnail_size)).toBe(result.thumbnailSize);
      expect(Number(row.preview_size)).toBe(result.previewSize);
      expect(row.width).toBe(2000);
      expect(row.height).toBe(1500);
      expect(row.processed_at).not.toBeNull();
      expect(row.processing_error).toBeNull();
    });

    it('is strictly idempotent when called on already ready photo', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000002';
      const originalBytes = await createSampleJpeg(1000, 800);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_A_ID,
        filename: `${mediaId}.jpg`,
        file_size: originalBytes.length,
        storage_key_original: `events/${EVENT_A_ID}/originals/${mediaId}.jpg`,
        storage_key_thumbnail: `events/${EVENT_A_ID}/thumbnails/${mediaId}.webp`,
        storage_key_preview: `events/${EVENT_A_ID}/previews/${mediaId}.webp`,
        thumbnail_size: 15000,
        preview_size: 85000,
        width: 1000,
        height: 800,
        status: 'ready',
      });

      const getObjectSpy = vi.spyOn(storageAdapter, 'getObject');
      const putObjectSpy = vi.spyOn(storageAdapter, 'putObject');

      const result = await processPhoto(mediaId, EVENT_A_ID);

      expect(result.status).toBe('ready');
      expect(result.thumbnailSize).toBe(15000);
      expect(result.previewSize).toBe(85000);

      // No redundant R2 downloads or uploads performed
      expect(getObjectSpy).not.toHaveBeenCalled();
      expect(putObjectSpy).not.toHaveBeenCalled();
    });

    it('recovers from previous failure when retried with valid original', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000003';
      const originalBytes = await createSampleJpeg(1200, 900);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_A_ID,
        filename: `${mediaId}.jpg`,
        file_size: originalBytes.length,
        storage_key_original: `events/${EVENT_A_ID}/originals/${mediaId}.jpg`,
        processing_error: 'Transient storage timeout during previous run',
        status: 'failed',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(originalBytes);
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue({
        key: 'k',
        sizeBytes: 1000,
      });

      const result = await processPhoto(mediaId, EVENT_A_ID);
      expect(result.status).toBe('ready');

      const row = db.public.one(`SELECT * FROM media WHERE id = '${mediaId}'`);
      expect(row.status).toBe('ready');
      expect(row.processing_error).toBeNull();
    });

    it('handles corrupt original binary safely by recording failure without touching original', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000004';
      const corruptBytes = Buffer.from('this is not a valid jpeg image binary');

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_A_ID,
        filename: `${mediaId}.jpg`,
        file_size: corruptBytes.length,
        storage_key_original: `events/${EVENT_A_ID}/originals/${mediaId}.jpg`,
        status: 'uploaded',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(corruptBytes);
      const putObjectSpy = vi.spyOn(storageAdapter, 'putObject');

      const result = await processPhoto(mediaId, EVENT_A_ID);
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();

      // Derivatives should not have been uploaded
      expect(putObjectSpy).not.toHaveBeenCalled();

      // Status marked failed in DB
      const row = db.public.one(`SELECT * FROM media WHERE id = '${mediaId}'`);
      expect(row.status).toBe('failed');
      expect(row.processing_error).toContain('Unsupported or invalid image file signature');
    });

    it('throws MediaNotFoundError for non-existent media ID', async () => {
      await expect(
        processPhoto('00000000-0000-0000-0000-999999999999', EVENT_A_ID)
      ).rejects.toThrow(MediaNotFoundError);
    });
  });

  describe('2. REST API Endpoints (POST /api/events/:eventId/media/:mediaId/process)', () => {
    it('triggers processing for a single media item via POST /:mediaId/process', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000010';
      const originalBytes = await createSampleJpeg(1600, 1200);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_A_ID,
        filename: `${mediaId}.jpg`,
        file_size: originalBytes.length,
        storage_key_original: `events/${EVENT_A_ID}/originals/${mediaId}.jpg`,
        status: 'uploaded',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(originalBytes);
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue({ key: 'k', sizeBytes: 5000 });

      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/${mediaId}/process`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ready');
      expect(res.body.data.thumbnailKey).toContain('thumbnails');
      expect(res.body.data.previewKey).toContain('previews');
    });

    it('processes a batch of media items via POST /process-batch', async () => {
      const media1 = '10000000-0000-0000-0000-000000000021';
      const media2 = '10000000-0000-0000-0000-000000000022';
      const originalBytes = await createSampleJpeg(800, 600);

      insertTestMedia(db, {
        id: media1,
        event_id: EVENT_A_ID,
        filename: `${media1}.jpg`,
        storage_key_original: `events/${EVENT_A_ID}/originals/${media1}.jpg`,
        status: 'uploaded',
      });

      insertTestMedia(db, {
        id: media2,
        event_id: EVENT_A_ID,
        filename: `${media2}.jpg`,
        storage_key_original: `events/${EVENT_A_ID}/originals/${media2}.jpg`,
        status: 'uploaded',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(originalBytes);
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue({ key: 'k', sizeBytes: 2500 });

      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/process-batch`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          mediaIds: [media1, media2],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.processed).toHaveLength(2);
      expect(res.body.data.failed).toHaveLength(0);
    });

    it('enforces event isolation (rejects process request on foreign event)', async () => {
      const foreignMediaId = '10000000-0000-0000-0000-000000000099';

      const res = await request(app)
        .post(`/api/events/${FOREIGN_EVENT_ID}/media/${foreignMediaId}/process`)
        .set('Cookie', authCookie) // Logged in as Owner 1, target event owned by Owner 2
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/10000000-0000-0000-0000-000000000001/process`)
        .set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Storage Management Integration (Phase 9 & Phase 11 Cohesion)', () => {
    it('aggregates recorded derivative sizes into derivedImagesBytes accurately without double counting', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000050';
      const originalFileSize = 8_000_000; // 8 MB original
      const thumbnailSize = 45_000;       // 45 KB thumb
      const previewSize = 350_000;        // 350 KB preview

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_B_ID,
        filename: `${mediaId}.jpg`,
        file_size: originalFileSize,
        storage_key_original: `events/${EVENT_B_ID}/originals/${mediaId}.jpg`,
        storage_key_thumbnail: `events/${EVENT_B_ID}/thumbnails/${mediaId}.webp`,
        storage_key_preview: `events/${EVENT_B_ID}/previews/${mediaId}.webp`,
        thumbnail_size: thumbnailSize,
        preview_size: previewSize,
        status: 'ready',
      });

      const summary = await getStorageUsageSummary(1);
      const eventBSummary = summary.events.find((e) => e.eventId === EVENT_B_ID);

      expect(eventBSummary).toBeDefined();
      expect(eventBSummary!.originalBytes).toBe(originalFileSize);
      expect(eventBSummary!.derivedBytes).toBe(thumbnailSize + previewSize);
      expect(eventBSummary!.totalBytes).toBe(originalFileSize + thumbnailSize + previewSize);

      expect(summary.breakdown.originalPhotosBytes).toBeGreaterThanOrEqual(originalFileSize);
      expect(summary.breakdown.derivedImagesBytes).toBeGreaterThanOrEqual(thumbnailSize + previewSize);
    });
  });

  describe('4. Asynchronous Queue Processing (AsyncImageProcessingQueue)', () => {
    it('enqueues tasks, processes outside request loop, and drains cleanly', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000060';
      const originalBytes = await createSampleJpeg(1000, 750);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_A_ID,
        filename: `${mediaId}.jpg`,
        file_size: originalBytes.length,
        storage_key_original: `events/${EVENT_A_ID}/originals/${mediaId}.jpg`,
        status: 'uploaded',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(originalBytes);
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue({ key: 'k', sizeBytes: 2000 });

      // Enqueue
      imageProcessingQueue.enqueue(mediaId, EVENT_A_ID);

      // Wait for queue to drain
      await imageProcessingQueue.waitForDrained();

      const stats = imageProcessingQueue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.active).toBe(0);

      // Verify DB row transitioned to ready
      const row = db.public.one(`SELECT * FROM media WHERE id = '${mediaId}'`);
      expect(row.status).toBe('ready');
      expect(row.thumbnail_size).toBeGreaterThan(0);
      expect(row.preview_size).toBeGreaterThan(0);
    });

    it('deduplicates multiple concurrent enqueue calls for the same media item', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000070';
      const originalBytes = await createSampleJpeg(800, 600);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_A_ID,
        filename: `${mediaId}.jpg`,
        file_size: originalBytes.length,
        storage_key_original: `events/${EVENT_A_ID}/originals/${mediaId}.jpg`,
        status: 'uploaded',
      });

      const getObjectSpy = vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(originalBytes);
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue({ key: 'k', sizeBytes: 2000 });

      // Enqueue the same media item 5 times rapidly
      imageProcessingQueue.enqueue(mediaId, EVENT_A_ID);
      imageProcessingQueue.enqueue(mediaId, EVENT_A_ID);
      imageProcessingQueue.enqueue(mediaId, EVENT_A_ID);
      imageProcessingQueue.enqueue(mediaId, EVENT_A_ID);
      imageProcessingQueue.enqueue(mediaId, EVENT_A_ID);

      await imageProcessingQueue.waitForDrained();

      // Original should only be retrieved once
      expect(getObjectSpy).toHaveBeenCalledTimes(1);
    });
  });
});
