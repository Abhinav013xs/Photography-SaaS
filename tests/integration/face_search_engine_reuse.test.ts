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
import * as database from '../../apps/api/src/infrastructure/database.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import * as aiClient from '../../apps/api/src/infrastructure/aiClient.js';
import * as faceIndexingService from '../../apps/api/src/services/faceIndexingService.js';
import { searchEventPhotosBySelfie } from '../../apps/api/src/services/faceSearchService.js';
import { createApp } from '../../apps/api/src/app.js';
import { resetSearchRateLimiter } from '../../apps/api/src/middleware/searchRateLimiter.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { getConfig } from '@photography-saas/config';

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

describe('Reusable Face Search Engine Integration Tests', () => {
  let db: IMemoryDb;
  let app: any;

  const eventA = 'a0000000-0000-0000-0000-000000000001';
  const eventB = 'b0000000-0000-0000-0000-000000000002';

  // 10 photos in Event A
  const photoIdsA = Array.from({ length: 10 }, (_, i) => `10000000-0000-0000-0000-00000000000${i}`);
  // 1 photo in Event B
  const photoB1 = '20000000-0000-0000-0000-0000000000b1';

  // Benchmark vectors
  const personOneVector = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1));
  const norm1 = Math.sqrt(personOneVector.reduce((s, v) => s + v * v, 0));
  const normPersonOne = personOneVector.map((v) => v / norm1);

  const personTwoVector = Array.from({ length: 128 }, (_, i) => Math.cos(i + 1));
  const norm2 = Math.sqrt(personTwoVector.reduce((s, v) => s + v * v, 0));
  const normPersonTwo = personTwoVector.map((v) => v / norm2);

  let validJpegSelfie: Buffer;

  beforeEach(async () => {
    resetSearchRateLimiter();
    db = createTestDatabase();
    insertTestPhotographer(db, { id: 1 });

    insertTestEvent(db, { id: eventA, owner_id: 1, slug: 'wedding-event-a', name: 'Wedding A', face_search_enabled: true });
    insertTestEvent(db, { id: eventB, owner_id: 1, slug: 'corporate-event-b', name: 'Corporate B', face_search_enabled: true });

    // Seed 10 photos in Event A
    for (let i = 0; i < 10; i++) {
      insertTestMedia(db, {
        id: photoIdsA[i],
        event_id: eventA,
        filename: `event_a_photo_${i}.jpg`,
        type: 'photo',
        status: 'ready',
      });
    }

    // Seed 1 photo in Event B
    insertTestMedia(db, {
      id: photoB1,
      event_id: eventB,
      filename: 'event_b_photo_1.jpg',
      type: 'photo',
      status: 'ready',
    });

    // Populate persistent embeddings in Event A:
    // Photo 0: Person One (Solo)
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000000',
      event_id: eventA,
      photo_id: photoIdsA[0],
      face_index: 0,
      confidence: 0.98,
      embedding: `[${normPersonOne.join(',')}]`,
    });

    // Photo 1: Multi-face group photo with Person One and Person Two
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000001',
      event_id: eventA,
      photo_id: photoIdsA[1],
      face_index: 0,
      confidence: 0.95,
      embedding: `[${normPersonOne.join(',')}]`,
    });
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000002',
      event_id: eventA,
      photo_id: photoIdsA[1],
      face_index: 1,
      confidence: 0.92,
      embedding: `[${normPersonTwo.join(',')}]`,
    });

    // Photo 2: Person Two (Solo)
    insertTestFaceEmbedding(db, {
      id: 'f0000000-0000-0000-0000-000000000003',
      event_id: eventA,
      photo_id: photoIdsA[2],
      face_index: 0,
      confidence: 0.97,
      embedding: `[${normPersonTwo.join(',')}]`,
    });

    // Photos 3 to 9: other distinct faces
    for (let i = 3; i < 10; i++) {
      const otherVec = Array.from({ length: 128 }, (_, j) => (j % (i + 1) === 0 ? 1 : -0.5));
      const oNorm = Math.sqrt(otherVec.reduce((s, v) => s + v * v, 0));
      const normOther = otherVec.map((v) => v / oNorm);
      insertTestFaceEmbedding(db, {
        id: `f0000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
        event_id: eventA,
        photo_id: photoIdsA[i],
        face_index: 0,
        confidence: 0.90,
        embedding: `[${normOther.join(',')}]`,
      });
    }

    // Event B Photo B1 has Person One (used to test cross-event protection)
    insertTestFaceEmbedding(db, {
      id: 'fb000000-0000-0000-0000-000000000001',
      event_id: eventB,
      photo_id: photoB1,
      face_index: 0,
      confidence: 0.96,
      embedding: `[${normPersonOne.join(',')}]`,
    });

    // Mock pgvector cosine distance calculation
    const realPool = new (db.adapters.createPg().Pool)();
    const origQuery = realPool.query.bind(realPool);

    realPool.query = async function (text: any, params?: any[]) {
      const sql = typeof text === 'string' ? text : text?.text || '';

      if (sql.includes('fe.embedding <=> $1::vector')) {
        const queryVecStr = params![0] as string;
        const targetEventId = params![1] as string;
        const threshold = params![2] as number;
        const limit = params![3] as number | undefined;
        const offset = params![4] as number | undefined;

        const queryVector = JSON.parse(queryVecStr) as number[];

        const rawRows = db.public.many(
          `SELECT fe.photo_id AS media_id, fe.embedding, m.filename, m.width, m.height,
                  m.storage_key_preview, m.storage_key_thumbnail, m.created_at, m.status, m.event_id
           FROM face_embeddings fe
           JOIN media m ON m.id = fe.photo_id
           WHERE fe.event_id = '${targetEventId}'
             AND m.event_id = '${targetEventId}'
             AND m.status = 'ready'`
        );

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
        width: 320,
        height: 320,
        channels: 3,
        background: { r: 200, g: 150, b: 130 },
      },
    })
      .jpeg()
      .toBuffer();

    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDatabasePool(null);
  });

  it('CORE PRINCIPLE: Executes repeated guest searches reusing stored embeddings without re-indexing any photo', async () => {
    const indexPhotoSpy = vi.spyOn(faceIndexingService, 'indexPhotoFaces');

    // AI microservice returns Person One's query embedding
    vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
      status: 'success',
      face: {
        confidence: 0.99,
        boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
        modelName: 'SFace', modelVersion: 'v1',
        embedding: normPersonOne,
      },
    });

    const initialEmbeddingCount = db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventA}'`).length;
    expect(initialEmbeddingCount).toBe(11); // 1 (photo0) + 2 (photo1) + 1 (photo2) + 7 (photos 3-9)

    // Execute 5 repeated guest searches
    for (let searchIdx = 0; searchIdx < 5; searchIdx++) {
      const result = await searchEventPhotosBySelfie(eventA, validJpegSelfie);

      expect(result.status).toBe('completed');
      expect(result.results.length).toBe(2); // Photo 0 (solo) and Photo 1 (group)
      expect(result.results[0].mediaId).toBe(photoIdsA[0]);
      expect(result.results[1].mediaId).toBe(photoIdsA[1]);

      // Verify rank and scores
      expect(result.results[0].matchRank).toBe(1);
      expect(result.results[0].cosineDistance).toBeCloseTo(0.0, 2);
      expect(result.results[0].matchScore).toBeCloseTo(1.0, 2);
    }

    // Inviolable guarantee: indexPhotoFaces was NEVER called during searches!
    expect(indexPhotoSpy).not.toHaveBeenCalled();

    // Verify embedding table size did not grow (zero guest query vector retention)
    const finalEmbeddingCount = db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventA}'`).length;
    expect(finalEmbeddingCount).toBe(initialEmbeddingCount);
  });

  it('group photo matching: matches candidate face and returns the complete group photo once', async () => {
    // Search for Person Two
    vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
      status: 'success',
      face: {
        confidence: 0.98,
        boxX: 0.25, boxY: 0.25, boxW: 0.35, boxH: 0.35,
        modelName: 'SFace', modelVersion: 'v1',
        embedding: normPersonTwo,
      },
    });

    const result = await searchEventPhotosBySelfie(eventA, validJpegSelfie);

    expect(result.status).toBe('completed');
    expect(result.pagination.total).toBe(2); // Photo 1 (group) and Photo 2 (solo)

    const returnedIds = result.results.map((r) => r.mediaId);
    expect(returnedIds).toContain(photoIdsA[1]); // Group photo
    expect(returnedIds).toContain(photoIdsA[2]); // Solo photo
    expect(returnedIds).not.toContain(photoIdsA[0]); // Person One's solo photo excluded

    // Deduplication check: Photo 1 appears exactly ONCE in results
    const photo1Occurrences = result.results.filter((r) => r.mediaId === photoIdsA[1]);
    expect(photo1Occurrences).toHaveLength(1);
  });

  it('strictly isolates event queries: Event A searches NEVER return Event B photos', async () => {
    vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
      status: 'success',
      face: {
        confidence: 0.99,
        boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
        modelName: 'SFace', modelVersion: 'v1',
        embedding: normPersonOne,
      },
    });

    // Person One is present in Event A (Photos 0 and 1) AND Event B (Photo B1)
    const resA = await searchEventPhotosBySelfie(eventA, validJpegSelfie);
    const mediaIdsA = resA.results.map((r) => r.mediaId);
    expect(mediaIdsA).not.toContain(photoB1); // Zero cross-event leakage!

    const resB = await searchEventPhotosBySelfie(eventB, validJpegSelfie);
    const mediaIdsB = resB.results.map((r) => r.mediaId);
    expect(mediaIdsB).toContain(photoB1);
    expect(mediaIdsB).not.toContain(photoIdsA[0]);
    expect(mediaIdsB).not.toContain(photoIdsA[1]);
  });

  it('slug-based guest face search endpoint: POST /api/guest/face-search/:slug', async () => {
    const photographerCookie = `${SESSION_COOKIE_NAME}=${signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' })}`;

    vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
      status: 'success',
      face: {
        confidence: 0.97,
        boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
        modelName: 'SFace', modelVersion: 'v1',
        embedding: normPersonOne,
      },
    });

    const res = await request(app)
      .post('/api/guest/face-search/wedding-event-a')
      .set('Cookie', [photographerCookie])
      .send({
        image: `data:image/jpeg;base64,${validJpegSelfie.toString('base64')}`,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results.length).toBe(2);
  });

  it('verifies readiness probe: GET /ready reports database and AI service readiness', async () => {
    vi.spyOn(database, 'checkDatabaseHealth').mockResolvedValue({
      status: 'healthy',
      latencyMs: 3,
      details: { pgvectorInstalled: true },
    });

    vi.spyOn(aiClient, 'checkAiServiceReady').mockResolvedValue({
      status: 'healthy',
      latencyMs: 12,
      details: {
        modelsLoaded: true,
        detector: { name: 'YuNet', version: '2023mar' },
        recognizer: { name: 'SFace', version: 'v1', embeddingDimension: 128 },
      },
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.aiService.status).toBe('healthy');
  });

  it('handles multiple concurrent simultaneous searches safely without state corruption', async () => {
    vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
      status: 'success',
      face: {
        confidence: 0.98,
        boxX: 0.3, boxY: 0.3, boxW: 0.4, boxH: 0.4,
        modelName: 'SFace', modelVersion: 'v1',
        embedding: normPersonOne,
      },
    });

    // Fire 6 concurrent searches
    const promises = Array.from({ length: 6 }, () =>
      searchEventPhotosBySelfie(eventA, validJpegSelfie)
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.status).toBe('completed');
      expect(r.results).toHaveLength(2);
    }
  });
});
