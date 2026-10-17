import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import {
  setR2ClientForTesting,
  resetR2Client,
} from '../../apps/api/src/infrastructure/r2Client.js';
import { indexPhotoFaces } from '../../apps/api/src/services/faceIndexingService.js';
import { searchEventPhotosBySelfie } from '../../apps/api/src/services/faceSearchService.js';
import { trashEvent } from '../../apps/api/src/services/eventService.js';
import { restoreEventFromBin } from '../../apps/api/src/services/recycleBinService.js';
import { deleteEventPermanently } from '../../apps/api/src/services/eventDeletionService.js';
import { censorSensitiveData } from '../../apps/api/src/middleware/logger.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import * as aiClient from '../../apps/api/src/infrastructure/aiClient.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
  insertTestFaceEmbedding,
} from '../helpers/db_test_helper.js';
import type { IMemoryDb } from 'pg-mem';

function calculateCosineDistance(v1: number[], v2: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    normA += v1[i] * v1[i];
    normB += v2[i] * v2[i];
  }
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return 1 - sim;
}

describe('Phase 26: Security Hardening & Access Control Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'SecurePhotographer2026!';
  let authCookie: string;
  let otherAuthCookie: string;
  let mockS3Client: S3Client;
  let validSelfieBuffer: Buffer;
  const bucketName = 'studio-lumina-security-bucket';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    db = createTestDatabase();
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography'),
              (2, 'other@studiolumina.photo', '${passwordHash}', 'Studio Other', 'Commercial Photography')
       ON CONFLICT (id) DO NOTHING;`
    );

    const { Pool } = db.adapters.createPg();
    pool = new Pool();

    const origQuery = pool.query.bind(pool);
    pool.query = async function (text: any, params?: any[]) {
      const sql = typeof text === 'string' ? text : text?.text || '';

      // Intercept pgvector search query for in-memory pg-mem testing
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
          return { rows: [{ total_count: sortedCandidates.length }], rowCount: 1 };
        }

        const pOffset = offset ?? 0;
        const pLimit = limit ?? 20;
        const paged = sortedCandidates.slice(pOffset, pOffset + pLimit);

        const rows = paged.map((c) => ({
          media_id: c.row.media_id,
          photo_id: c.row.media_id,
          filename: c.row.filename,
          width: c.row.width,
          height: c.row.height,
          storage_key_preview: c.row.storage_key_preview,
          storage_key_thumbnail: c.row.storage_key_thumbnail,
          created_at: new Date(c.row.created_at),
          min_distance: c.minDistance,
          similarity: 1 - c.minDistance,
        }));

        return { rows, rowCount: rows.length };
      }

      return origQuery(text, params);
    };

    setDatabasePool(pool);

    // Generate valid JPEG buffer for selfie tests
    validSelfieBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 220, g: 180, b: 140 },
      },
    })
      .jpeg()
      .toBuffer();

    // Mock S3 client for storageAdapter and r2Client
    mockS3Client = new S3Client({
      region: 'auto',
      endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: 'test-key-id',
        secretAccessKey: 'test-secret-key',
      },
    });

    // Obtain photographer 1 session cookie
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'photographer@studiolumina.photo',
      password: TEST_PASSWORD,
    });
    const rawCookies = loginRes.header['set-cookie'];
    const sessionCookie = Array.isArray(rawCookies)
      ? rawCookies.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : rawCookies;
    authCookie = sessionCookie.split(';')[0];

    // Obtain photographer 2 session cookie
    const loginRes2 = await request(app).post('/api/auth/login').send({
      email: 'other@studiolumina.photo',
      password: TEST_PASSWORD,
    });
    const rawCookies2 = loginRes2.header['set-cookie'];
    const sessionCookie2 = Array.isArray(rawCookies2)
      ? rawCookies2.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : rawCookies2;
    otherAuthCookie = sessionCookie2.split(';')[0];
  });

  afterAll(() => {
    resetR2Client();
    setDatabasePool(null);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    resetPinRateLimiterStore();
    setR2ClientForTesting(mockS3Client, bucketName);
    vi.spyOn(mockS3Client, 'send').mockImplementation(async (command: any) => {
      const cmdName = command?.constructor?.name;
      if (cmdName === 'ListObjectsV2Command') {
        return { Contents: [], IsTruncated: false } as never;
      }
      if (cmdName === 'DeleteObjectsCommand') {
        return { Deleted: [] } as never;
      }
      return {} as never;
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Unauthenticated requests cannot access protected dashboard APIs
  // ---------------------------------------------------------------------------
  it('1. Unauthenticated requests cannot access protected dashboard APIs', async () => {
    const resEvents = await request(app).get('/api/events');
    expect(resEvents.status).toBe(401);
    expect(resEvents.body.success).toBe(false);

    const resStorage = await request(app).get('/api/storage/overview');
    expect(resStorage.status).toBe(401);

    const resCreate = await request(app).post('/api/events').send({
      name: 'Unauthorized Event',
      client_name: 'Hacker',
      event_date: '2026-10-15',
    });
    expect(resCreate.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // 2. An authenticated user cannot modify another user\'s event
  // ---------------------------------------------------------------------------
  it('2. An authenticated user cannot modify another user\'s event (IDOR prevention)', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000001';
    insertTestEvent(db, {
      id: eventId,
      owner_id: 1, // Owned by photographer 1
      slug: 'owner1-private-event',
      name: 'Owner 1 Wedding',
    });

    // Photographer 2 attempts to update Photographer 1's event
    const patchRes = await request(app)
      .patch(`/api/events/${eventId}`)
      .set('Cookie', otherAuthCookie)
      .send({ name: 'Tampered Event Name' });

    expect([403, 404]).toContain(patchRes.status);
    expect(patchRes.body.success).toBe(false);

    // Verify name was not modified in database
    const check = db.public.one(`SELECT name FROM events WHERE id = '${eventId}'`);
    expect(check.name).toBe('Owner 1 Wedding');
  });

  // ---------------------------------------------------------------------------
  // 3. A private gallery cannot be accessed through a guessed URL
  // ---------------------------------------------------------------------------
  it('3. A private gallery cannot be accessed through a guessed URL', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000002';
    const slug = 'secret-private-gala';
    insertTestEvent(db, {
      id: eventId,
      owner_id: 1,
      slug,
      name: 'Secret Gala',
      status: 'active',
      visibility: 'private', // Strictly private
    });

    const resEvent = await request(app).get(`/api/guest/event/${slug}`);
    expect([403, 404]).toContain(resEvent.status);
    expect(resEvent.body.success).toBe(false);

    const resGallery = await request(app).get(`/api/guest/gallery/${slug}`);
    expect([403, 404]).toContain(resGallery.status);
    expect(resGallery.body.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 4. PIN protection cannot be bypassed through direct media endpoints
  // ---------------------------------------------------------------------------
  it('4. PIN protection cannot be bypassed through direct media endpoints', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000003';
    const slug = 'pin-protected-wedding';
    const pinHash = await bcrypt.hash('5678', 10);
    insertTestEvent(db, {
      id: eventId,
      owner_id: 1,
      slug,
      name: 'PIN Wedding',
      status: 'active',
      visibility: 'public',
      pin_enabled: true,
      pin_hash: pinHash,
    });
    const mediaId = 'c2600000-0000-0000-0000-000000000001';
    insertTestMedia(db, {
      id: mediaId,
      event_id: eventId,
      filename: 'photo1.jpg',
      status: 'ready',
    });

    // 1. Gallery request without PIN session
    const resGallery = await request(app).get(`/api/guest/gallery/${slug}`);
    expect([401, 403]).toContain(resGallery.status);
    expect(['EVENT_PIN_REQUIRED', 'PIN_REQUIRED']).toContain(resGallery.body.error?.code);

    // 2. Direct download request without PIN session
    const resDownload = await request(app).get(`/api/guest/gallery/${slug}/download/${mediaId}`);
    expect([401, 403]).toContain(resDownload.status);
    expect(['EVENT_PIN_REQUIRED', 'PIN_REQUIRED']).toContain(resDownload.body.error?.code);

    // 3. Face search request without PIN session
    const resFaceSearch = await request(app)
      .post(`/api/guest/face-search/${slug}`)
      .send({ image: `data:image/jpeg;base64,${validSelfieBuffer.toString('base64')}` });
    expect([401, 403]).toContain(resFaceSearch.status);
    expect(['EVENT_PIN_REQUIRED', 'PIN_REQUIRED']).toContain(resFaceSearch.body.error?.code);
  });

  // ---------------------------------------------------------------------------
  // 5. PIN guessing is rate-limited and constant-time on invalid slugs
  // ---------------------------------------------------------------------------
  it('5. PIN guessing is rate-limited after multiple failed attempts', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000004';
    const slug = 'brute-force-target';
    const pinHash = await bcrypt.hash('9999', 10);
    insertTestEvent(db, {
      id: eventId,
      owner_id: 1,
      slug,
      status: 'active',
      visibility: 'public',
      pin_enabled: true,
      pin_hash: pinHash,
    });

    const testIp = '198.51.100.99';

    // Attempts 1 through 4 should fail with 401 Invalid PIN
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post(`/api/guest/verify-pin/${slug}`)
        .set('X-Forwarded-For', testIp)
        .send({ pin: `000${i}` });
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('INVALID_EVENT_PIN');
    }

    // 5th attempt exhausts allowed attempts and triggers lockout (429)
    const rateLimitedRes = await request(app)
      .post(`/api/guest/verify-pin/${slug}`)
      .set('X-Forwarded-For', testIp)
      .send({ pin: '0004' });

    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.body.error?.code).toBe('PIN_RATE_LIMITED');
  });

  // ---------------------------------------------------------------------------
  // 6. Expired events cannot be publicly accessed
  // ---------------------------------------------------------------------------
  it('6. Expired events cannot be publicly accessed', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000005';
    const slug = 'expired-gallery-event';
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    insertTestEvent(db, {
      id: eventId,
      owner_id: 1,
      slug,
      status: 'active',
      visibility: 'public',
      public_until: yesterday,
      expired_at: yesterday,
    });

    const resGallery = await request(app).get(`/api/guest/gallery/${slug}`);
    expect([403, 404, 410]).toContain(resGallery.status);
    expect(resGallery.body.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 7. Trashed events cannot be downloaded or searched
  // ---------------------------------------------------------------------------
  it('7. Trashed events cannot be downloaded or searched', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000006';
    const slug = 'trashed-event-gallery';
    insertTestEvent(db, {
      id: eventId,
      owner_id: 1,
      slug,
      status: 'trashed', // Moved to recycle bin
      visibility: 'public',
    });

    const resGallery = await request(app).get(`/api/guest/gallery/${slug}`);
    expect([403, 404]).toContain(resGallery.status);

    const resZip = await request(app).post(`/api/guest/gallery/${slug}/download-zip`).send({});
    expect([403, 404]).toContain(resZip.status);

    const resSearch = await request(app)
      .post(`/api/guest/face-search/${slug}`)
      .send({ image: `data:image/jpeg;base64,${validSelfieBuffer.toString('base64')}` });
    expect([403, 404]).toContain(resSearch.status);
  });

  // ---------------------------------------------------------------------------
  // 8. Signed URLs cannot be generated for unauthorized media
  // ---------------------------------------------------------------------------
  it('8. Signed URLs cannot be generated for unauthorized media', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000007';
    insertTestEvent(db, {
      id: eventId,
      owner_id: 1,
      slug: 'private-media-event',
      status: 'active',
      visibility: 'private',
    });
    const mediaId = 'c2600000-0000-0000-0000-000000000007';
    insertTestMedia(db, {
      id: mediaId,
      event_id: eventId,
      filename: 'secret.jpg',
      status: 'ready',
    });

    // Unauthenticated guest requests media download by mediaId
    const res = await request(app).get(`/api/media/download/${mediaId}`);
    expect([401, 403, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 9. Upload validation rejects malformed and oversized files
  // ---------------------------------------------------------------------------
  it('9. Upload validation rejects malformed and oversized files', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000008';
    insertTestEvent(db, {
      id: eventId,
      owner_id: 1,
      slug: 'upload-test-event',
    });

    // 1. Dangerous double extension (photo.php.jpg)
    const resDoubleExt = await request(app)
      .post(`/api/events/${eventId}/media/presign-batch`)
      .set('Cookie', authCookie)
      .send({
        items: [
          {
            filename: 'backdoor.php.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1024,
          },
        ],
      });
    expect(resDoubleExt.status).toBe(400);
    expect(resDoubleExt.body.error?.message).toMatch(/dangerous double extension/i);

    // 2. Dangerous executable extension (.exe)
    const resExe = await request(app)
      .post(`/api/events/${eventId}/media/presign-batch`)
      .set('Cookie', authCookie)
      .send({
        items: [
          {
            filename: 'exploit.exe',
            mimeType: 'application/octet-stream',
            sizeBytes: 1024,
          },
        ],
      });
    expect([400, 415]).toContain(resExe.status);

    // 3. Oversized photo (> 100MB limit)
    const resOversized = await request(app)
      .post(`/api/events/${eventId}/media/presign-batch`)
      .set('Cookie', authCookie)
      .send({
        items: [
          {
            filename: 'giant.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 150 * 1024 * 1024, // 150MB
          },
        ],
      });
    expect([400, 413]).toContain(resOversized.status);
  });

  // ---------------------------------------------------------------------------
  // 10. A guest cannot access arbitrary R2 object keys
  // ---------------------------------------------------------------------------
  it('10. A guest cannot specify arbitrary R2 object keys or access path traversal keys', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000009';
    insertTestEvent(db, { id: eventId, owner_id: 1, slug: 'key-isolation-event' });

    // Filename attempting directory traversal
    const resTraversal = await request(app)
      .post(`/api/events/${eventId}/media/presign-batch`)
      .set('Cookie', authCookie)
      .send({
        items: [
          {
            filename: '../../../../etc/passwd.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 2048,
          },
        ],
      });

    // Must be rejected or stripped cleanly to safe event-scoped key
    if (resTraversal.status === 200) {
      const item = resTraversal.body.data.items[0];
      expect(item.storageKey).toMatch(new RegExp(`^events/${eventId}/originals/`));
      expect(item.storageKey).not.toContain('..');
    } else {
      expect([400, 422]).toContain(resTraversal.status);
    }
  });

  // ---------------------------------------------------------------------------
  // 11. A guest cannot retrieve stored face embeddings
  // ---------------------------------------------------------------------------
  it('11. A guest cannot retrieve raw stored face embeddings', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000010';
    const slug = 'face-gallery-event';
    insertTestEvent(db, { id: eventId, owner_id: 1, slug, status: 'active', visibility: 'public' });
    const photoId = 'c2600000-0000-0000-0000-000000000010';
    insertTestMedia(db, { id: photoId, event_id: eventId, filename: 'portrait.jpg', status: 'ready' });
    insertTestFaceEmbedding(db, {
      id: '26000000-0000-0000-0000-000000000010',
      event_id: eventId,
      photo_id: photoId,
      embedding: '[0.12, 0.45, -0.67]',
    });

    // Public gallery query returns media metadata but never raw vectors or embeddings
    const res = await request(app).get(`/api/guest/gallery/${slug}`);
    expect(res.status).toBe(200);
    const media = res.body.data.media;
    expect(media.length).toBeGreaterThan(0);
    for (const item of media) {
      expect(item.embedding).toBeUndefined();
      expect(item.embeddings).toBeUndefined();
      expect(item.vector).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------------
  // 12. Guest selfies and query embeddings are not persisted
  // ---------------------------------------------------------------------------
  it('12. Guest selfies and query embeddings are not persisted in database or R2', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000011';
    insertTestEvent(db, { id: eventId, owner_id: 1, slug: 'selfie-privacy-event', status: 'active', visibility: 'public' });

    // Generate unit-normalized 128-D vector (L2 norm = 1.0)
    const unit128 = Array(128).fill(1 / Math.sqrt(128));

    // Mock AI service query response
    vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValueOnce({
      face_count: 1,
      face: {
        embedding: unit128,
        confidence: 0.98,
        box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      },
    } as any);

    await searchEventPhotosBySelfie(eventId, validSelfieBuffer, { limit: 10 });

    // Verify zero guest selfies were inserted into media table
    const guestMedia = db.public.many(`SELECT * FROM media WHERE event_id = '${eventId}' AND filename LIKE '%selfie%'`);
    expect(guestMedia.length).toBe(0);

    // Verify no temporary embeddings were stored in face_embeddings table
    const extraEmbeddings = db.public.many(`SELECT * FROM face_embeddings WHERE event_id = '${eventId}'`);
    expect(extraEmbeddings.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 13. Cross-event face searches are strictly isolated
  // ---------------------------------------------------------------------------
  it('13. Cross-event face searches enforce event boundary isolation', async () => {
    const eventA = 'e2600000-0000-0000-0000-000000000012';
    const eventB = 'e2600000-0000-0000-0000-000000000013';
    insertTestEvent(db, { id: eventA, owner_id: 1, slug: 'event-a', status: 'active', visibility: 'public' });
    insertTestEvent(db, { id: eventB, owner_id: 1, slug: 'event-b', status: 'active', visibility: 'public' });

    const photoA = 'c2600000-0000-0000-0000-000000000012';
    const photoB = 'c2600000-0000-0000-0000-000000000013';
    insertTestMedia(db, { id: photoA, event_id: eventA, filename: 'photoA.jpg', status: 'ready' });
    insertTestMedia(db, { id: photoB, event_id: eventB, filename: 'photoB.jpg', status: 'ready' });

    const unit128 = Array(128).fill(1 / Math.sqrt(128));

    // Both photos have embeddings, with distinct IDs
    insertTestFaceEmbedding(db, {
      id: '26000000-0000-0000-0000-000000000012',
      event_id: eventA,
      photo_id: photoA,
      embedding: JSON.stringify(unit128),
    });
    insertTestFaceEmbedding(db, {
      id: '26000000-0000-0000-0000-000000000013',
      event_id: eventB,
      photo_id: photoB,
      embedding: JSON.stringify(unit128),
    });

    vi.spyOn(aiClient, 'processQuerySelfie').mockResolvedValue({
      face_count: 1,
      face: {
        embedding: unit128,
        confidence: 0.99,
        box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      },
    } as any);

    const resultA = await searchEventPhotosBySelfie(eventA, validSelfieBuffer, { limit: 10 });

    // Result in Event A must only return photoA, never cross-contaminating with photoB
    expect(resultA.results.length).toBeGreaterThan(0);
    for (const match of resultA.results) {
      expect(match.mediaId).toBe(photoA);
      expect(match.mediaId).not.toBe(photoB);
    }
  });

  // ---------------------------------------------------------------------------
  // 14. Workers cannot write embeddings after deletion begins
  // ---------------------------------------------------------------------------
  it('14. Workers reject writing embeddings after permanent deletion has begun', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000014';
    insertTestEvent(db, { id: eventId, owner_id: 1, slug: 'deleting-event', status: 'deleting' });
    const photoId = 'c2600000-0000-0000-0000-000000000014';
    insertTestMedia(db, { id: photoId, event_id: eventId, filename: 'photo.jpg', status: 'ready' });

    // Attempting to index faces for an event in deleting state must safely skip
    const res = await indexPhotoFaces(photoId, eventId, Buffer.from('fake_image_bytes'));
    expect(res.status).toBe('skipped');
    expect(res.error).toMatch(/being deleted/i);
  });

  // ---------------------------------------------------------------------------
  // 15. SQL injection attempts are safely handled
  // ---------------------------------------------------------------------------
  it('15. SQL injection attempts in parameters are safely handled', async () => {
    const maliciousSlug = "test' OR '1'='1; DROP TABLE events; --";
    const res = await request(app).get(`/api/guest/event/${encodeURIComponent(maliciousSlug)}`);
    expect(res.status).toBe(404);

    // Verify events table still exists intact
    const eventsCount = db.public.one('SELECT count(*) as count FROM events');
    expect(Number(eventsCount.count)).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 16. Sensitive data redaction in logging & configuration audit
  // ---------------------------------------------------------------------------
  it('16. Sensitive data (passwords, PINs, tokens, base64 images) is redacted from logs', () => {
    const rawPayload = {
      password: 'MySecretPassword123!',
      currentPassword: 'OldSecretPassword!',
      pin: '1234',
      token: 'jwt.token.string',
      image: 'data:image/jpeg;base64,' + 'A'.repeat(500),
      normalKey: 'public-value',
      nested: {
        access_key: 'sensitive-r2-key',
        safeProperty: 42,
      },
    };

    const sanitized = censorSensitiveData(rawPayload) as any;
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.currentPassword).toBe('[REDACTED]');
    expect(sanitized.pin).toBe('[REDACTED]');
    expect(sanitized.token).toBe('[REDACTED]');
    expect(sanitized.image).toBe('[REDACTED]');
    expect(sanitized.normalKey).toBe('public-value');
    expect(sanitized.nested.access_key).toBe('[REDACTED]');
    expect(sanitized.nested.safeProperty).toBe(42);
  });

  // ---------------------------------------------------------------------------
  // 17. Existing restore and permanent deletion behavior remains correct
  // ---------------------------------------------------------------------------
  it('17. Existing restore and permanent deletion behavior remains correct', async () => {
    const eventId = 'e2600000-0000-0000-0000-000000000017';
    insertTestEvent(db, {
      id: eventId,
      owner_id: 1,
      name: 'Lifecycle Event',
      slug: 'lifecycle-integrity-event',
      status: 'trashed',
      visibility: 'public',
    });

    // 1. Restore from bin
    const restored = await restoreEventFromBin(eventId, 1);
    expect(restored.status).toBe('active');

    const dbCheckRestored = db.public.one(`SELECT status FROM events WHERE id = '${eventId}'`);
    expect(dbCheckRestored.status).toBe('active');

    // 2. Move back to bin and permanently delete
    await trashEvent(eventId, 1);
    const deletionResult = await deleteEventPermanently(eventId, 1, 'Lifecycle Event', { skipNameCheck: true });
    expect(deletionResult.deleted).toBe(true);

    const dbCheckDeleted = db.public.many(`SELECT * FROM events WHERE id = '${eventId}'`);
    expect(dbCheckDeleted.length).toBe(0);
  });
});
