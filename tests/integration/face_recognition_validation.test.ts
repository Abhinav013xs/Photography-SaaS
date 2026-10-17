import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import {
  searchEventPhotosBySelfie,
  validateQueryEmbeddingVector,
  DEFAULT_COSINE_DISTANCE_THRESHOLD,
} from '../../apps/api/src/services/faceSearchService.js';
import { createApp } from '../../apps/api/src/app.js';
import { resetSearchRateLimiter } from '../../apps/api/src/middleware/searchRateLimiter.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { getConfig } from '@photography-saas/config';
import {
  ValidationError,
  ConflictError,
  GalleryExpiredError,
  FaceSearchDisabledError,
} from '@photography-saas/errors';

describe('Phase 34: Face Recognition Accuracy, Event Isolation & Biometric Privacy Validation Tests', () => {
  let db: IMemoryDb;

  const eventA = 'a0000000-0000-0000-0000-000000000001';
  const eventB = 'b0000000-0000-0000-0000-000000000002';
  const privateEventC = 'c0000000-0000-0000-0000-000000000003';
  const pinEventD = 'd0000000-0000-0000-0000-000000000004';

  const photoA1 = '10000000-0000-0000-0000-0000000000a1'; // Person 1 solo
  const photoA2 = '10000000-0000-0000-0000-0000000000a2'; // Group photo (Person 1 + Person 2)
  const photoA3 = '10000000-0000-0000-0000-0000000000a3'; // Other person solo
  const photoA_unready = '10000000-0000-0000-0000-0000000000a4'; // Person 1 photo but status = 'processing'
  const photoB1 = '20000000-0000-0000-0000-0000000000b1'; // Event B photo with Person 1

  // Normalized 128-D vectors
  const personOneRaw = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1));
  const norm1 = Math.sqrt(personOneRaw.reduce((s, v) => s + v * v, 0));
  const normPersonOne = personOneRaw.map((v) => v / norm1);

  const personTwoRaw = Array.from({ length: 128 }, (_, i) => Math.cos(i + 1));
  const norm2 = Math.sqrt(personTwoRaw.reduce((s, v) => s + v * v, 0));
  const normPersonTwo = personTwoRaw.map((v) => v / norm2);

  let validJpegSelfie: Buffer;

  beforeEach(async () => {
    resetSearchRateLimiter();
    db = createTestDatabase();
    insertTestPhotographer(db, { id: 1 });

    // Events
    insertTestEvent(db, {
      id: eventA,
      owner_id: 1,
      slug: 'event-a',
      name: 'Event A Public',
      status: 'active',
      visibility: 'public',
      face_search_enabled: true,
      pin_enabled: false,
    });

    insertTestEvent(db, {
      id: eventB,
      owner_id: 1,
      slug: 'event-b',
      name: 'Event B Public',
      status: 'active',
      visibility: 'public',
      face_search_enabled: true,
      pin_enabled: false,
    });

    insertTestEvent(db, {
      id: privateEventC,
      owner_id: 1,
      slug: 'event-c-private',
      name: 'Event C Private',
      status: 'active',
      visibility: 'private',
      face_search_enabled: true,
      pin_enabled: false,
    });

    insertTestEvent(db, {
      id: pinEventD,
      owner_id: 1,
      slug: 'event-d-pin',
      name: 'Event D PIN Protected',
      status: 'active',
      visibility: 'public',
      face_search_enabled: true,
      pin_enabled: true,
      pin_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr',
    });

    // Media
    insertTestMedia(db, { id: photoA1, event_id: eventA, filename: 'person1_solo.jpg', type: 'photo', status: 'ready' });
    insertTestMedia(db, { id: photoA2, event_id: eventA, filename: 'group_celebration.jpg', type: 'photo', status: 'ready' });
    insertTestMedia(db, { id: photoA3, event_id: eventA, filename: 'unrelated_guest.jpg', type: 'photo', status: 'ready' });
    insertTestMedia(db, { id: photoA_unready, event_id: eventA, filename: 'processing.jpg', type: 'photo', status: 'processing' });
    insertTestMedia(db, { id: photoB1, event_id: eventB, filename: 'event_b_person1.jpg', type: 'photo', status: 'ready' });

    // Face Embeddings
    // photoA1 has Person 1
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000001',
      event_id: eventA,
      photo_id: photoA1,
      face_index: 0,
      confidence: 0.97,
      embedding: `[${normPersonOne.join(',')}]`,
    });

    // photoA2 has Person 1 (index 0) and Person 2 (index 1)
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000002',
      event_id: eventA,
      photo_id: photoA2,
      face_index: 0,
      confidence: 0.95,
      embedding: `[${normPersonOne.join(',')}]`,
    });
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000003',
      event_id: eventA,
      photo_id: photoA2,
      face_index: 1,
      confidence: 0.93,
      embedding: `[${normPersonTwo.join(',')}]`,
    });

    // photoA_unready has Person 1 but status is 'processing'
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000004',
      event_id: eventA,
      photo_id: photoA_unready,
      face_index: 0,
      confidence: 0.96,
      embedding: `[${normPersonOne.join(',')}]`,
    });

    // photoB1 (Event B) has Person 1
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000005',
      event_id: eventB,
      photo_id: photoB1,
      face_index: 0,
      confidence: 0.98,
      embedding: `[${normPersonOne.join(',')}]`,
    });

    // Setup Mock Pg Pool with pgvector simulation for in-memory testing
    const realPool = new (db.adapters.createPg().Pool)();
    const origQuery = realPool.query.bind(realPool);

    function calcCosineDist(v1: number[], v2: number[]): number {
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
          const dist = calcCosineDist(queryVector, emb);

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

    validJpegSelfie = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: { r: 120, g: 140, b: 180 },
      },
    })
      .jpeg()
      .toBuffer();
  });

  // =================================================================
  // 1. EMBEDDING INTEGRITY & NUMERIC VALIDATION
  // =================================================================
  describe('1. Embedding Numeric & Dimensionality Validation', () => {
    it('validates standard 128-D unit-normalized vectors without error', () => {
      expect(() => validateQueryEmbeddingVector(normPersonOne)).not.toThrow();
    });

    it('rejects vectors with length != 128', () => {
      expect(() => validateQueryEmbeddingVector([0.1, 0.2])).toThrow(ValidationError);
      expect(() => validateQueryEmbeddingVector(new Array(512).fill(0.01))).toThrow(ValidationError);
    });

    it('rejects vectors containing NaN or Infinity', () => {
      const nanVec = [...normPersonOne];
      nanVec[10] = NaN;
      expect(() => validateQueryEmbeddingVector(nanVec)).toThrow(ValidationError);

      const infVec = [...normPersonOne];
      infVec[5] = Infinity;
      expect(() => validateQueryEmbeddingVector(infVec)).toThrow(ValidationError);
    });

    it('rejects unnormalized vectors (norm far from 1.0)', () => {
      const zeroVec = new Array(128).fill(0);
      expect(() => validateQueryEmbeddingVector(zeroVec)).toThrow(ValidationError);

      const hugeVec = normPersonOne.map((v) => v * 5.0);
      expect(() => validateQueryEmbeddingVector(hugeVec)).toThrow(ValidationError);
    });
  });

  // =================================================================
  // 2. EVENT ISOLATION & ACCURACY
  // =================================================================
  describe('2. Strict Event Isolation & Multi-Face Matching', () => {
    it('guarantees zero cross-event leakage: searching Event A NEVER returns Event B photos', async () => {
      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
          modelName: 'SFace', modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const resA = await searchEventPhotosBySelfie(eventA, validJpegSelfie);
      expect(resA.status).toBe('completed');
      expect(resA.results.length).toBe(2);

      const returnedMediaIds = resA.results.map((r) => r.mediaId);
      expect(returnedMediaIds).toContain(photoA1);
      expect(returnedMediaIds).toContain(photoA2);
      expect(returnedMediaIds).not.toContain(photoB1); // Strict isolation!
    });

    it('deduplicates multi-face group photos so each photo appears at most once', async () => {
      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
          modelName: 'SFace', modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const res = await searchEventPhotosBySelfie(eventA, validJpegSelfie);
      const photoA2Occurrences = res.results.filter((r) => r.mediaId === photoA2);
      expect(photoA2Occurrences).toHaveLength(1);
    });

    it('excludes photos whose status is not ready (e.g. processing or failed)', async () => {
      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
          modelName: 'SFace', modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const res = await searchEventPhotosBySelfie(eventA, validJpegSelfie);
      const mediaIds = res.results.map((r) => r.mediaId);
      expect(mediaIds).not.toContain(photoA_unready);
    });

    it('enforces calibrated threshold: excludes candidates exceeding cosine distance threshold', async () => {
      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
          modelName: 'SFace', modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      // Strict threshold of 0.01: only identical embeddings match
      const strictRes = await searchEventPhotosBySelfie(eventA, validJpegSelfie, { threshold: 0.01 });
      expect(strictRes.results.every((r) => r.cosineDistance <= 0.01)).toBe(true);
    });
  });

  // =================================================================
  // 3. LIFECYCLE BOUNDARIES & PRIVACY
  // =================================================================
  describe('3. Lifecycle Expiry, Privacy & Boundary Defense', () => {
    it('blocks search on private gallery with AuthorizationError (HTTP 403)', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/guest/face-search/event-c-private')
        .send({
          image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('private');
    });

    it('blocks search on expired gallery with GalleryExpiredError (HTTP 410)', async () => {
      const expiredEvent = 'e0000000-0000-0000-0000-00000000000e';
      insertTestEvent(db, {
        id: expiredEvent,
        slug: 'expired-gallery',
        status: 'active',
        visibility: 'public',
        public_until: new Date(Date.now() - 3600000).toISOString(),
        face_search_enabled: true,
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/guest/face-search/expired-gallery')
        .send({
          image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
        });

      expect(res.status).toBe(410);
      expect(res.body.error.message).toContain('expired');
    });

    it('blocks search on PIN-protected gallery when guest token is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/guest/face-search/event-d-pin')
        .send({
          image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('PIN required');
    });

    it('authorizes guest search on public gallery without PIN via slug route', async () => {
      const app = createApp();

      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
          modelName: 'SFace', modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const res = await request(app)
        .post('/api/guest/face-search/event-a')
        .send({
          image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results.length).toBe(2);
    });

    it('supports raw image binary buffer with image/jpeg Content-Type', async () => {
      const app = createApp();

      vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
        status: 'success',
        face: {
          confidence: 0.98,
          boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
          modelName: 'SFace', modelVersion: 'v1',
          embedding: normPersonOne,
        },
      });

      const res = await request(app)
        .post('/api/guest/face-search/event-a')
        .set('Content-Type', 'image/jpeg')
        .send(validJpegSelfie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results.length).toBe(2);
    });

    it('enforces face_search_enabled flag: rejects when face search is disabled', async () => {
      const disabledEvent = 'f0000000-0000-0000-0000-00000000000f';
      insertTestEvent(db, {
        id: disabledEvent,
        slug: 'disabled-search-gallery',
        status: 'active',
        visibility: 'public',
        face_search_enabled: false,
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/guest/face-search/disabled-search-gallery')
        .send({
          image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('disabled');
    });
  });
});
