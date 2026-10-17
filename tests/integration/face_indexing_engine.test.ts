import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { IMemoryDb } from 'pg-mem';
import request from 'supertest';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
} from '../helpers/db_test_helper.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { createApp } from '../../apps/api/src/app.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import * as aiClient from '../../apps/api/src/infrastructure/aiClient.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import { getConfig } from '@photography-saas/config';
vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  return {
    ...actual,
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

describe('Python AI Face Indexing Engine & Internal API Integration Tests', () => {
  let db: IMemoryDb;
  let app: any;

  const eventA = 'a0000000-0000-0000-0000-000000000001';
  const eventB = 'b0000000-0000-0000-0000-000000000002';
  const photoA1 = '10000000-0000-0000-0000-0000000000a1';
  const photoA2 = '10000000-0000-0000-0000-0000000000a2';
  const photoB1 = '20000000-0000-0000-0000-0000000000b1';
  const videoA1 = '30000000-0000-0000-0000-0000000000c1';

  let photographerCookie: string;
  let otherPhotographerCookie: string;

  beforeEach(() => {
    db = createTestDatabase();
    insertTestPhotographer(db, { id: 1, email: 'photographer@studiolumina.photo' });
    insertTestPhotographer(db, { id: 2, email: 'other@studio.photo' });

    insertTestEvent(db, { id: eventA, owner_id: 1, slug: 'wedding-event-a', name: 'Wedding A' });
    insertTestEvent(db, { id: eventB, owner_id: 2, slug: 'corporate-event-b', name: 'Corporate B' });

    insertTestMedia(db, {
      id: photoA1,
      event_id: eventA,
      filename: 'solo_portrait.jpg',
      type: 'photo',
      status: 'uploaded',
    });

    insertTestMedia(db, {
      id: photoA2,
      event_id: eventA,
      filename: 'group_family.jpg',
      type: 'photo',
      status: 'uploaded',
    });

    insertTestMedia(db, {
      id: photoB1,
      event_id: eventB,
      filename: 'event_b_headshot.jpg',
      type: 'photo',
      status: 'uploaded',
    });

    insertTestMedia(db, {
      id: videoA1,
      event_id: eventA,
      filename: 'ceremony_clip.mp4',
      type: 'video',
      status: 'uploaded',
    });

    const poolMock = db.adapters.createPg().Pool;
    setDatabasePool(new poolMock());

    photographerCookie = `${SESSION_COOKIE_NAME}=${signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' })}`;
    otherPhotographerCookie = `${SESSION_COOKIE_NAME}=${signSessionToken({ id: 2, email: 'other@studio.photo' })}`;

    vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(Buffer.from('fake_image_bytes_for_testing'));

    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDatabasePool(null);
  });

  describe('Internal Indexing Endpoints Authorization & Validation', () => {
    it('rejects unauthenticated requests to POST /internal/index-photo', async () => {
      const res = await request(app)
        .post('/internal/index-photo')
        .send({ mediaId: photoA1, eventId: eventA });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects request if photographer does not own the event (IDOR prevention)', async () => {
      const res = await request(app)
        .post('/internal/index-photo')
        .set('Cookie', [otherPhotographerCookie]) // Photographer 2 attempting to index Photographer 1's photo
        .send({ mediaId: photoA1, eventId: eventA });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('do not have permission');
    });

    it('authorizes call with valid X-Internal-Service-Key header', async () => {
      const config = getConfig();

      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 1,
        faces: [{
          faceIndex: 0,
          boxX: 0.2, boxY: 0.2, boxW: 0.2, boxH: 0.2,
          confidence: 0.95,
          modelName: 'SFace', modelVersion: 'v1',
          embedding: Array.from({ length: 128 }, () => 1 / Math.sqrt(128)),
        }],
      });

      const res = await request(app)
        .post('/internal/index-photo')
        .set('X-Internal-Service-Key', config.authSecret)
        .send({ mediaId: photoA1, eventId: eventA, sync: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.facesDetected).toBe(1);
    });

    it('rejects indexing if media item is a video instead of a photograph', async () => {
      const res = await request(app)
        .post('/internal/index-photo')
        .set('Cookie', [photographerCookie])
        .send({ mediaId: videoA1, eventId: eventA, sync: true });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('not photo');
    });

    it('rejects invalid UUID formats gracefully', async () => {
      const res = await request(app)
        .post('/internal/index-photo')
        .set('Cookie', [photographerCookie])
        .send({ mediaId: 'not-a-uuid', eventId: eventA });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Synchronous Photo Face Indexing Execution', () => {
    it('indexes a single-face photo and records 128-D vector embedding', async () => {
      const unitVector = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1));
      const norm = Math.sqrt(unitVector.reduce((acc, v) => acc + v * v, 0));
      const normalizedVector = unitVector.map((v) => v / norm);

      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 1,
        faces: [{
          faceIndex: 0,
          boxX: 0.3,
          boxY: 0.25,
          boxW: 0.25,
          boxH: 0.35,
          confidence: 0.965,
          modelName: 'SFace',
          modelVersion: 'v1',
          embedding: normalizedVector,
        }],
      });

      const res = await request(app)
        .post('/internal/index-photo')
        .set('Cookie', [photographerCookie])
        .send({ mediaId: photoA1, eventId: eventA, sync: true });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.facesDetected).toBe(1);
      expect(res.body.data.embeddingsCount).toBe(1);

      // Verify PostgreSQL face_embeddings table
      const rows = db.public.many(
        `SELECT id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, model_name, model_version
         FROM face_embeddings WHERE photo_id = '${photoA1}'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].event_id).toBe(eventA);
      expect(rows[0].model_name).toBe('SFace');
      expect(rows[0].model_version).toBe('v1');
      expect(rows[0].confidence).toBeCloseTo(0.965, 2);

      // Verify media.faces_detected counter updated
      const mediaRow = db.public.one(`SELECT faces_detected FROM media WHERE id = '${photoA1}'`);
      expect(mediaRow.faces_detected).toBe(1);
    });

    it('indexes multi-face group photo and stores separate embeddings for each face', async () => {
      const vec = Array.from({ length: 128 }, () => 1 / Math.sqrt(128));

      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 3,
        faces: [
          { faceIndex: 0, boxX: 0.1, boxY: 0.2, boxW: 0.15, boxH: 0.2, confidence: 0.94, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
          { faceIndex: 1, boxX: 0.4, boxY: 0.22, boxW: 0.16, boxH: 0.21, confidence: 0.91, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
          { faceIndex: 2, boxX: 0.7, boxY: 0.19, boxW: 0.14, boxH: 0.19, confidence: 0.95, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
        ],
      });

      const res = await request(app)
        .post('/internal/index-photo')
        .set('Cookie', [photographerCookie])
        .send({ mediaId: photoA2, eventId: eventA, sync: true });

      expect(res.status).toBe(200);
      expect(res.body.data.facesDetected).toBe(3);
      expect(res.body.data.embeddingsCount).toBe(3);

      const rows = db.public.many(
        `SELECT face_index, box_x, confidence FROM face_embeddings WHERE photo_id = '${photoA2}' ORDER BY face_index ASC`
      );
      expect(rows).toHaveLength(3);
      expect(rows.map((r: any) => r.face_index)).toEqual([0, 1, 2]);

      const mediaRow = db.public.one(`SELECT faces_detected FROM media WHERE id = '${photoA2}'`);
      expect(mediaRow.faces_detected).toBe(3);
    });

    it('handles zero-face photo gracefully without failing (records 0 faces)', async () => {
      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 0,
        faces: [],
      });

      const res = await request(app)
        .post('/internal/index-photo')
        .set('Cookie', [photographerCookie])
        .send({ mediaId: photoA1, eventId: eventA, sync: true });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.facesDetected).toBe(0);

      const rows = db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${photoA1}'`);
      expect(rows).toHaveLength(0);

      const mediaRow = db.public.one(`SELECT faces_detected FROM media WHERE id = '${photoA1}'`);
      expect(mediaRow.faces_detected).toBe(0);
    });

    it('is idempotent: re-indexing replaces existing face records with zero duplicates', async () => {
      const vec = Array.from({ length: 128 }, () => 1 / Math.sqrt(128));

      // 1st indexing run: 1 face
      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 1,
        faces: [{ faceIndex: 0, boxX: 0.2, boxY: 0.2, boxW: 0.2, boxH: 0.2, confidence: 0.90, modelName: 'SFace', modelVersion: 'v1', embedding: vec }],
      });
      await request(app)
        .post('/internal/index-photo')
        .set('Cookie', [photographerCookie])
        .send({ mediaId: photoA1, eventId: eventA, sync: true });

      let rows = db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${photoA1}'`);
      expect(rows).toHaveLength(1);

      // 2nd indexing run: 2 faces
      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 2,
        faces: [
          { faceIndex: 0, boxX: 0.2, boxY: 0.2, boxW: 0.2, boxH: 0.2, confidence: 0.90, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
          { faceIndex: 1, boxX: 0.5, boxY: 0.2, boxW: 0.2, boxH: 0.2, confidence: 0.88, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
        ],
      });
      await request(app)
        .post('/internal/index-photo')
        .set('Cookie', [photographerCookie])
        .send({ mediaId: photoA1, eventId: eventA, sync: true });

      rows = db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${photoA1}'`);
      expect(rows).toHaveLength(2); // Replaced, NOT 1 + 2 = 3
    });
  });

  describe('Job Status Query & Retry Endpoints', () => {
    it('retrieves processing job status via GET /internal/index-jobs/:jobId', async () => {
      const jobId = '90000000-0000-0000-0000-000000000001';
      db.public.none(
        `INSERT INTO processing_jobs (id, event_id, media_id, type, status, progress, total_items, processed_items)
         VALUES ('${jobId}', '${eventA}', '${photoA1}', 'face_indexing', 'completed', 100, 1, 1)`
      );

      const res = await request(app)
        .get(`/internal/index-jobs/${jobId}`)
        .set('Cookie', [photographerCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(jobId);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.progress).toBe(100);
    });

    it('retries a failed indexing job via POST /internal/index-jobs/:jobId/retry', async () => {
      const jobId = '90000000-0000-0000-0000-000000000002';
      db.public.none(
        `INSERT INTO processing_jobs (id, event_id, media_id, type, status, progress, total_items, error_message)
         VALUES ('${jobId}', '${eventA}', '${photoA1}', 'face_indexing', 'failed', 0, 1, 'Inference timeout')`
      );

      const res = await request(app)
        .post(`/internal/index-jobs/${jobId}/retry`)
        .set('Cookie', [photographerCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.mediaId).toBe(photoA1);

      // Verify database job reset to pending
      const jobRow = db.public.one(`SELECT status, progress, error_message FROM processing_jobs WHERE id = '${jobId}'`);
      expect(jobRow.status).toBe('pending');
      expect(jobRow.progress).toBe(0);
      expect(jobRow.error_message).toBeNull();
    });
  });

  describe('Cascade Lifecycle: Photo and Event Deletions', () => {
    it('deleting a photo automatically cascades and purges its face embeddings', () => {
      const vec = Array.from({ length: 128 }, () => 1 / Math.sqrt(128));
      db.public.none(
        `INSERT INTO face_embeddings (id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, embedding)
         VALUES ('f0000000-0000-0000-0000-000000000001', '${eventA}', '${photoA1}', 0, 0.2, 0.2, 0.2, 0.2, 0.9, '[${vec.join(',')}]')`
      );

      expect(db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${photoA1}'`)).toHaveLength(1);

      // Delete media row
      db.public.none(`DELETE FROM media WHERE id = '${photoA1}'`);

      // Verify face_embeddings row was automatically purged via ON DELETE CASCADE
      expect(db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${photoA1}'`)).toHaveLength(0);
    });

    it('deleting an event automatically cascades and purges all its face embeddings', () => {
      const vec = Array.from({ length: 128 }, () => 1 / Math.sqrt(128));
      db.public.none(
        `INSERT INTO face_embeddings (id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, embedding)
         VALUES ('f0000000-0000-0000-0000-000000000002', '${eventA}', '${photoA2}', 0, 0.3, 0.3, 0.3, 0.3, 0.95, '[${vec.join(',')}]')`
      );

      expect(db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventA}'`)).toHaveLength(1);

      // Delete event row
      db.public.none(`DELETE FROM events WHERE id = '${eventA}'`);

      // Verify embeddings are purged
      expect(db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventA}'`)).toHaveLength(0);
    });
  });
});
