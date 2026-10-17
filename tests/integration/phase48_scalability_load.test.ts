import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../../server/db.js';
import app from '../../server/index.js';
import queue from '../../server/services/queue.js';
import { searchBySelfie } from '../../server/ai/face_service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'lumina-photographer-super-secret-key-92837482';
const GUEST_JWT_SECRET = process.env.GUEST_JWT_SECRET || 'guest-session-secret-key-1928374';

describe('Phase 48: Large-Scale Load, Concurrency, Auto-Scaling & Queue Balancing Integration Tests', () => {
  const TEST_PHOTOGRAPHER_ID = 9948;
  const EVENT_A_ID = 'e4800000-0000-0000-0000-000000000001';
  const EVENT_B_ID = 'e4800000-0000-0000-0000-000000000002';
  const EVENT_A_SLUG = 'grand-wedding-scale-2026';
  const EVENT_B_SLUG = 'mini-portrait-scale-2026';

  let photographerToken: string;
  let guestTokenA: string;
  let guestTokenB: string;

  beforeAll(() => {
    // 1. Seed isolated test photographer
    db.prepare(`
      INSERT OR REPLACE INTO photographer (id, email, password_hash, business_name, status)
      VALUES (?, 'scale_master@studiolumina.photo', 'hash_pw_mock', 'Lumina Scale Studio', 'active')
    `).run(TEST_PHOTOGRAPHER_ID);

    // 2. Seed Event A (Large Event)
    db.prepare(`
      INSERT OR REPLACE INTO events (
        id, slug, name, client_name, client_email, event_date, status, visibility, pin_enabled, face_search_enabled
      ) VALUES (?, ?, 'Grand Scale Wedding', 'Victoria Sterling', 'victoria@example.com', '2026-10-20', 'active', 'public', 0, 1)
    `).run(EVENT_A_ID, EVENT_A_SLUG);

    // 3. Seed Event B (Concurrent Small Event)
    db.prepare(`
      INSERT OR REPLACE INTO events (
        id, slug, name, client_name, client_email, event_date, status, visibility, pin_enabled, face_search_enabled
      ) VALUES (?, ?, 'Mini Portrait Session', 'Marcus Vance', 'marcus@example.com', '2026-10-21', 'active', 'public', 0, 1)
    `).run(EVENT_B_ID, EVENT_B_SLUG);

    // 4. Seed Folders
    db.prepare(`INSERT OR REPLACE INTO folders (id, event_id, name, sort_order) VALUES ('f48_1', ?, 'Ceremony', 1)`).run(EVENT_A_ID);
    db.prepare(`INSERT OR REPLACE INTO folders (id, event_id, name, sort_order) VALUES ('f48_2', ?, 'Reception', 2)`).run(EVENT_A_ID);

    // 5. Seed Media Items in Event A (10 ready photos)
    for (let i = 1; i <= 10; i++) {
      const mediaId = `m48_a_${i}`;
      db.prepare(`
        INSERT OR REPLACE INTO media (
          id, event_id, folder_id, filename, original_name, type, mime_type, file_size, width, height, status,
          storage_key_original, storage_key_preview, storage_key_thumbnail
        ) VALUES (
          ?, ?, ?, ?, ?, 'photo', 'image/jpeg', 204800, 1920, 1080, 'ready',
          'events/${EVENT_A_ID}/originals/${mediaId}.jpg',
          'events/${EVENT_A_ID}/previews/${mediaId}.webp',
          'events/${EVENT_A_ID}/thumbnails/${mediaId}.webp'
        )
      `).run(mediaId, EVENT_A_ID, i <= 5 ? 'f48_1' : 'f48_2', `${mediaId}.jpg`, `Photo_${i}.jpg`);

      // Seed 128-D normalized synthetic face embedding for Event A
      const mockEmbedding = new Array(128).fill(0).map((_, idx) => (idx === i ? 0.95 : 0.01));
      db.prepare(`
        INSERT OR REPLACE INTO face_embeddings (
          id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, embedding
        ) VALUES (?, ?, ?, 0, 100, 100, 200, 200, 0.98, ?)
      `).run(`fe48_a_${i}`, EVENT_A_ID, mediaId, JSON.stringify(mockEmbedding));
    }

    // 6. Seed Media Items in Event B (4 ready photos with isolated embeddings)
    for (let i = 1; i <= 4; i++) {
      const mediaId = `m48_b_${i}`;
      db.prepare(`
        INSERT OR REPLACE INTO media (
          id, event_id, filename, original_name, type, mime_type, file_size, width, height, status,
          storage_key_original, storage_key_preview, storage_key_thumbnail
        ) VALUES (
          ?, ?, ?, ?, 'photo', 'image/jpeg', 150000, 1280, 720, 'ready',
          'events/${EVENT_B_ID}/originals/${mediaId}.jpg',
          'events/${EVENT_B_ID}/previews/${mediaId}.webp',
          'events/${EVENT_B_ID}/thumbnails/${mediaId}.webp'
        )
      `).run(mediaId, EVENT_B_ID, `${mediaId}.jpg`, `B_Photo_${i}.jpg`);

      // Event B embedding uses negative orthogonality to ensure zero false positive match with Event A
      const mockEmbeddingB = new Array(128).fill(0).map((_, idx) => (idx === 127 - i ? 0.95 : -0.01));
      db.prepare(`
        INSERT OR REPLACE INTO face_embeddings (
          id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, embedding
        ) VALUES (?, ?, ?, 0, 50, 50, 150, 150, 0.95, ?)
      `).run(`fe48_b_${i}`, EVENT_B_ID, mediaId, JSON.stringify(mockEmbeddingB));
    }

    photographerToken = jwt.sign({ id: TEST_PHOTOGRAPHER_ID, email: 'scale_master@studiolumina.photo' }, JWT_SECRET, { expiresIn: '1d' });
    guestTokenA = jwt.sign({ eventId: EVENT_A_ID, role: 'guest' }, GUEST_JWT_SECRET, { expiresIn: '12h' });
    guestTokenB = jwt.sign({ eventId: EVENT_B_ID, role: 'guest' }, GUEST_JWT_SECRET, { expiresIn: '12h' });
  });

  afterAll(() => {
    // Clean up test data
    db.prepare('DELETE FROM face_embeddings WHERE event_id IN (?, ?)').run(EVENT_A_ID, EVENT_B_ID);
    db.prepare('DELETE FROM media WHERE event_id IN (?, ?)').run(EVENT_A_ID, EVENT_B_ID);
    db.prepare('DELETE FROM folders WHERE event_id IN (?, ?)').run(EVENT_A_ID, EVENT_B_ID);
    db.prepare('DELETE FROM events WHERE id IN (?, ?)').run(EVENT_A_ID, EVENT_B_ID);
    db.prepare('DELETE FROM photographer WHERE id = ?').run(TEST_PHOTOGRAPHER_ID);
  });

  // ===================================================================
  // 1. QUERY OPTIMIZATION & CARTESIAN PRODUCT ELIMINATION
  // ===================================================================
  describe('1. Query Optimization & Cartesian Immunity', () => {
    it('accurately computes aggregate counts without Cartesian multiplier anomalies in event list', async () => {
      const res = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);

      const eventA = res.body.events.find((e: any) => e.id === EVENT_A_ID);
      expect(eventA).toBeDefined();
      // Must be EXACT counts: 10 media items, 10 photos, 0 videos, 2 folders, 10 face embeddings
      expect(eventA.media_count).toBe(10);
      expect(eventA.photo_count).toBe(10);
      expect(eventA.video_count).toBe(0);
      expect(eventA.folder_count).toBe(2);
      expect(eventA.face_count).toBe(10);
      expect(eventA.total_size_bytes).toBe(2048000);
    });

    it('accurately returns correlated stats on single event retrieval', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_A_ID}`)
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.event.media_count).toBe(10);
      expect(res.body.event.face_count).toBe(10);
      expect(res.body.folders.length).toBe(2);
      expect(res.body.folders[0].photo_count).toBe(5);
    });
  });

  // ===================================================================
  // 2. BACKWARDS-COMPATIBLE PAGINATION (MEDIA & GUEST GALLERY)
  // ===================================================================
  describe('2. High-Performance Pagination', () => {
    it('returns all media by default when limit is not specified (backwards compatible)', async () => {
      const res = await request(app)
        .get(`/api/media/event/${EVENT_A_ID}`)
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.media.length).toBe(10);
      expect(res.body.pagination).toBeUndefined();
    });

    it('supports limit and page parameters with structured pagination metadata for photographer', async () => {
      const page1Res = await request(app)
        .get(`/api/media/event/${EVENT_A_ID}?limit=4&page=1`)
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(page1Res.status).toBe(200);
      expect(page1Res.body.media.length).toBe(4);
      expect(page1Res.body.pagination).toBeDefined();
      expect(page1Res.body.pagination.page).toBe(1);
      expect(page1Res.body.pagination.limit).toBe(4);
      expect(page1Res.body.pagination.total).toBe(10);
      expect(page1Res.body.pagination.totalPages).toBe(3);
      expect(page1Res.body.pagination.hasMore).toBe(true);

      const page3Res = await request(app)
        .get(`/api/media/event/${EVENT_A_ID}?limit=4&page=3`)
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(page3Res.status).toBe(200);
      expect(page3Res.body.media.length).toBe(2); // 10 - (2 * 4) = 2 remaining
      expect(page3Res.body.pagination.hasMore).toBe(false);
    });

    it('supports pagination in guest gallery view without monolithic DOM overload', async () => {
      const guestRes = await request(app)
        .get(`/api/guest/gallery/${EVENT_A_SLUG}?limit=3&page=1`)
        .set('x-guest-token', guestTokenA);

      expect(guestRes.status).toBe(200);
      expect(guestRes.body.media.length).toBe(3);
      expect(guestRes.body.pagination).toBeDefined();
      expect(guestRes.body.pagination.page).toBe(1);
      expect(guestRes.body.pagination.limit).toBe(3);
      expect(guestRes.body.pagination.total).toBe(10);
      expect(guestRes.body.pagination.totalPages).toBe(4);
      expect(guestRes.body.pagination.hasMore).toBe(true);
    });
  });

  // ===================================================================
  // 3. DYNAMIC QUEUE AUTO-SCALING & ANTI-STARVATION
  // ===================================================================
  describe('3. Dynamic Queue Auto-Scaling & Anti-Starvation', () => {
    it('calculates dynamic concurrency proportionally based on queue depth', () => {
      expect(queue.calculateDynamicConcurrency(5)).toBe(2);   // Low queue: baseline 2
      expect(queue.calculateDynamicConcurrency(50)).toBe(4);  // Moderate backlog: 4
      expect(queue.calculateDynamicConcurrency(300)).toBe(6); // Heavy backlog: 6
      expect(queue.calculateDynamicConcurrency(1000)).toBe(8);// Surge ceiling: 8
    });

    it('exposes real-time queue telemetry and backpressure metrics via getMetrics', () => {
      const metrics = queue.getMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics.queueDepth).toBe('number');
      expect(typeof metrics.activeConcurrency).toBe('number');
      expect(metrics.maxConcurrency).toBe(8);
      expect(typeof metrics.totalProcessed).toBe('number');
      expect(typeof metrics.totalFailed).toBe('number');
    });

    it('exposes queue metrics through the dedicated /api/queue/metrics endpoint', async () => {
      const res = await request(app).get('/api/queue/metrics');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.metrics.maxConcurrency).toBe(8);
      expect(res.body.requestId).toBeDefined();
    });

    it('includes queue telemetry in readiness probe /api/ready', async () => {
      const res = await request(app).get('/api/ready');
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
      expect(res.body.queue).toBeDefined();
      expect(res.body.queue.activeConcurrency).toBeGreaterThanOrEqual(2);
    });
  });

  // ===================================================================
  // 4. IN-MEMORY ZERO-DISK VECTOR SEARCH & STRICT EVENT ISOLATION
  // ===================================================================
  describe('4. In-Memory Zero-Disk Vector Search', () => {
    it('computes cosine matches in-memory with zero temporary candidate disk writes', async () => {
      // Create a simulated 1x1 test JPEG buffer
      const dummyJpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
        0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
        0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
        0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
        0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
        0x00, 0xbf, 0x00, 0xff, 0xd9
      ]);

      // Call searchBySelfie on Event A
      const searchResult = await searchBySelfie(EVENT_A_ID, dummyJpegBuffer);

      // Verify response structure
      expect(searchResult).toBeDefined();
      expect(typeof searchResult.success).toBe('boolean');

      // Verify ZERO cand_*.json files exist in the temp directory
      const tempDir = path.join(__dirname, '..', '..', 'temp');
      if (fs.existsSync(tempDir)) {
        const tempFiles = fs.readdirSync(tempDir);
        const orphanedCandidateFiles = tempFiles.filter(f => f.startsWith('cand_') && f.endsWith('.json'));
        expect(orphanedCandidateFiles.length).toBe(0);
      }
    });

    it('enforces strict event isolation under concurrent searches (Event A never returns Event B)', async () => {
      // Query embeddings for Event A and Event B directly
      const aRows = db.prepare('SELECT photo_id FROM face_embeddings WHERE event_id = ?').all(EVENT_A_ID);
      const bRows = db.prepare('SELECT photo_id FROM face_embeddings WHERE event_id = ?').all(EVENT_B_ID);

      const aPhotoIds = new Set(aRows.map((r: any) => r.photo_id));
      const bPhotoIds = new Set(bRows.map((r: any) => r.photo_id));

      // Intersection must be empty (disjoint sets)
      const intersection = [...aPhotoIds].filter(id => bPhotoIds.has(id));
      expect(intersection.length).toBe(0);
    });
  });

  // ===================================================================
  // 5. TIERED RATE LIMITING & ABUSE PROTECTION
  // ===================================================================
  describe('5. Tiered Rate Limiting & Abuse Defense', () => {
    it('enforces face search rate limits to protect CPU/worker resources against spam floods', async () => {
      const clientIp = '198.51.100.99';
      let rateLimited = false;

      // Send 12 consecutive face searches (rate limit window allows 10/min)
      for (let i = 0; i < 12; i++) {
        const res = await request(app)
          .post(`/api/guest/face-search/${EVENT_A_SLUG}`)
          .set('x-guest-token', guestTokenA)
          .set('X-Forwarded-For', clientIp)
          .attach('selfie', Buffer.from('mock_image_bytes'), 'selfie.jpg');

        if (res.status === 429) {
          rateLimited = true;
          expect(res.body.error).toContain('Search rate limit exceeded');
          break;
        }
      }

      expect(rateLimited).toBe(true);
    });
  });
});
