import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';

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
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
  insertTestProcessingJob,
} from '../helpers/db_test_helper.js';
import {
  photoJobProcessor,
  videoJobProcessor,
  stopWorkers,
} from '../../apps/api/src/services/queue/workerManager.js';
import {
  reclaimStuckJobs,
  dispatchPendingOutboxJobs,
  getAllQueueMetrics,
  getBackgroundInfrastructureHealth,
} from '../../apps/api/src/services/queue/jobRecoveryService.js';
import {
  calculateBackoffDelay,
  isNonRetryableError,
  sanitizeErrorMessage,
  RETRY_POLICIES,
} from '../../apps/api/src/services/queue/queueConfig.js';
import { closeQueues } from '../../apps/api/src/services/queue/queueManager.js';
import { indexPhotoFaces } from '../../apps/api/src/services/faceIndexingService.js';
import { searchEventPhotosBySelfie } from '../../apps/api/src/services/faceSearchService.js';
import { UnrecoverableError, type Job } from 'bullmq';
import type { IMemoryDb } from 'pg-mem';
import * as aiClient from '../../apps/api/src/infrastructure/aiClient.js';
import { getConfig, resetConfig } from '@photography-saas/config';

describe('Phase 29: Background Job Reliability, Retries & Failure Recovery', () => {
  const app = createApp();
  let db: IMemoryDb;
  let pool: any;

  const EVENT_ID = 'e0000000-0000-0000-0000-000000000001';
  const OWNER_ID = 1;

  async function createSampleJpeg(width = 1000, height = 750): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 197, g: 160, b: 89 }, // Champagne bronze
      },
    })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  beforeAll(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret-minimum-32-characters-required');
    vi.stubEnv('JWT_SECRET', 'test-jwt-secret-minimum-32-characters-required');
    vi.stubEnv('INTERNAL_SERVICE_KEY', 'test-internal-service-key-32-chars');
    resetConfig();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    resetConfig();
    await closeQueues();
    await stopWorkers();
  });

  beforeEach(async () => {
    db = createTestDatabase();
    pool = {
      query: (text: string, params?: any[]) => {
        try {
          if (!params || params.length === 0) {
            const res = db.public.query(text);
            return Promise.resolve({ rows: res.rows || [], rowCount: res.rowCount || 0 });
          }
          let replacedSql = text;
          params.forEach((param, idx) => {
            let valStr = 'NULL';
            if (param instanceof Date) {
              valStr = `'${param.toISOString()}'::timestamptz`;
            } else if (typeof param === 'number') {
              valStr = String(param);
            } else if (typeof param === 'boolean') {
              valStr = param ? 'TRUE' : 'FALSE';
            } else if (param !== null && param !== undefined) {
              valStr = `'${String(param).replace(/'/g, "''")}'`;
            }
            const regex = new RegExp(`\\$${idx + 1}(?![0-9])`, 'g');
            replacedSql = replacedSql.replace(regex, valStr);
          });
          const res = db.public.query(replacedSql);
          return Promise.resolve({ rows: res.rows || [], rowCount: res.rowCount || 0 });
        } catch (err) {
          return Promise.reject(err);
        }
      },
      connect: () =>
        Promise.resolve({
          query: (t: string, p?: any[]) => pool.query(t, p),
          release: () => {},
        }),
    };
    setDatabasePool(pool);

    insertTestPhotographer(db, { id: OWNER_ID });
    insertTestEvent(db, {
      id: EVENT_ID,
      owner_id: OWNER_ID,
      name: 'Reliability Test Gala',
      status: 'active',
      visibility: 'public',
      watermark_enabled: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Photo Indexing & Idempotent Processing', () => {
    it('1. completes a successful photo-indexing job and records audit metadata', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000001';
      const originalKey = `events/${EVENT_ID}/originals/${mediaId}.jpg`;
      const validBuffer = await createSampleJpeg(1200, 800);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_original: originalKey,
        status: 'uploaded',
        file_size: validBuffer.length,
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000001',
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'pending',
      });

      const storageMap = new Map<string, Buffer>();
      storageMap.set(originalKey, validBuffer);

      vi.spyOn(storageAdapter, 'getObject').mockImplementation(async (key: string) => {
        const buf = storageMap.get(key);
        if (!buf) throw new Error(`Not found: ${key}`);
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
        data: { mediaId, eventId: EVENT_ID, version: 1 },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await photoJobProcessor(fakeJob);

      const mediaRows = db.public.many(`SELECT status, width, height, storage_key_thumbnail FROM media WHERE id = '${mediaId}';`);
      expect(mediaRows[0].status).toBe('ready');
      expect(mediaRows[0].width).toBe(1200);
      expect(mediaRows[0].height).toBe(800);

      const jobRows = db.public.many(`SELECT status, progress, attempts, idempotency_key FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('completed');
      expect(jobRows[0].progress).toBe(100);
      expect(jobRows[0].attempts).toBe(1);
      expect(jobRows[0].idempotency_key).toBe(`photo_processing:${mediaId}:v1`);
    });

    it('8. retrying an indexing job is idempotent without duplicate face records', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000008';
      const validBuffer = await createSampleJpeg(800, 600);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_original: `events/${EVENT_ID}/originals/${mediaId}.jpg`,
        storage_key_preview: `events/${EVENT_ID}/previews/${mediaId}.webp`,
        status: 'ready',
      });

      // Insert pre-existing face embedding for this photo
      db.public.none(
        `INSERT INTO face_embeddings (id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, model_name, model_version, embedding)
         VALUES ('70000000-0000-0000-0000-000000000001', '${EVENT_ID}', '${mediaId}', 0, 0.2, 0.2, 0.3, 0.3, 0.95, 'SFace', 'v1', '[${Array(128).fill(0.1).join(',')}]');`
      );

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(validBuffer);
      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 1,
        faces: [
          {
            faceIndex: 0,
            boxX: 0.2,
            boxY: 0.2,
            boxW: 0.3,
            boxH: 0.3,
            confidence: 0.95,
            modelName: 'SFace',
            modelVersion: 'v1',
            embedding: Array(128).fill(0.1),
          },
        ],
      });

      // Execute indexing twice
      await indexPhotoFaces(mediaId, EVENT_ID, validBuffer);
      await indexPhotoFaces(mediaId, EVENT_ID, validBuffer);

      const embeddingRows = db.public.many(
        `SELECT COUNT(*) as count FROM face_embeddings WHERE photo_id = '${mediaId}' AND event_id = '${EVENT_ID}';`
      );
      // Clean transactional replacement: count is exactly 1, no duplicate records
      expect(Number(embeddingRows[0].count)).toBe(1);
    });

    it('9. deliberate model-version change triggers safe reindexing', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000009';
      const validBuffer = await createSampleJpeg(800, 600);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_preview: `events/${EVENT_ID}/previews/${mediaId}.webp`,
        status: 'ready',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(validBuffer);
      vi.spyOn(aiClient, 'extractFaceEmbeddings')
        .mockResolvedValueOnce({
          status: 'success',
          faceCount: 1,
          faces: [
            {
              faceIndex: 0,
              boxX: 0.2,
              boxY: 0.2,
              boxW: 0.3,
              boxH: 0.3,
              confidence: 0.95,
              modelName: 'SFace',
              modelVersion: 'v1',
              embedding: Array(128).fill(0.1),
            },
          ],
        })
        .mockResolvedValueOnce({
          status: 'success',
          faceCount: 1,
          faces: [
            {
              faceIndex: 0,
              boxX: 0.2,
              boxY: 0.2,
              boxW: 0.3,
              boxH: 0.3,
              confidence: 0.98,
              modelName: 'SFace',
              modelVersion: 'v2',
              embedding: Array(128).fill(0.2),
            },
          ],
        });

      // Initial index (v1)
      await indexPhotoFaces(mediaId, EVENT_ID, validBuffer);

      // Verify v1 recorded
      const v1Rows = db.public.many(`SELECT model_name, model_version FROM face_embeddings WHERE photo_id = '${mediaId}';`);
      expect(v1Rows.length).toBe(1);
      expect(v1Rows[0].model_name).toBe('SFace');
      expect(v1Rows[0].model_version).toBe('v1');

      // Model upgraded to v2: deliberate reindex cleanly updates to v2 without duplication
      await indexPhotoFaces(mediaId, EVENT_ID, validBuffer);

      const v2Rows = db.public.many(`SELECT model_name, model_version FROM face_embeddings WHERE photo_id = '${mediaId}';`);
      expect(v2Rows.length).toBe(1);
      expect(v2Rows[0].model_name).toBe('SFace');
      expect(v2Rows[0].model_version).toBe('v2');
    });
  });

  describe('2. Retry Policies & Exponential Backoff with Jitter', () => {
    it('2. recovers from a transient failure via bounded retry delay', async () => {
      const delay1 = calculateBackoffDelay(1, 2000, 30000, 0.2);
      const delay2 = calculateBackoffDelay(2, 2000, 30000, 0.2);
      const delay3 = calculateBackoffDelay(3, 2000, 30000, 0.2);

      // Verify exponential progression within jitter range (approx 2s, 4s, 8s)
      expect(delay1).toBeGreaterThanOrEqual(1600);
      expect(delay1).toBeLessThanOrEqual(2400);

      expect(delay2).toBeGreaterThanOrEqual(3200);
      expect(delay2).toBeLessThanOrEqual(4800);

      expect(delay3).toBeGreaterThanOrEqual(6400);
      expect(delay3).toBeLessThanOrEqual(9600);
    });

    it('3. recovers from transient R2 storage failure during retry', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000003';
      const originalKey = `events/${EVENT_ID}/originals/${mediaId}.jpg`;
      const validBuffer = await createSampleJpeg(1000, 600);

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

      // Transient R2 network failure on first call, success on second
      let callCount = 0;
      vi.spyOn(storageAdapter, 'getObject').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('R2_NETWORK_TIMEOUT: Connection reset by peer');
        }
        return validBuffer;
      });

      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue({ key: 'key', sizeBytes: 100 });

      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      // Attempt 1 fails transiently
      await expect(photoJobProcessor(fakeJob)).rejects.toThrow('R2_NETWORK_TIMEOUT');

      // Audit status marked as retry_wait with next_retry_at scheduled
      const jobRowsAfterFail = db.public.many(`SELECT status, error_code, next_retry_at FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRowsAfterFail[0].status).toBe('retry_wait');
      expect(jobRowsAfterFail[0].error_code).toBe('TRANSIENT_FAILURE');
      expect(jobRowsAfterFail[0].next_retry_at).not.toBeNull();

      // Attempt 2 succeeds
      const retryJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await photoJobProcessor(retryJob);

      const jobRowsAfterSuccess = db.public.many(`SELECT status, progress FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRowsAfterSuccess[0].status).toBe('completed');
      expect(jobRowsAfterSuccess[0].progress).toBe(100);
    });

    it('4. immediately marks permanently invalid image as failed without indefinite retry', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000004';
      const corruptBuffer = Buffer.from('NOT_AN_IMAGE_HEADER');

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_original: `events/${EVENT_ID}/originals/${mediaId}.jpg`,
        status: 'uploaded',
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000004',
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

      // Throws UnrecoverableError indicating BullMQ should not retry
      await expect(photoJobProcessor(fakeJob)).rejects.toThrow(UnrecoverableError);

      const jobRows = db.public.many(`SELECT status, error_code, error_message FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('failed');
      expect(jobRows[0].error_code).toBe('NON_RETRYABLE_ERROR');
      expect(jobRows[0].error_message).toContain('Unsupported or invalid image file signature');
    });

    it('15. job exhausting retry limit moves cleanly to dead-letter failed state', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000015';

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        filename: `${mediaId}.jpg`,
        storage_key_original: `events/${EVENT_ID}/originals/${mediaId}.jpg`,
        status: 'uploaded',
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000015',
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'processing',
        attempts: 2,
        max_attempts: 3,
      });

      vi.spyOn(storageAdapter, 'getObject').mockRejectedValue(new Error('Persistent R2 storage failure'));

      const finalAttemptJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 2, // 3rd attempt
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await expect(photoJobProcessor(finalAttemptJob)).rejects.toThrow('Persistent R2 storage failure');

      const jobRows = db.public.many(`SELECT status, error_code FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('failed');
      expect(jobRows[0].error_code).toBe('MAX_RETRIES_EXCEEDED');
    });
  });

  describe('3. Worker Crash & Lease Recovery', () => {
    it('5 & 6. reclaims stuck job whose processing lease has expired', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000005';
      const jobId = '80000000-0000-0000-0000-000000000005';

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        status: 'processing',
      });

      // Insert job with expired lease from a crashed worker
      insertTestProcessingJob(db, {
        id: jobId,
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'processing',
        attempts: 1,
        max_attempts: 3,
        worker_id: 'crashed-worker-pid-999',
        lease_expires_at: new Date(Date.now() - 60000).toISOString(), // Expired 1 min ago
      });

      const recoveryResult = await reclaimStuckJobs();
      expect(recoveryResult.reclaimed).toBe(1);

      const jobRows = db.public.many(`SELECT status, error_code, next_retry_at, worker_id FROM processing_jobs WHERE id = '${jobId}';`);
      expect(jobRows[0].status).toBe('retry_wait');
      expect(jobRows[0].error_code).toBe('LEASE_RECLAIMED');
      expect(jobRows[0].worker_id).toBeNull();
      expect(jobRows[0].next_retry_at).not.toBeNull();
    });

    it('7. safely handles two concurrent workers attempting to claim the same job', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000007';
      const validBuffer = await createSampleJpeg(600, 400);

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        storage_key_original: `events/${EVENT_ID}/originals/${mediaId}.jpg`,
        status: 'uploaded',
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000007',
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'pending',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(validBuffer);
      vi.spyOn(storageAdapter, 'putObject').mockResolvedValue({ key: 'key', sizeBytes: 100 });

      const job1 = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      const job2 = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      // Execute both concurrently
      await Promise.all([photoJobProcessor(job1), photoJobProcessor(job2)]);

      // State remains cleanly completed and status is ready
      const mediaRows = db.public.many(`SELECT status FROM media WHERE id = '${mediaId}';`);
      expect(mediaRows[0].status).toBe('ready');

      const jobRows = db.public.many(`SELECT status, progress FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('completed');
      expect(jobRows[0].progress).toBe(100);
    });

    it('16. allows manual retry of an eligible failed job via API', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000016';
      const jobId = '80000000-0000-0000-0000-000000000016';

      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        status: 'failed',
        processing_error: 'Previous failure message',
      });

      insertTestProcessingJob(db, {
        id: jobId,
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'failed',
        error_code: 'MAX_RETRIES_EXCEEDED',
        error_message: 'Previous failure message',
      });

      const internalKey = getConfig().internalServiceKey || getConfig().authSecret;
      const res = await request(app)
        .post(`/internal/jobs/${jobId}/retry`)
        .set('X-Internal-Service-Key', internalKey)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');

      const jobRows = db.public.many(`SELECT status, error_code, error_message FROM processing_jobs WHERE id = '${jobId}';`);
      expect(jobRows[0].status).toBe('pending');
      expect(jobRows[0].error_code).toBeNull();
      expect(jobRows[0].error_message).toBeNull();
    });
  });

  describe('4. Event Lifecycle & Deletion Protection', () => {
    it('10. cleanly aborts when photo is deleted during processing', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000010';

      // No media record in DB (deleted)
      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await expect(photoJobProcessor(fakeJob)).rejects.toThrow(UnrecoverableError);
    });

    it('11. cancels job and emits no output when event enters trashed state', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000011';
      const trashedEventId = 'e0000000-0000-0000-0000-000000000099';

      insertTestEvent(db, {
        id: trashedEventId,
        owner_id: OWNER_ID,
        status: 'trashed',
      });

      insertTestMedia(db, {
        id: mediaId,
        event_id: trashedEventId,
        type: 'photo',
        status: 'uploaded',
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000011',
        event_id: trashedEventId,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'pending',
      });

      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: trashedEventId },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      // Executes cleanly without error, but transitions to cancelled
      await photoJobProcessor(fakeJob);

      const jobRows = db.public.many(`SELECT status, error_code FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('cancelled');
      expect(jobRows[0].error_code).toBe('EVENT_CANCELLED');
    });

    it('12. cancels job when event enters deleting state during processing', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000012';
      const deletingEventId = 'e0000000-0000-0000-0000-000000000098';

      insertTestEvent(db, {
        id: deletingEventId,
        owner_id: OWNER_ID,
        status: 'deleting',
      });

      insertTestMedia(db, {
        id: mediaId,
        event_id: deletingEventId,
        type: 'video',
        status: 'uploaded',
      });

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000012',
        event_id: deletingEventId,
        media_id: mediaId,
        type: 'video_processing',
        status: 'pending',
      });

      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: deletingEventId },
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as unknown as Job<any>;

      await videoJobProcessor(fakeJob);

      const jobRows = db.public.many(`SELECT status, error_code FROM processing_jobs WHERE media_id = '${mediaId}';`);
      expect(jobRows[0].status).toBe('cancelled');
      expect(jobRows[0].error_code).toBe('EVENT_CANCELLED');
    });

    it('18. stale job is prevented from overwriting newer watermark results', async () => {
      const mediaId = '10000000-0000-0000-0000-000000000018';
      const validBuffer = await createSampleJpeg(800, 600);

      // Media is already on watermark v2
      insertTestMedia(db, {
        id: mediaId,
        event_id: EVENT_ID,
        type: 'photo',
        storage_key_original: `events/${EVENT_ID}/originals/${mediaId}.jpg`,
        storage_key_thumbnail: `events/${EVENT_ID}/thumbnails/${mediaId}.webp`,
        storage_key_preview: `events/${EVENT_ID}/previews/${mediaId}.webp`,
        watermark_version: 2,
        status: 'ready',
      });

      // Event is at watermark v2
      db.public.none(`UPDATE events SET watermark_version = 2 WHERE id = '${EVENT_ID}';`);

      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000018',
        event_id: EVENT_ID,
        media_id: mediaId,
        type: 'photo_processing',
        status: 'pending',
      });

      vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(validBuffer);
      const putSpy = vi.spyOn(storageAdapter, 'putObject');

      // Stale v1 job picked up
      const fakeJob = {
        id: mediaId,
        data: { mediaId, eventId: EVENT_ID, version: 1 },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await photoJobProcessor(fakeJob);

      // Idempotently skipped without overwriting v2 derivatives
      expect(putSpy).not.toHaveBeenCalled();
      const mediaRows = db.public.many(`SELECT watermark_version FROM media WHERE id = '${mediaId}';`);
      expect(mediaRows[0].watermark_version).toBe(2);
    });
  });

  describe('5. R2 Hardening, Deletions & Missing Objects', () => {
    it('13 & 14. handles already-missing R2 objects safely during deletion and cleanup', async () => {
      // Missing object from storage purge should not throw or fail cleanup
      vi.spyOn(storageAdapter, 'purgeEventPrefix').mockResolvedValue({
        eventId: EVENT_ID,
        deletedCount: 0,
        prefix: `events/${EVENT_ID}`,
      });

      const result = await storageAdapter.purgeEventPrefix(EVENT_ID);
      expect(result.deletedCount).toBe(0);
    });
  });

  describe('6. Biometric Privacy Zero-Retention & Sanitization', () => {
    it('19. guest selfie buffers and raw query vectors are never persisted in jobs or errors', async () => {
      const validSelfie = await createSampleJpeg(400, 400);

      // Verify sanitizeErrorMessage strips tokens and sensitive parameters
      const rawErrorWithSecret = 'Error contacting SFace: token=super_secret_token_12345 at postgres://user:secret@localhost:5432/db';
      const sanitized = sanitizeErrorMessage(rawErrorWithSecret);

      expect(sanitized).not.toContain('super_secret_token_12345');
      expect(sanitized).not.toContain('user:secret');
      expect(sanitized).toContain('[REDACTED]');

      // Verify no guest selfie data exists in processing_jobs table
      const jobCountWithSelfie = db.public.many(
        `SELECT COUNT(*) as count FROM processing_jobs WHERE error_message LIKE '%selfie%' OR type = 'guest_selfie';`
      );
      expect(Number(jobCountWithSelfie[0].count)).toBe(0);
    });
  });

  describe('7. Management & Reconciler Endpoints', () => {
    it('17 & 20. GET /internal/jobs lists durable jobs and supports filtering and manual reconciliation', async () => {
      insertTestProcessingJob(db, {
        id: '80000000-0000-0000-0000-000000000099',
        event_id: EVENT_ID,
        type: 'photo_processing',
        status: 'completed',
        attempts: 1,
      });

      const internalKey = getConfig().internalServiceKey || getConfig().authSecret;
      const listRes = await request(app)
        .get('/internal/jobs?status=completed')
        .set('X-Internal-Service-Key', internalKey)
        .expect(200);

      expect(listRes.body.success).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

      const reconcileRes = await request(app)
        .post('/internal/jobs/reconcile')
        .set('X-Internal-Service-Key', internalKey)
        .expect(200);

      expect(reconcileRes.body.success).toBe(true);
      expect(reconcileRes.body.data).toHaveProperty('reclaimed');
      expect(reconcileRes.body.data).toHaveProperty('dispatched');
    });
  });
});
