import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { S3Client } from '@aws-sdk/client-s3';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestMedia,
  insertTestFolder,
  insertTestFaceEmbedding,
  insertTestDownloadJob,
  insertTestStorageUsage,
} from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { clearMemoryRateLimitStore } from '../../apps/api/src/middleware/rateLimiter.js';
import { setR2ClientForTesting, resetR2Client } from '../../apps/api/src/infrastructure/r2Client.js';
import {
  deleteEventPermanently,
  getEventDeletionStatus,
  reconcilePendingDeletions,
} from '../../apps/api/src/services/eventDeletionService.js';
import { verifyEventOwnership } from '../../apps/api/src/services/mediaUploadService.js';
import { indexPhotoFaces } from '../../apps/api/src/services/faceIndexingService.js';
import { detectAndRecordFaces } from '../../apps/api/src/services/faceDetectionService.js';

describe('Secure Event Deletion & Durable Data Cleanup Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'SecureMasterPhotographer2026!';
  let authCookie: string;
  let mockS3Client: S3Client;
  const bucketName = 'studio-lumina-secure-deletion-bucket';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    db = createTestDatabase();
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography');`
    );

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);

    // Mock S3 client for R2
    mockS3Client = new S3Client({
      region: 'auto',
      endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: 'test-key-id',
        secretAccessKey: 'test-secret-key',
      },
    });

    // Obtain photographer auth session cookie
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
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  beforeEach(() => {
    clearMemoryRateLimitStore();
    setR2ClientForTesting(mockS3Client, bucketName);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetR2Client();
  });

  describe('1. Explicit Confirmation & Typed Name Guard', () => {
    it('should reject permanent deletion if confirmEventName is missing', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000001';
      insertTestEvent(db, { id: eventId, name: 'Royal Rajputana Wedding', owner_id: 1 });

      const res = await request(app)
        .delete(`/api/events/${eventId}`)
        .set('Cookie', [authCookie])
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);

      // Verify event was NOT marked deleting and NOT purged
      const eventRes = await pool.query(`SELECT status FROM events WHERE id = $1`, [eventId]);
      expect(eventRes.rows[0].status).toBe('active');
    });

    it('should reject permanent deletion if confirmEventName does not match actual event name', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000002';
      insertTestEvent(db, { id: eventId, name: 'Sunset Beach Nuptials', owner_id: 1 });

      const res = await request(app)
        .delete(`/api/events/${eventId}`)
        .set('Cookie', [authCookie])
        .send({ confirmEventName: 'Sunrise Beach Nuptials' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const eventRes = await pool.query(`SELECT status FROM events WHERE id = $1`, [eventId]);
      expect(eventRes.rows[0].status).toBe('active');
    });
  });

  describe('2. Authorization, IDOR & Access Guard', () => {
    it('should reject unauthenticated deletion request with 401', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000003';
      insertTestEvent(db, { id: eventId, name: 'Unauthorized Target', owner_id: 1 });

      const res = await request(app)
        .delete(`/api/events/${eventId}`)
        .send({ confirmEventName: 'Unauthorized Target' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should reject deletion of non-existent event with 404', async () => {
      const res = await request(app)
        .delete('/api/events/e1000000-0000-0000-0000-999999999999')
        .set('Cookie', [authCookie])
        .send({ confirmEventName: 'Nonexistent Event' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });
  });

  describe('3. Complete Cascading Deletion with Photos, Videos, and Neural Face Embeddings', () => {
    it('should permanently purge event, media, folders, face embeddings, jobs, and R2 objects', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000010';
      const eventName = 'Heritage Palace Gala 2026';
      insertTestEvent(db, { id: eventId, name: eventName, owner_id: 1 });

      // Insert folders with distinct IDs
      const folder1 = insertTestFolder(db, {
        id: 'f0000000-0000-0000-0000-000000000001',
        event_id: eventId,
        name: 'Mehendi',
      });
      const folder2 = insertTestFolder(db, {
        id: 'f0000000-0000-0000-0000-000000000002',
        event_id: eventId,
        name: 'Sangeet',
      });

      // Insert photos and videos with distinct IDs
      const photo1 = insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000011',
        event_id: eventId,
        folder_id: folder1.id,
        type: 'photo',
        filename: 'dsc_0001.jpg',
        storage_key_original: `events/${eventId}/originals/dsc_0001.jpg`,
        storage_key_preview: `events/${eventId}/previews/dsc_0001.webp`,
        storage_key_thumbnail: `events/${eventId}/thumbnails/dsc_0001.webp`,
      });

      const video1 = insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000012',
        event_id: eventId,
        folder_id: folder2.id,
        type: 'video',
        filename: 'ceremony_highlight.mp4',
        storage_key_original: `events/${eventId}/videos/ceremony_highlight.mp4`,
        storage_key_preview: `events/${eventId}/previews/ceremony_highlight.webp`,
        storage_key_thumbnail: `events/${eventId}/thumbnails/ceremony_highlight.webp`,
      });

      // Insert multiple face embeddings for photo1
      insertTestFaceEmbedding(db, {
        id: '20000000-0000-0000-0000-000000000001',
        event_id: eventId,
        photo_id: photo1.id,
        face_index: 0,
        embedding: '[0.12, 0.34, 0.56]',
      });
      insertTestFaceEmbedding(db, {
        id: '20000000-0000-0000-0000-000000000002',
        event_id: eventId,
        photo_id: photo1.id,
        face_index: 1,
        embedding: '[-0.22, 0.44, 0.11]',
      });

      // Insert download job and storage usage
      insertTestDownloadJob(db, {
        id: 'd0000000-0000-0000-0000-000000000010',
        event_id: eventId,
        status: 'completed',
        storage_key: `events/${eventId}/archives/all-photos.zip`,
      });
      insertTestStorageUsage(db, { event_id: eventId, original_bytes: 45000000 });

      // Mock S3 listObjects and deleteObjects
      const r2ObjectsInEvent = [
        { Key: `events/${eventId}/originals/dsc_0001.jpg` },
        { Key: `events/${eventId}/previews/dsc_0001.webp` },
        { Key: `events/${eventId}/thumbnails/dsc_0001.webp` },
        { Key: `events/${eventId}/videos/ceremony_highlight.mp4` },
        { Key: `events/${eventId}/previews/ceremony_highlight.webp` },
        { Key: `events/${eventId}/thumbnails/ceremony_highlight.webp` },
        { Key: `events/${eventId}/archives/all-photos.zip` },
      ];

      let listCallCount = 0;
      vi.spyOn(mockS3Client, 'send').mockImplementation(async (command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === 'ListObjectsV2Command') {
          listCallCount++;
          // First listing returns all keys; second listing (verification) returns empty
          if (listCallCount === 1) {
            return { Contents: r2ObjectsInEvent, IsTruncated: false } as never;
          }
          return { Contents: [], IsTruncated: false } as never;
        }
        if (cmdName === 'DeleteObjectsCommand') {
          return { Deleted: command.input.Delete.Objects } as never;
        }
        return {} as never;
      });

      // Execute permanent deletion via REST API
      const res = await request(app)
        .delete(`/api/events/${eventId}`)
        .set('Cookie', [authCookie])
        .send({ confirmEventName: eventName });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);
      expect(res.body.data.id).toBe(eventId);
      expect(res.body.data.r2ObjectsDeleted).toBe(7);

      // Verify Database records are completely purged
      const eventRes = await pool.query(`SELECT * FROM events WHERE id = $1`, [eventId]);
      expect(eventRes.rows.length).toBe(0);

      const mediaRes = await pool.query(`SELECT * FROM media WHERE event_id = $1`, [eventId]);
      expect(mediaRes.rows.length).toBe(0);

      const folderRes = await pool.query(`SELECT * FROM folders WHERE event_id = $1`, [eventId]);
      expect(folderRes.rows.length).toBe(0);

      const faceRes = await pool.query(`SELECT * FROM face_embeddings WHERE event_id = $1`, [eventId]);
      expect(faceRes.rows.length).toBe(0);

      const downloadRes = await pool.query(`SELECT * FROM download_jobs WHERE event_id = $1`, [eventId]);
      expect(downloadRes.rows.length).toBe(0);

      const storageRes = await pool.query(`SELECT * FROM storage_usage WHERE event_id = $1`, [eventId]);
      expect(storageRes.rows.length).toBe(0);

      // Verify durable deletion job audit record exists and is marked completed
      const deletionJobRes = await pool.query(
        `SELECT * FROM event_deletion_jobs WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [eventId]
      );
      const deletionJob = deletionJobRes.rows[0];
      expect(deletionJob.status).toBe('completed');
      expect(deletionJob.stage).toBe('completed');
      expect(deletionJob.r2_objects_deleted).toBe(7);
      expect(deletionJob.completed_at).toBeDefined();

      // Verify subsequent GET returns 404
      const getRes = await request(app)
        .get(`/api/events/${eventId}`)
        .set('Cookie', [authCookie]);
      expect(getRes.status).toBe(404);
    });
  });

  describe('4. Cross-Event Isolation (Zero Leakage)', () => {
    it('should permanently delete Event A while leaving Event B completely intact', async () => {
      const eventAId = 'e1000000-0000-0000-0000-000000000021';
      const eventBId = 'e1000000-0000-0000-0000-000000000022';

      insertTestEvent(db, { id: eventAId, name: 'Event A to Delete', owner_id: 1 });
      insertTestEvent(db, { id: eventBId, name: 'Event B to Keep', owner_id: 1 });

      const mediaA = insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000021',
        event_id: eventAId,
        filename: 'a.jpg',
      });
      const mediaB = insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000022',
        event_id: eventBId,
        filename: 'b.jpg',
      });

      insertTestFaceEmbedding(db, {
        id: '20000000-0000-0000-0000-000000000021',
        event_id: eventAId,
        photo_id: mediaA.id,
      });
      insertTestFaceEmbedding(db, {
        id: '20000000-0000-0000-0000-000000000022',
        event_id: eventBId,
        photo_id: mediaB.id,
      });

      vi.spyOn(mockS3Client, 'send').mockImplementation(async (command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === 'ListObjectsV2Command') {
          return { Contents: [], IsTruncated: false } as never;
        }
        if (cmdName === 'DeleteObjectsCommand') {
          return { Deleted: [] } as never;
        }
        return {} as never;
      });

      // Delete Event A
      const res = await request(app)
        .delete(`/api/events/${eventAId}`)
        .set('Cookie', [authCookie])
        .send({ confirmEventName: 'Event A to Delete' });

      expect(res.status).toBe(200);

      // Event A is gone
      const eventACheck = await pool.query(`SELECT * FROM events WHERE id = $1`, [eventAId]);
      expect(eventACheck.rows.length).toBe(0);
      const faceACheck = await pool.query(`SELECT * FROM face_embeddings WHERE event_id = $1`, [eventAId]);
      expect(faceACheck.rows.length).toBe(0);

      // Event B is 100% intact
      const eventBCheck = await pool.query(`SELECT * FROM events WHERE id = $1`, [eventBId]);
      expect(eventBCheck.rows.length).toBe(1);
      expect(eventBCheck.rows[0].name).toBe('Event B to Keep');
      expect(eventBCheck.rows[0].status).toBe('active');

      const mediaBCheck = await pool.query(`SELECT * FROM media WHERE event_id = $1`, [eventBId]);
      expect(mediaBCheck.rows.length).toBe(1);
      expect(mediaBCheck.rows[0].filename).toBe('b.jpg');

      const faceBCheck = await pool.query(`SELECT * FROM face_embeddings WHERE event_id = $1`, [eventBId]);
      expect(faceBCheck.rows.length).toBe(1);
      expect(faceBCheck.rows[0].event_id).toBe(eventBId);
    });
  });

  describe('5. Immediate Access Restriction & Soft-Lock Defense', () => {
    it('should reject new media upload validation when event status is deleting', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000031';
      insertTestEvent(db, { id: eventId, name: 'Deleting Event', owner_id: 1, status: 'deleting' });

      await expect(verifyEventOwnership(1, eventId)).rejects.toThrow('currently being deleted');
    });

    it('should reject internal indexing routes when event status is deleting', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000032';
      insertTestEvent(db, { id: eventId, name: 'Indexing Lockout Event', owner_id: 1, status: 'deleting' });
      const media = insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000032',
        event_id: eventId,
        filename: 'photo.jpg',
      });

      const res = await request(app)
        .post('/api/internal/index-photo')
        .set('Cookie', [authCookie])
        .send({ eventId, mediaId: media.id });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('6. AI Worker Safeguards & Vector Commit Abort', () => {
    it('should prevent face indexing service from writing vectors if event is deleting', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000041';
      insertTestEvent(db, { id: eventId, name: 'AI Safety Event', owner_id: 1, status: 'deleting' });
      const media = insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000041',
        event_id: eventId,
        filename: 'detect.jpg',
      });

      const result = await indexPhotoFaces(media.id, eventId, 1);
      expect(result.status).toBe('skipped');
      expect(result.error).toContain('being deleted');
      expect(result.embeddingsCount).toBe(0);

      // Verify no face embeddings were inserted
      const countRes = await pool.query(`SELECT COUNT(*) as c FROM face_embeddings WHERE event_id = $1`, [eventId]);
      expect(Number(countRes.rows[0].c)).toBe(0);
    });

    it('should prevent face detection service from writing faces if event is deleting', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000042';
      insertTestEvent(db, { id: eventId, name: 'Detection Safety Event', owner_id: 1, status: 'deleting' });
      const media = insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000042',
        event_id: eventId,
        filename: 'detect.jpg',
      });

      const detResult = await detectAndRecordFaces(media.id, eventId);
      expect(detResult.status).toBe('skipped');
      expect(detResult.error).toContain('being deleted');
      expect(detResult.facesDetected).toBe(0);
    });
  });

  describe('7. Failure Handling, Resiliency & Recovery (Worker Restart)', () => {
    it('should record failed stage and keep event in deleting state if R2 purge fails', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000051';
      const eventName = 'Fault Injection Event';
      insertTestEvent(db, { id: eventId, name: eventName, owner_id: 1 });
      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000051',
        event_id: eventId,
        filename: 'photo.jpg',
      });

      // Mock S3 failure on listObjects
      vi.spyOn(mockS3Client, 'send').mockRejectedValue(new Error('R2 Network Connection Refused'));

      // Execution will catch and record failure
      await expect(
        deleteEventPermanently(eventId, 1, eventName)
      ).rejects.toThrow('R2 Network Connection Refused');

      // Verify event remains inaccessible and soft-locked in deleting status
      const eventRes = await pool.query(`SELECT status FROM events WHERE id = $1`, [eventId]);
      expect(eventRes.rows[0].status).toBe('deleting');

      // Verify durable deletion job recorded failure and failed stage (failed while attempting R2 purge after jobs_cancelled)
      const jobRes = await pool.query(`SELECT * FROM event_deletion_jobs WHERE event_id = $1`, [eventId]);
      const job = jobRes.rows[0];
      expect(job.status).toBe('failed');
      expect(job.stage).toBe('jobs_cancelled');
      expect(job.error_message).toContain('R2 Network Connection Refused');

      // Verify database records were NOT deleted prematurely
      const mediaRes = await pool.query(`SELECT COUNT(*) as c FROM media WHERE event_id = $1`, [eventId]);
      expect(Number(mediaRes.rows[0].c)).toBe(1);
    });

    it('should safely resume and complete pending deletions via reconcilePendingDeletions', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000052';
      const eventName = 'Interrupted Deletion Event';
      insertTestEvent(db, { id: eventId, name: eventName, owner_id: 1, status: 'deleting' });
      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000052',
        event_id: eventId,
        filename: 'photo.jpg',
      });

      // Simulate a durable job that was interrupted in 'processing' status due to a server crash
      await pool.query(
        `INSERT INTO event_deletion_jobs (id, event_id, owner_id, event_name, status, stage, attempts, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'processing', 'jobs_cancelled', 1, NOW(), NOW())`,
        ['d1000000-0000-0000-0000-000000000052', eventId, 1, eventName]
      );

      // Now R2 recovers and returns success
      vi.spyOn(mockS3Client, 'send').mockImplementation(async (command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === 'ListObjectsV2Command') {
          return { Contents: [], IsTruncated: false } as never;
        }
        if (cmdName === 'DeleteObjectsCommand') {
          return { Deleted: [] } as never;
        }
        return {} as never;
      });

      // Server startup runs reconcilePendingDeletions()
      await reconcilePendingDeletions();

      // Verify the event is now completely purged
      const eventCheck = await pool.query(`SELECT * FROM events WHERE id = $1`, [eventId]);
      expect(eventCheck.rows.length).toBe(0);

      const mediaCheck = await pool.query(`SELECT * FROM media WHERE event_id = $1`, [eventId]);
      expect(mediaCheck.rows.length).toBe(0);

      // Verify deletion job transitioned to completed
      const jobRes = await pool.query(
        `SELECT * FROM event_deletion_jobs WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [eventId]
      );
      expect(jobRes.rows[0].status).toBe('completed');
      expect(jobRes.rows[0].stage).toBe('completed');
    });
  });

  describe('8. Repeated Deletion & Idempotency', () => {
    it('should handle repeated deletion calls cleanly without crashing or corrupting data', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000061';
      const eventName = 'Double Delete Event';
      insertTestEvent(db, { id: eventId, name: eventName, owner_id: 1 });

      vi.spyOn(mockS3Client, 'send').mockImplementation(async () => {
        return { Contents: [], IsTruncated: false } as never;
      });

      // First call succeeds
      const res1 = await request(app)
        .delete(`/api/events/${eventId}`)
        .set('Cookie', [authCookie])
        .send({ confirmEventName: eventName });

      expect(res1.status).toBe(200);

      // Second call returns 404 because event is already purged
      const res2 = await request(app)
        .delete(`/api/events/${eventId}`)
        .set('Cookie', [authCookie])
        .send({ confirmEventName: eventName });

      expect(res2.status).toBe(404);
    });
  });

  describe('9. Deletion Status Inspection API', () => {
    it('should allow photographer to inspect deletion status via GET /api/events/:id/deletion-status', async () => {
      const eventId = 'e1000000-0000-0000-0000-000000000071';
      const eventName = 'Inspection Test Event';
      insertTestEvent(db, { id: eventId, name: eventName, owner_id: 1 });

      vi.spyOn(mockS3Client, 'send').mockImplementation(async () => {
        return { Contents: [], IsTruncated: false } as never;
      });

      await request(app)
        .delete(`/api/events/${eventId}`)
        .set('Cookie', [authCookie])
        .send({ confirmEventName: eventName });

      const statusRes = await request(app)
        .get(`/api/events/${eventId}/deletion-status`)
        .set('Cookie', [authCookie]);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.success).toBe(true);
      expect(statusRes.body.data.status).toBe('completed');
      expect(statusRes.body.data.stage).toBe('completed');
      expect(statusRes.body.data.eventName).toBe(eventName);
    });
  });
});
