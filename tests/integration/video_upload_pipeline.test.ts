import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
} from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import { videoPipeline } from '../../apps/api/src/services/videoProcessingService.js';

describe('Phase 12: Video Upload & Processing Pipeline Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'VideoPipelinePassword2026!';
  let authCookie: string;

  const OWNER_ID = 1;
  const EVENT_ID = 'e0000000-0000-0000-0000-000000000001';
  const FOLDER_ID = 'f0000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    db = createTestDatabase();

    // Sole owner photographer
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name)
       VALUES (${OWNER_ID}, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina');`
    );

    // Event & Folder
    insertTestEvent(db, {
      id: EVENT_ID,
      owner_id: OWNER_ID,
      slug: 'wedding-cinema-2026',
      name: 'Cinema Wedding',
    });

    insertTestFolder(db, {
      id: FOLDER_ID,
      event_id: EVENT_ID,
      name: 'Video Highlights',
      sort_order: 0,
    });

    const pgAdapter = db.adapters.createPg();
    pool = new pgAdapter.Pool();
    setDatabasePool(pool);

    // Authenticate photographer
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
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Video Presigning (POST /api/events/:eventId/media/presign-batch)', () => {
    it('authorizes and generates presigned PUT URLs for supported video formats', async () => {
      vi.spyOn(storageAdapter, 'generatePresignedPutUrl').mockResolvedValue({
        url: 'https://r2.test/upload/video.mp4?signed=true',
        key: `events/${EVENT_ID}/originals/mock-uuid.mp4`,
        expiresInSeconds: 1800,
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
      });

      const res = await request(app)
        .post(`/api/events/${EVENT_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          folderId: FOLDER_ID,
          items: [
            {
              filename: 'wedding_highlights.mp4',
              mimeType: 'video/mp4',
              sizeBytes: 250 * 1024 * 1024,
            },
            {
              filename: 'ceremony_drone.mov',
              mimeType: 'video/quicktime',
              sizeBytes: 400 * 1024 * 1024,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.items[0].uploadUrl).toContain('https://r2.test/upload/video.mp4');
      expect(res.body.data.items[0].folderId).toBe(FOLDER_ID);
    });

    it('rejects unauthenticated video upload requests with 401', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_ID}/media/presign-batch`)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [{ filename: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 1000 }],
        });

      expect(res.status).toBe(401);
    });

    it('rejects video exceeding maximum allowed size of 500 MB', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              filename: 'huge_raw.mp4',
              mimeType: 'video/mp4',
              sizeBytes: 600 * 1024 * 1024, // 600 MB
            },
          ],
        });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });
  });

  describe('2. Video Confirmation (POST /api/events/:eventId/media/confirm-upload)', () => {
    it('confirms uploaded video after R2 headObject verification and marks status uploaded', async () => {
      const videoMediaId = '10000000-0000-0000-0000-000000000099';
      const storageKey = `events/${EVENT_ID}/originals/${videoMediaId}.mp4`;

      vi.spyOn(storageAdapter, 'headObject').mockResolvedValue({
        key: storageKey,
        sizeBytes: 50 * 1024 * 1024,
        contentType: 'video/mp4',
      });

      const res = await request(app)
        .post(`/api/events/${EVENT_ID}/media/confirm-upload`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              mediaId: videoMediaId,
              storageKey,
              originalName: 'reception_speech.mp4',
              mimeType: 'video/mp4',
              sizeBytes: 50 * 1024 * 1024,
              folderId: FOLDER_ID,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.confirmed).toHaveLength(1);
      expect(res.body.data.confirmed[0].type).toBe('video');
      expect(res.body.data.confirmed[0].status).toBe('uploaded');

      // Verify row in database
      const rows = db.public.many(
        `SELECT type, status, file_size FROM media WHERE id = '${videoMediaId}'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('video');
      expect(rows[0].status).toBe('uploaded');
    });

    it('is idempotent: returns confirmed record without creating duplicate entries', async () => {
      const videoMediaId = '10000000-0000-0000-0000-000000000088';
      const storageKey = `events/${EVENT_ID}/originals/${videoMediaId}.mov`;

      insertTestMedia(db, {
        id: videoMediaId,
        event_id: EVENT_ID,
        type: 'video',
        filename: `${videoMediaId}.mov`,
        file_size: 30 * 1024 * 1024,
        storage_key_original: storageKey,
        status: 'uploaded',
      });

      const res = await request(app)
        .post(`/api/events/${EVENT_ID}/media/confirm-upload`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          items: [
            {
              mediaId: videoMediaId,
              storageKey,
              originalName: 'toast.mov',
              mimeType: 'video/quicktime',
              sizeBytes: 30 * 1024 * 1024,
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.confirmed).toHaveLength(1);
      expect(res.body.data.confirmed[0].id).toBe(videoMediaId);

      const count = db.public.many(`SELECT COUNT(*) as c FROM media WHERE id = '${videoMediaId}'`);
      expect(Number(count[0].c)).toBe(1);
    });
  });

  describe('3. Video Processing Execution (processVideo & POST /:mediaId/process)', () => {
    it('executes video probing, extracts poster, generates rendition, and marks video ready', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000077';
      const storageKey = `events/${EVENT_ID}/originals/${mediaId}.mp4`;

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'video',
        filename: `${mediaId}.mp4`,
        file_size: 40 * 1024 * 1024,
        storage_key_original: storageKey,
        status: 'uploaded',
      });

      // Mock storage
      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(Buffer.from('fake_video_stream'));
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue({
        key: 'events/mock',
        sizeBytes: 1000,
      });

      // Mock probe, poster, and rendition
      vi.spyOn(videoPipeline, 'probeVideo').mockResolvedValue({
        duration: 12.5,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        bitrate: 4000000,
        frameRate: 30,
        formatName: 'mov,mp4',
      });

      vi.spyOn(videoPipeline, 'extractPosterFrame').mockResolvedValue({
        posterBuffer: Buffer.from('fake_poster_webp'),
        width: 1920,
        height: 1080,
      });

      vi.spyOn(videoPipeline, 'generatePlaybackRendition').mockImplementation(
        async (_inPath, outPath) => {
          const fs = await import('fs');
          await fs.promises.writeFile(outPath, Buffer.from('mock_rendition_mp4'));
          return { sizeBytes: 15 * 1024 * 1024 };
        }
      );

      const res = await request(app)
        .post(`/api/events/${EVENT_ID}/media/${mediaId}/process`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ready');
      expect(res.body.data.duration).toBe(12.5);
      expect(res.body.data.videoCodec).toBe('h264');
      expect(res.body.data.audioCodec).toBe('aac');

      // Verify PostgreSQL row
      const dbRow = db.public.many(
        `SELECT status, video_duration, video_codec, audio_codec, thumbnail_size, preview_size
         FROM media WHERE id = '${mediaId}'`
      )[0];

      expect(dbRow.status).toBe('ready');
      expect(dbRow.video_duration).toBe(12.5);
      expect(dbRow.video_codec).toBe('h264');
      expect(dbRow.audio_codec).toBe('aac');
      expect(Number(dbRow.thumbnail_size)).toBeGreaterThan(0);
      expect(Number(dbRow.preview_size)).toBe(15 * 1024 * 1024);
    });

    it('records failure safely with status failed without corrupting the original video', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000066';
      const storageKey = `events/${EVENT_ID}/originals/${mediaId}.mp4`;

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'video',
        filename: `${mediaId}.mp4`,
        file_size: 100000,
        storage_key_original: storageKey,
        status: 'uploaded',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(Buffer.from('corrupt_binary_data'));
      vi.spyOn(videoPipeline, 'probeVideo').mockRejectedValue(
        new Error('Failed to probe video file with ffprobe: Invalid data found')
      );

      const res = await request(app)
        .post(`/api/events/${EVENT_ID}/media/${mediaId}/process`)
        .set('Cookie', authCookie)
        .set('Origin', 'http://localhost:3000')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('failed');

      // Verify DB record has status failed and error recorded
      const row = db.public.many(
        `SELECT status, processing_error FROM media WHERE id = '${mediaId}'`
      )[0];
      expect(row.status).toBe('failed');
      expect(row.processing_error).toContain('Failed to probe video file');
    });
  });
});
