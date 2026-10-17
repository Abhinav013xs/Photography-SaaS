import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import fs from 'fs';

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class MockUnrecoverableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnrecoverableError';
    }
  }
  const UnrecoverableError =
    actual?.UnrecoverableError ||
    (actual as any)?.default?.UnrecoverableError ||
    MockUnrecoverableError;

  return {
    ...actual,
    UnrecoverableError,
    Queue: class MockQueue {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
      on() {
        return this;
      }
      async add(name: string, data: any, opts: any) {
        return { id: opts?.jobId || 'mock-job-id', name, data, opts };
      }
      async getJobCounts() {
        return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };
      }
      async close() {
        return Promise.resolve();
      }
    },
    Worker: class MockWorker {
      name: string;
      concurrency: number;
      constructor(name: string, _processor: any, opts: any) {
        this.name = name;
        this.concurrency = opts?.concurrency || 1;
      }
      on() {
        return this;
      }
      async close() {
        return Promise.resolve();
      }
    },
  };
});

import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestMedia,
  insertTestProcessingJob,
} from '../helpers/db_test_helper.js';
import {
  photoJobProcessor,
  videoJobProcessor,
  startWorkers,
  stopWorkers,
  getWorkersStatus,
} from '../../apps/api/src/services/queue/workerManager.js';
import {
  retryFailedJob,
  dispatchPendingOutboxJobs,
  getAllQueueMetrics,
  getBackgroundInfrastructureHealth,
} from '../../apps/api/src/services/queue/jobRecoveryService.js';
import { closeQueues } from '../../apps/api/src/services/queue/queueManager.js';
import { videoPipeline } from '../../apps/api/src/services/videoProcessingService.js';
import { UnrecoverableError, type Job } from 'bullmq';
import type { IMemoryDb } from 'pg-mem';

describe('Phase 13: Background Job & Worker Infrastructure Integration Tests', () => {
  const app = createApp();
  let db: IMemoryDb;
  let pool: any;

  const EVENT_ID = 'e0000000-0000-0000-0000-000000000001';

  async function createSampleJpeg(width = 1000, height = 750): Promise<Buffer> {
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
    db = createTestDatabase();

    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name)
       VALUES (1, 'photographer@studiolumina.photo', 'hash', 'Studio Lumina');`
    );

    insertTestEvent(db, {
      id: EVENT_ID,
      owner_id: 1,
      slug: 'grand-wedding-2026',
      name: 'Grand Wedding 2026',
    });

    const pgAdapter = db.adapters.createPg();
    pool = new pgAdapter.Pool();
    setDatabasePool(pool);
  });

  afterAll(async () => {
    await stopWorkers(100);
    await closeQueues();
    if (pool) await pool.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Photo Job Processing & Audit Lifecycle (photoJobProcessor)', () => {
    it('processes valid photo, generates derivatives, sets ready status, and marks processing_jobs completed', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000001';
      const originalKey = `events/${EVENT_ID}/originals/${mediaId}.jpg`;
      const jpegBuffer = await createSampleJpeg(1200, 800);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_original: originalKey,
        status: 'uploaded',
        file_size: jpegBuffer.length,
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000001',
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'pending',
        job_id: mediaId,
      });

      const storageMap = new Map<string, Buffer>();
      storageMap.set(originalKey, jpegBuffer);

      vi.spyOn(storageAdapter, 'getObject').mockImplementation(async (key: string) => {
        const buf = storageMap.get(key);
        if (!buf) throw new Error(`Not found in mock storage: ${key}`);
        return buf;
      });

      vi.spyOn(storageAdapter, 'putObject').mockImplementation(
        async (key: string, data: any) => {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          storageMap.set(key, buf);
          return { key, sizeBytes: buf.length };
        }
      );

      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await photoJobProcessor(fakeJob);

      // Verify media updated to 'ready'
      const mediaRows = db.public.many(`SELECT status, width, height, storage_key_thumbnail FROM media WHERE id = '${mediaId}';`);
      expect(mediaRows[0].status).toBe('ready');
      expect(mediaRows[0].width).toBe(1200);
      expect(mediaRows[0].height).toBe(800);
      expect(mediaRows[0].storage_key_thumbnail).toContain('thumbnails');

      // Verify processing_jobs mirror updated to 'completed'
      const jobRows = db.public.many(`SELECT status, progress, processed_items, attempts FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('completed');
      expect(jobRows[0].progress).toBe(100);
      expect(jobRows[0].processed_items).toBe(1);
      expect(jobRows[0].attempts).toBe(1);
    });

    it('handles idempotent execution safely when photo is already ready', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000002';
      const thumbnailKey = `events/${EVENT_ID}/thumbnails/${mediaId}.webp`;
      const previewKey = `events/${EVENT_ID}/previews/${mediaId}.webp`;

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_original: `events/${EVENT_ID}/originals/${mediaId}.jpg`,
        storage_key_thumbnail: thumbnailKey,
        storage_key_preview: previewKey,
        thumbnail_size: 450,
        preview_size: 2500,
        width: 1200,
        height: 800,
        status: 'ready',
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000002',
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'pending',
      });

      const getObjectSpy = vi.spyOn(storageAdapter, 'getObject');

      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await photoJobProcessor(fakeJob);

      // Should not have downloaded original again
      expect(getObjectSpy).not.toHaveBeenCalled();

      // processing_jobs should be marked completed
      const jobRows = db.public.many(`SELECT status, progress FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('completed');
      expect(jobRows[0].progress).toBe(100);
    });

    it('marks processing_jobs failed and throws UnrecoverableError for corrupt image', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000003';
      const originalKey = `events/${EVENT_ID}/originals/${mediaId}.jpg`;
      const corruptBuffer = Buffer.from('NOT_A_VALID_JPEG_HEADER');

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_original: originalKey,
        status: 'uploaded',
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000003',
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'pending',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(corruptBuffer);

      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await expect(photoJobProcessor(fakeJob)).rejects.toThrow(UnrecoverableError);

      // Verify processing_jobs status is failed with error message
      const jobRows = db.public.many(`SELECT status, error_message FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('failed');
      expect(jobRows[0].error_message).toContain('Unsupported or invalid image file signature');

      // Verify original media record still exists with status = failed
      const mediaRows = db.public.many(`SELECT status, storage_key_original FROM media WHERE id = '${mediaId}';`);
      expect(mediaRows[0].status).toBe('failed');
      expect(mediaRows[0].storage_key_original).toBe(originalKey);
    });

    it('throws UnrecoverableError when media record does not exist in database', async () => {
      const nonExistentMediaId = '10000000-0000-0000-0000-000000000099';
      const fakeJob = {
        id: nonExistentMediaId,
        data: { mediaId: nonExistentMediaId, eventId: EVENT_ID },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await expect(photoJobProcessor(fakeJob)).rejects.toThrow(UnrecoverableError);
    });
  });

  describe('2. Video Job Processing Lifecycle (videoJobProcessor)', () => {
    it('processes video, updates derivatives, and updates processing_jobs audit table', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000010';
      const originalKey = `events/${EVENT_ID}/originals/${mediaId}.mp4`;
      const videoBuffer = Buffer.from('FAKE_VIDEO_BINARY_DATA');

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'video',
        filename: `${mediaId}.mp4`,
        storage_key_original: originalKey,
        status: 'uploaded',
        file_size: videoBuffer.length,
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000010',
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'video_processing',
        status: 'pending',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(videoBuffer);
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue({
        key: 'key',
        sizeBytes: 100,
      });

      vi.spyOn(videoPipeline, 'probeVideo').mockResolvedValue({
        duration: 15.0,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        bitrate: 4000000,
        frameRate: 30,
        formatName: 'mov,mp4',
      });

      vi.spyOn(videoPipeline, 'extractPosterFrame').mockResolvedValue({
        posterBuffer: Buffer.from('POSTER_FRAME_BUFFER'),
        width: 1920,
        height: 1080,
      });

      vi.spyOn(videoPipeline, 'generatePlaybackRendition').mockImplementation(
        async (_inPath, outPath) => {
          await fs.promises.writeFile(outPath, Buffer.from('PLAYBACK_VIDEO_MP4'));
          return { sizeBytes: 1024 };
        }
      );

      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job<any>;

      await videoJobProcessor(fakeJob);

      // Verify media updated to 'ready'
      const mediaRows = db.public.many(`SELECT status, video_codec, audio_codec FROM media WHERE id = '${mediaId}';`);
      expect(mediaRows[0].status).toBe('ready');
      expect(mediaRows[0].video_codec).toBe('h264');
      expect(mediaRows[0].audio_codec).toBe('aac');

      // Verify processing_jobs mirror updated to 'completed'
      const jobRows = db.public.many(`SELECT status, progress FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('completed');
      expect(jobRows[0].progress).toBe(100);
    });

    it('idempotently skips video if already ready', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000011';
      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'video',
        filename: `${mediaId}.mp4`,
        storage_key_original: `events/${EVENT_ID}/originals/${mediaId}.mp4`,
        storage_key_thumbnail: `events/${EVENT_ID}/thumbnails/${mediaId}.webp`,
        storage_key_preview: `events/${EVENT_ID}/previews/${mediaId}.mp4`,
        thumbnail_size: 500,
        preview_size: 5000,
        video_duration: 30,
        status: 'ready',
      });

      const probeSpy = vi.spyOn(videoPipeline, 'probeVideo');

      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job<any>;

      await videoJobProcessor(fakeJob);

      expect(probeSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. Durable Outbox & Failed Job Recovery', () => {
    it('retryFailedJob resets media and audit status and re-enqueues', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000020';

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_original: `events/${EVENT_ID}/originals/${mediaId}.jpg`,
        status: 'failed',
        processing_error: 'Temporary R2 network timeout',
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000020',
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'failed',
        error_message: 'Temporary R2 network timeout',
        attempts: 3,
      });

      const recoveryRes = await retryFailedJob(mediaId);
      expect(recoveryRes.success).toBe(true);
      expect(recoveryRes.mediaType).toBe('photo');
      expect(recoveryRes.jobId).toBe(mediaId);

      // Verify media row reset to uploaded
      const mediaRows = db.public.many(`SELECT status, processing_error FROM media WHERE id = '${mediaId}';`);
      expect(mediaRows[0].status).toBe('uploaded');
      expect(mediaRows[0].processing_error).toBeNull();

      // Verify processing_jobs row reset to pending
      const jobRows = db.public.many(`SELECT status, progress, error_message FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('pending');
      expect(jobRows[0].progress).toBe(0);
      expect(jobRows[0].error_message).toBeNull();
    });

    it('dispatchPendingOutboxJobs dispatches pending jobs safely', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000021';

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_original: `events/${EVENT_ID}/originals/${mediaId}.jpg`,
        status: 'uploaded',
      });

      // Insert job created 2 minutes ago
      db.public.none(
        `INSERT INTO processing_jobs (id, event_id, media_id, type, status, progress, total_items, processed_items, created_at, updated_at)
         VALUES ('80000000-0000-0000-0000-000000000021', '${EVENT_ID}', '${mediaId}', 'photo_processing', 'pending', 0, 1, 0, NOW() - INTERVAL '2 minutes', NOW());`
      );

      const result = await dispatchPendingOutboxJobs();
      expect(result.dispatched).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Worker Lifecycle, Concurrency & Diagnostics', () => {
    it('reports worker status matching configured bounded concurrency', () => {
      startWorkers();
      const statuses = getWorkersStatus();

      expect(statuses.length).toBeGreaterThanOrEqual(2);
      const photoStatus = statuses.find((s) => s.queue === 'photo-processing');
      const videoStatus = statuses.find((s) => s.queue === 'video-processing');

      expect(photoStatus?.concurrency).toBe(4);
      expect(photoStatus?.isRunning).toBe(true);

      expect(videoStatus?.concurrency).toBe(1); // Isolated single-worker concurrency
      expect(videoStatus?.isRunning).toBe(true);
    });

    it('collects queue metrics for both photo and video queues', async () => {
      const metrics = await getAllQueueMetrics();
      expect(metrics.length).toBeGreaterThanOrEqual(2);

      const photoMetrics = metrics.find((m) => m.queue === 'photo-processing');
      const videoMetrics = metrics.find((m) => m.queue === 'video-processing');

      expect(photoMetrics).toBeDefined();
      expect(photoMetrics?.waiting).toBeGreaterThanOrEqual(0);

      expect(videoMetrics).toBeDefined();
      expect(videoMetrics?.waiting).toBeGreaterThanOrEqual(0);
    });

    it('evaluates background infrastructure health cleanly', async () => {
      const health = await getBackgroundInfrastructureHealth();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
      expect(health.queues.length).toBeGreaterThanOrEqual(2);
      expect(health.workers.length).toBeGreaterThanOrEqual(2);
    });

    it('integrates queues check into GET /health response', async () => {
      const res = await request(app).get('/health');
      expect([200, 503]).toContain(res.status);
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.queues).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(res.body.checks.queues.status);
    });
  });
});
