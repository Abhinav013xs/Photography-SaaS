import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { IMemoryDb } from 'pg-mem';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import sharp from 'sharp';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
  insertTestFaceEmbedding,
} from '../helpers/db_test_helper.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import * as aiClient from '../../apps/api/src/infrastructure/aiClient.js';
import { searchEventPhotosBySelfie } from '../../apps/api/src/services/faceSearchService.js';
import { createApp } from '../../apps/api/src/app.js';
import { resetSearchRateLimiter } from '../../apps/api/src/middleware/searchRateLimiter.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { getConfig } from '@photography-saas/config';
import {
  FaceSearchDisabledError,
  ConflictError,
  FaceSearchRateLimitError,
} from '@photography-saas/errors';

function calculateCosineDistance(v1: number[], v2: number[]): number {
  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    norm1 += v1[i] * v1[i];
    norm2 += v2[i] * v2[i];
  }
  const denom = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (denom === 0) return 1.0;
  return Math.max(0, Math.min(2, 1 - dot / denom));
}

describe('Phase 16: AI Face Search & Photo Matching Integration Tests', () => {
  let db: IMemoryDb;

  const eventA = 'a0000000-0000-0000-0000-000000000001';
  const eventB = 'b0000000-0000-0000-0000-000000000002';
  const photoA1 = '10000000-0000-0000-0000-0000000000a1'; // Solo photo
  const photoA2 = '10000000-0000-0000-0000-0000000000a2'; // Group photo
  const photoA3 = '10000000-0000-0000-0000-0000000000a3'; // Non-matching photo
  const photoB1 = '20000000-0000-0000-0000-0000000000b1'; // Event B matching photo

  // Base vectors
  const personOneVector = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1));
  const norm1 = Math.sqrt(personOneVector.reduce((s, v) => s + v * v, 0));
  const normPersonOne = personOneVector.map((v) => v / norm1);

  const personTwoVector = Array.from({ length: 128 }, (_, i) => Math.cos(i + 1));
  const norm2 = Math.sqrt(personTwoVector.reduce((s, v) => s + v * v, 0));
  const normPersonTwo = personTwoVector.map((v) => v / norm2);

  // Non-matching person orthogonal vector
  const orthogonalVector = Array.from({ length: 128 }, (_, i) => (i % 2 === 0 ? 1 : -1));
  const norm3 = Math.sqrt(orthogonalVector.reduce((s, v) => s + v * v, 0));
  const normOrthogonal = orthogonalVector.map((v) => v / norm3);

  let validJpegSelfie: Buffer;

  beforeEach(async () => {
    resetSearchRateLimiter();
    db = createTestDatabase();
    insertTestPhotographer(db, { id: 1 });

    insertTestEvent(db, { id: eventA, owner_id: 1, slug: 'event-a', name: 'Wedding A', face_search_enabled: true });
    insertTestEvent(db, { id: eventB, owner_id: 1, slug: 'event-b', name: 'Wedding B', face_search_enabled: true });

    // Insert Media records
    insertTestMedia(db, { id: photoA1, event_id: eventA, filename: 'solo_person1.jpg', type: 'photo', status: 'ready' });
    insertTestMedia(db, { id: photoA2, event_id: eventA, filename: 'group_photo.jpg', type: 'photo', status: 'ready' });
    insertTestMedia(db, { id: photoA3, event_id: eventA, filename: 'solo_other.jpg', type: 'photo', status: 'ready' });
    insertTestMedia(db, { id: photoB1, event_id: eventB, filename: 'event_b_photo.jpg', type: 'photo', status: 'ready' });

    // Insert Face Embeddings
    // 1. photoA1 has Person One
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000001',
      event_id: eventA,
      photo_id: photoA1,
      face_index: 0,
      confidence: 0.96,
      embedding: `[${normPersonOne.join(',')}]`,
    });

    // 2. photoA2 (Group photo) has Person One and Person Two
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000002',
      event_id: eventA,
      photo_id: photoA2,
      face_index: 0,
      confidence: 0.94,
      embedding: `[${normPersonOne.join(',')}]`,
    });
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000003',
      event_id: eventA,
      photo_id: photoA2,
      face_index: 1,
      confidence: 0.92,
      embedding: `[${normPersonTwo.join(',')}]`,
    });

    // 3. photoA3 has non-matching orthogonal face
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000004',
      event_id: eventA,
      photo_id: photoA3,
      face_index: 0,
      confidence: 0.90,
      embedding: `[${normOrthogonal.join(',')}]`,
    });

    // 4. photoB1 in Event B has Person One (used to test cross-event isolation)
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000005',
      event_id: eventB,
      photo_id: photoB1,
      face_index: 0,
      confidence: 0.95,
      embedding: `[${normPersonOne.join(',')}]`,
    });

    // Setup Mock Pg Pool with pgvector simulation for in-memory testing
    const realPool = new (db.adapters.createPg().Pool)();
    const origQuery = realPool.query.bind(realPool);

    realPool.query = async function (text: any, params?: any[]) {
      const sql = typeof text === 'string' ? text : text?.text || '';

      // Intercept pgvector search query
      if (sql.includes('fe.embedding <=> $1::vector')) {
        const queryVecStr = params![0] as string;
        const targetEventId = params![1] as string;
        const threshold = params![2] as number;
        const limit = params![3] as number | undefined;
        const offset = params![4] as number | undefined;

        const queryVector = JSON.parse(queryVecStr) as number[];

        // Retrieve raw embeddings for this event from in-memory DB
        const rawRows = db.public.many(
          `SELECT fe.photo_id AS media_id, fe.embedding, m.filename, m.width, m.height,
                  m.storage_key_preview, m.storage_key_thumbnail, m.created_at, m.status, m.event_id
           FROM face_embeddings fe
           JOIN media m ON m.id = fe.photo_id
           WHERE fe.event_id = '${targetEventId}'
             AND m.event_id = '${targetEventId}'
             AND m.status = 'ready'`
        );

        // Group by media_id and compute min distance
        const photoMap = new Map<string, { row: any; minDistance: number }>();

        for (const r of rawRows) {
          const emb = JSON.parse(r.embedding) as number[];
          const dist = calculateCosineDistance(queryVector, emb);

          if (dist <= threshold) {
            const existing = photoMap.get(r.media_id);
            if (!existing || dist < existing.minDistance) {
              photoMap.set(r.media_id, { row: r, minDistance: dist });
            }
          }
        }

        const sortedCandidates = Array.from(photoMap.values()).sort(
          (a, b) => a.minDistance - b.minDistance
        );

        if (sql.includes('COUNT(DISTINCT m.id)')) {
          return { rows: [{ total_count: sortedCandidates.length }] };
        }

        // Apply pagination
        const pOffset = offset ?? 0;
        const pLimit = limit ?? 20;
        const paged = sortedCandidates.slice(pOffset, pOffset + pLimit);

        const rows = paged.map((c) => ({
          media_id: c.row.media_id,
          filename: c.row.filename,
          width: c.row.width,
          height: c.row.height,
          storage_key_preview: c.row.storage_key_preview,
          storage_key_thumbnail: c.row.storage_key_thumbnail,
          created_at: new Date(c.row.created_at),
          min_distance: c.minDistance,
        }));

        return { rows };
      }

      return origQuery(text, params);
    };

    setDatabasePool(realPool);

    // Create a real valid JPEG test buffer for selfie inputs
    validJpegSelfie = await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 3,
        background: { r: 180, g: 140, b: 120 },
      },
    })
      .jpeg()
      .toBuffer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDatabasePool(null);
  });

  describe('Service Core (searchEventPhotosBySelfie)', () => {
    it('retrieves solo and group photos containing the matching face', async () => {
      // Mock AI microservice returning Person One embedding
      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3,
          boxY: 0.3,
          boxW: 0.4,
          boxH: 0.4,
          modelName: 'SFace',
          modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const response = await searchEventPhotosBySelfie(eventA, validJpegSelfie);

      expect(response.status).toBe('completed');
      expect(response.pagination.total).toBe(2); // photoA1 (solo) and photoA2 (group)
      expect(response.results).toHaveLength(2);

      const returnedMediaIds = response.results.map((r) => r.mediaId);
      expect(returnedMediaIds).toContain(photoA1);
      expect(returnedMediaIds).toContain(photoA2);
      expect(returnedMediaIds).not.toContain(photoA3); // Non-matching person excluded

      // Verify rank and scores
      expect(response.results[0].matchRank).toBe(1);
      expect(response.results[0].matchScore).toBeCloseTo(1.0, 2);
      expect(response.results[0].cosineDistance).toBeCloseTo(0.0, 2);
    });

    it('deduplicates multi-face group photographs so each photo appears at most once', async () => {
      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.95,
          boxX: 0.2,
          boxY: 0.2,
          boxW: 0.3,
          boxH: 0.3,
          modelName: 'SFace',
          modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const response = await searchEventPhotosBySelfie(eventA, validJpegSelfie);

      const photoA2Occurrences = response.results.filter((r) => r.mediaId === photoA2);
      expect(photoA2Occurrences).toHaveLength(1);
    });

    it('excludes candidate faces that exceed the distance threshold', async () => {
      // Query with slightly drifted embedding that has distance ~0.45 from Person One
      const drifted = normPersonOne.map((v, i) => (i < 30 ? v * -1 : v));
      const driftedNorm = Math.sqrt(drifted.reduce((s, v) => s + v * v, 0));
      const normDrifted = drifted.map((v) => v / driftedNorm);

      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.90,
          boxX: 0.2,
          boxY: 0.2,
          boxW: 0.3,
          boxH: 0.3,
          modelName: 'SFace',
          modelVersion: 'v1',
          embedding: normDrifted,
        },
      });

      // Strict threshold of 0.20 excludes the drifted face
      const response = await searchEventPhotosBySelfie(eventA, validJpegSelfie, {
        threshold: 0.20,
      });

      expect(response.status).toBe('no_matches');
      expect(response.results).toHaveLength(0);
      expect(response.pagination.total).toBe(0);
    });

    it('strictly enforces event boundary isolation: Event A search NEVER retrieves Event B photos', async () => {
      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.99,
          boxX: 0.3,
          boxY: 0.3,
          boxW: 0.4,
          boxH: 0.4,
          modelName: 'SFace',
          modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      // Search Event A (which contains Person One)
      const responseA = await searchEventPhotosBySelfie(eventA, validJpegSelfie);

      // Verify none of the results belong to Event B photoB1
      const mediaIdsA = responseA.results.map((r) => r.mediaId);
      expect(mediaIdsA).not.toContain(photoB1);

      // Now search Event B
      const responseB = await searchEventPhotosBySelfie(eventB, validJpegSelfie);
      const mediaIdsB = responseB.results.map((r) => r.mediaId);
      expect(mediaIdsB).toContain(photoB1);
      expect(mediaIdsB).not.toContain(photoA1);
      expect(mediaIdsB).not.toContain(photoA2);
    });

    it('rejects search when face_search_enabled is false on the event', async () => {
      db.public.none(`UPDATE events SET face_search_enabled = FALSE WHERE id = '${eventA}'`);

      await expect(searchEventPhotosBySelfie(eventA, validJpegSelfie)).rejects.toThrow(
        FaceSearchDisabledError
      );
    });

    it('rejects search when event status is deleting', async () => {
      db.public.none(`UPDATE events SET status = 'deleting' WHERE id = '${eventA}'`);

      await expect(searchEventPhotosBySelfie(eventA, validJpegSelfie)).rejects.toThrow(
        ConflictError
      );
    });

    it('never exposes raw embedding vectors in the returned response object', async () => {
      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.95,
          boxX: 0.3,
          boxY: 0.3,
          boxW: 0.3,
          boxH: 0.3,
          modelName: 'SFace',
          modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const response = await searchEventPhotosBySelfie(eventA, validJpegSelfie);
      for (const item of response.results) {
        expect((item as any).embedding).toBeUndefined();
        expect((item as any).vector).toBeUndefined();
      }
    });
  });

  describe('HTTP API & Authorization Integration (POST /api/events/:eventId/face-search)', () => {
    it('rejects unauthenticated request without photographer cookie or guest token', async () => {
      const app = createApp();

      const res = await request(app)
        .post(`/api/events/${eventA}/face-search`)
        .send({
          image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Valid photographer session or event guest access token required');
    });

    it('authorizes authenticated photographer session and executes face search', async () => {
      const app = createApp();
      const sessionToken = signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' });

      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3,
          boxY: 0.3,
          boxW: 0.4,
          boxH: 0.4,
          modelName: 'SFace',
          modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const res = await request(app)
        .post(`/api/events/${eventA}/face-search`)
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${sessionToken}`])
        .send({
          image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.results).toHaveLength(2);
    });

    it('authorizes guest token scoped to the event via X-Guest-Token header', async () => {
      const app = createApp();
      const config = getConfig();

      // Sign a guest token scoped to eventA
      const guestToken = jwt.sign(
        { eventId: eventA, sessionId: 'guest-session-123' },
        config.authSecret,
        { expiresIn: '2h' }
      );

      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3,
          boxY: 0.3,
          boxW: 0.4,
          boxH: 0.4,
          modelName: 'SFace',
          modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const res = await request(app)
        .post(`/api/events/${eventA}/face-search`)
        .set('X-Guest-Token', guestToken)
        .send({
          image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results).toHaveLength(2);
    });

    it('rejects guest token scoped to Event B when attempting to search Event A (cross-event defense)', async () => {
      const app = createApp();
      const config = getConfig();

      // Sign a guest token scoped to eventB
      const guestTokenB = jwt.sign(
        { eventId: eventB, sessionId: 'guest-session-456' },
        config.authSecret,
        { expiresIn: '2h' }
      );

      const res = await request(app)
        .post(`/api/events/${eventA}/face-search`)
        .set('X-Guest-Token', guestTokenB)
        .send({
          image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('enforces rate limiting: exceeding 10 searches in 1 minute triggers HTTP 429 and Retry-After', async () => {
      const app = createApp();
      const sessionToken = signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' });

      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3,
          boxY: 0.3,
          boxW: 0.4,
          boxH: 0.4,
          modelName: 'SFace',
          modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      // Execute 10 successful requests
      for (let i = 0; i < 10; i++) {
        const okRes = await request(app)
          .post(`/api/events/${eventA}/face-search`)
          .set('Cookie', [`${SESSION_COOKIE_NAME}=${sessionToken}`])
          .send({ image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}` });
        expect(okRes.status).toBe(200);
      }

      // 11th request must trigger rate limit 429
      const rateLimitedRes = await request(app)
        .post(`/api/events/${eventA}/face-search`)
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${sessionToken}`])
        .send({ image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}` });

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.headers['retry-after']).toBeDefined();
      expect(rateLimitedRes.body.error.code).toBe('FACE_SEARCH_RATE_LIMITED');
    });
  });
});
