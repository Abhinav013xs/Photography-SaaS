import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool, query } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
} from '../helpers/db_test_helper.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import { processPhoto } from '../../apps/api/src/services/imageProcessingService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';

describe('Phase 22: Watermark System Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const OWNER_ID = 1;
  const TEST_PASSWORD = 'WatermarkMaster2026!';
  let authCookie: string;

  const EVENT_1_ID = 'e0000000-0000-0000-0000-000000000001';
  const EVENT_2_ID = 'e0000000-0000-0000-0000-000000000002';
  const MEDIA_1_ID = '10000000-0000-0000-0000-000000000001';
  const MEDIA_2_ID = '10000000-0000-0000-0000-000000000002';

  // Helper to generate a test JPEG in memory
  async function createTestImage(width = 1200, height = 800): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 50, g: 60, b: 70 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  beforeAll(async () => {
    db = createTestDatabase();
    const pgAdapter = db.adapters.createPg();
    pool = new pgAdapter.Pool();
    setDatabasePool(pool);

    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    insertTestPhotographer(db, { id: OWNER_ID, password_hash: passwordHash });

    // Obtain authenticated photographer session cookie
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

    // Seed Event 1: Watermarking enabled, version 1
    insertTestEvent(db, {
      id: EVENT_1_ID,
      owner_id: OWNER_ID,
      slug: 'summer-wedding-2026',
      name: 'Summer Wedding 2026',
      status: 'active',
      visibility: 'public',
      allow_downloads: true,
      watermark_enabled: true,
      watermark_text: 'STUDIO LUMINA',
      watermark_opacity: 0.40,
      watermark_size: 'medium',
      watermark_position: 'bottom-right',
      watermark_color: 'white',
      watermark_version: 1,
    });

    // Seed Event 2: Watermarking disabled, version 1
    insertTestEvent(db, {
      id: EVENT_2_ID,
      owner_id: OWNER_ID,
      slug: 'autumn-portrait-2026',
      name: 'Autumn Portrait 2026',
      status: 'active',
      visibility: 'public',
      allow_downloads: true,
      watermark_enabled: false,
      watermark_text: 'STUDIO LUMINA',
      watermark_opacity: 0.40,
      watermark_size: 'medium',
      watermark_position: 'bottom-right',
      watermark_color: 'white',
      watermark_version: 1,
    });

    // Seed Media 1 in Event 1
    insertTestMedia(db, {
      id: MEDIA_1_ID,
      event_id: EVENT_1_ID,
      filename: 'photo_001.jpg',
      original_name: 'photo_001.jpg',
      status: 'uploaded',
      storage_key_original: `events/${EVENT_1_ID}/originals/photo_001.jpg`,
      watermark_applied: false,
      watermark_version: 0,
    });

    // Seed Media 2 in Event 1
    insertTestMedia(db, {
      id: MEDIA_2_ID,
      event_id: EVENT_1_ID,
      filename: 'photo_002.jpg',
      original_name: 'photo_002.jpg',
      status: 'uploaded',
      storage_key_original: `events/${EVENT_1_ID}/originals/photo_002.jpg`,
      watermark_applied: false,
      watermark_version: 0,
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(storageAdapter, 'generatePresignedGetUrl').mockImplementation(async (opts) => ({
      url: `https://mock-r2.studiolumina.photo/${opts.key}?expires=900&signature=valid-sig`,
      expiresInSeconds: opts.expiresInSeconds,
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000).toISOString(),
    }));
  });

  describe('1. Watermark Settings Configuration & Versioning', () => {
    it('retrieves event watermark configuration via GET /api/events/:id', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_1_ID}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.event.watermark_enabled).toBe(true);
      expect(res.body.data.event.watermark_text).toBe('STUDIO LUMINA');
      expect(res.body.data.event.watermark_opacity).toBe(0.40);
      expect(res.body.data.event.watermark_size).toBe('medium');
      expect(res.body.data.event.watermark_position).toBe('bottom-right');
      expect(res.body.data.event.watermark_color).toBe('white');
      expect(res.body.data.event.watermark_version).toBe(1);
    });

    it('updating watermark configuration bumps watermark_version from 1 to 2', async () => {
      const res = await request(app)
        .put(`/api/events/${EVENT_1_ID}`)
        .set('Cookie', authCookie)
        .send({
          name: 'Summer Wedding 2026',
          client_name: 'Client Name',
          event_date: '2026-10-10',
          watermark_enabled: true,
          watermark_text: 'STUDIO LUMINA EDITORIAL',
          watermark_opacity: 0.55,
          watermark_size: 'large',
          watermark_position: 'bottom-center',
          watermark_color: 'black',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.event.watermark_version).toBe(2);
      expect(res.body.data.event.watermark_text).toBe('STUDIO LUMINA EDITORIAL');
      expect(res.body.data.event.watermark_opacity).toBe(0.55);
      expect(res.body.data.event.watermark_size).toBe('large');
      expect(res.body.data.event.watermark_position).toBe('bottom-center');
      expect(res.body.data.event.watermark_color).toBe('black');
    });

    it('updating unrelated fields does not bump watermark_version', async () => {
      const res = await request(app)
        .put(`/api/events/${EVENT_1_ID}`)
        .set('Cookie', authCookie)
        .send({
          name: 'Summer Wedding 2026 Renamed',
          client_name: 'Client Name',
          event_date: '2026-10-10',
          description: 'New description',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.event.watermark_version).toBe(2); // Still 2
      expect(res.body.data.event.name).toBe('Summer Wedding 2026 Renamed');
    });

    it('rejects unauthorized configuration update without session cookie', async () => {
      const res = await request(app)
        .put(`/api/events/${EVENT_1_ID}`)
        .send({ watermark_enabled: false });

      expect(res.status).toBe(401);
    });
  });

  describe('2. Reprocessing Status & Manual Trigger Endpoints', () => {
    it('returns watermark status via GET /api/events/:id/watermark/status', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_1_ID}/watermark/status`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.eventId).toBe(EVENT_1_ID);
      expect(res.body.data.watermarkVersion).toBe(2);
      expect(res.body.data.totalPhotos).toBe(2);
      expect(res.body.data.pendingPhotos).toBe(2); // Not yet processed to v2
      expect(res.body.data.syncedPhotos).toBe(0);
    });

    it('triggers reprocessing via POST /api/events/:id/watermark/reprocess', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_1_ID}/watermark/reprocess`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.version).toBe(2);
      expect(res.body.data.enqueuedCount).toBe(2);
    });
  });

  describe('3. Image Processing Pipeline with Watermark & Clean Originals', () => {
    let mockOriginalBuffer: Buffer;

    beforeAll(async () => {
      mockOriginalBuffer = await createTestImage(1600, 1000);
    });

    beforeEach(() => {
      // Mock storageAdapter getObject and putObject
      vi.spyOn(storageAdapter, 'getObject').mockImplementation(async (key: string) => {
        return mockOriginalBuffer;
      });

      vi.spyOn(storageAdapter, 'putObject').mockImplementation(async (key: string, buffer: any) => {
        return {
          key,
          sizeBytes: buffer.length,
        };
      });
    });

    it('processes photo, creates watermarked derivatives, and updates media watermark_version', async () => {
      const result = await processPhoto(MEDIA_1_ID, EVENT_1_ID, {
        targetWatermarkVersion: 2,
      });

      expect(result.status).toBe('ready');
      expect(result.thumbnailKey).toBeDefined();
      expect(result.previewKey).toBeDefined();

      // Verify database updated with watermark_applied = true and watermark_version = 2
      const mediaRow = await query<any>(
        'SELECT watermark_applied, watermark_version, status, storage_key_original FROM media WHERE id = $1',
        [MEDIA_1_ID]
      );

      expect(mediaRow.rows[0].status).toBe('ready');
      expect(mediaRow.rows[0].watermark_applied).toBe(true);
      expect(mediaRow.rows[0].watermark_version).toBe(2);
      // Clean original storage key must be preserved
      expect(mediaRow.rows[0].storage_key_original).toBe(`events/${EVENT_1_ID}/originals/photo_001.jpg`);
    });

    it('idempotently skips reprocessing if media is already at the target watermark version', async () => {
      const result = await processPhoto(MEDIA_1_ID, EVENT_1_ID, {
        targetWatermarkVersion: 2,
      });

      expect(result.status).toBe('ready');
    });

    it('concurrency guard: rejects stale job where expected watermark version is older than event version', async () => {
      const staleResult = await processPhoto(MEDIA_2_ID, EVENT_1_ID, {
        expectedWatermarkVersion: 1, // Event is now at version 2
        targetWatermarkVersion: 1,
      });

      // Stale job should be safely marked as skipped
      expect(staleResult.skipped).toBe(true);

      // Media 2 should not be set to version 1
      const mediaRow = await query<any>(
        'SELECT watermark_version FROM media WHERE id = $1',
        [MEDIA_2_ID]
      );
      expect(mediaRow.rows[0].watermark_version).not.toBe(1);
    });
  });

  describe('4. Guest Gallery Access & Download Security Integration', () => {
    it('guest gallery returns derivative preview and thumbnail keys, never exposing originals', async () => {
      // First process Media 2 to ready
      await processPhoto(MEDIA_2_ID, EVENT_1_ID, { targetWatermarkVersion: 2 });

      const res = await request(app).get('/api/guest/gallery/summer-wedding-2026');

      expect(res.status).toBe(200);
      expect(res.body.data.media.length).toBeGreaterThanOrEqual(1);

      const photo = res.body.data.media[0];
      // Guest media list must provide preview and thumbnail keys
      expect(photo.storage_key_preview).toBeDefined();
      expect(photo.storage_key_thumbnail).toBeDefined();
      // Must NOT contain storage_key_original
      expect(photo.storage_key_original).toBeUndefined();
    });

    it('authorized original download via Phase 21 preserves clean unwatermarked original', async () => {
      // Download original photo
      const res = await request(app)
        .get(`/api/guest/gallery/summer-wedding-2026/download/${MEDIA_1_ID}?type=original`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.mediaId).toBe(MEDIA_1_ID);
      expect(res.body.data.filename).toBe('photo_001.jpg');
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.downloadUrl).toContain(`events/${EVENT_1_ID}/originals/photo_001.jpg`);
    });

    it('enforces event isolation: Event 1 guest cannot download media belonging to Event 2', async () => {
      // Seed a photo in Event 2
      const MEDIA_E2 = '20000000-0000-0000-0000-000000000099';
      insertTestMedia(db, {
        id: MEDIA_E2,
        event_id: EVENT_2_ID,
        filename: 'e2_photo.jpg',
        status: 'ready',
      });

      const res = await request(app)
        .get(`/api/guest/gallery/summer-wedding-2026/download/${MEDIA_E2}?type=original`);

      expect(res.status).toBe(404);
    });
  });
});
