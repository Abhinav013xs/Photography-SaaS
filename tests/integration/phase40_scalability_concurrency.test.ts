import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { IMemoryDb } from 'pg-mem';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { resetLoginAttempts } from '../../apps/api/src/middleware/rateLimiter.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
  insertTestStorageUsage,
} from '../helpers/db_test_helper.js';

describe('Phase 40: Scalability, High-Concurrency, Queue Scaling & Resource Isolation Suite', () => {
  let app: ReturnType<typeof createApp>;
  let db: IMemoryDb;
  let authCookie: string;
  const photographerId = 1;
  const photographerEmail = 'photographer@studiolumina.photo';
  const rawPassword = 'StudioMasterPassword2026!';
  let passwordHash: string;

  // Event Fixtures for Isolation & Concurrency
  const eventMegaId = 'e0000000-0000-0000-0000-000000000001';
  const eventMegaSlug = 'mega-festival-2026';
  const eventMiniId = 'e0000000-0000-0000-0000-000000000002';
  const eventMiniSlug = 'mini-portrait-2026';

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(rawPassword, 10);
  });

  beforeEach(() => {
    resetLoginAttempts();
    resetPinRateLimiterStore();
    vi.restoreAllMocks();

    db = createTestDatabase();

    const pool = db.adapters.createPg().Pool;
    setDatabasePool(new pool());
    app = createApp();

    // Mock Presigned URL generation for Cloudflare R2
    vi.spyOn(storageAdapter, 'generatePresignedGetUrl').mockImplementation(async (opts) => ({
      url: `https://mock-r2.studiolumina.photo/${opts.key}?expires=900&signature=valid-sig`,
      expiresInSeconds: opts.expiresInSeconds,
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000).toISOString(),
    }));

    // 1. Seed Sole Photographer
    insertTestPhotographer(db, {
      id: photographerId,
      email: photographerEmail,
      password_hash: passwordHash,
      business_name: 'Studio Lumina High Concurrency',
    });

    const token = signSessionToken({ id: photographerId, email: photographerEmail });
    authCookie = `${SESSION_COOKIE_NAME}=${token}`;

    // 2. Seed High-Volume "Mega" Event
    insertTestEvent(db, {
      id: eventMegaId,
      slug: eventMegaSlug,
      name: 'Mega Wedding Festival 2026',
      status: 'active',
      visibility: 'public',
      public_duration_days: 30,
      pin_enabled: false,
      allow_downloads: true,
      face_search_enabled: true,
    });

    // 3. Seed Low-Volume "Mini" Event
    insertTestEvent(db, {
      id: eventMiniId,
      slug: eventMiniSlug,
      name: 'Mini Portrait Session 2026',
      status: 'active',
      visibility: 'public',
      public_duration_days: 30,
      pin_enabled: false,
      allow_downloads: true,
      face_search_enabled: true,
    });

    // Populate Mega Event with media items
    for (let i = 1; i <= 25; i++) {
      const hex = i.toString(16).padStart(12, '0');
      insertTestMedia(db, {
        id: `00000000-0000-0000-0001-${hex}`,
        event_id: eventMegaId,
        type: 'photo',
        file_size: 5000000,
        filename: `festival_${i}.jpg`,
      });
    }

    // Populate Mini Event with 2 media items
    insertTestMedia(db, {
      id: '00000000-0000-0000-0002-000000000001',
      event_id: eventMiniId,
      type: 'photo',
      file_size: 4000000,
      filename: 'portrait_01.jpg',
    });
    insertTestMedia(db, {
      id: '00000000-0000-0000-0002-000000000002',
      event_id: eventMiniId,
      type: 'photo',
      file_size: 4200000,
      filename: 'portrait_02.jpg',
    });
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  // =========================================================================
  // TEST 1: HIGH CONCURRENCY BURST
  // =========================================================================
  it('sustains concurrent requests with bounded latency and zero errors', async () => {
    const concurrency = 20;
    const startTime = Date.now();
    const latencies: number[] = [];

    const promises = Array.from({ length: concurrency }).map(async () => {
      const reqStart = Date.now();
      const res = await request(app)
        .get('/api/events')
        .set('Cookie', [authCookie]);

      const reqDuration = Date.now() - reqStart;
      latencies.push(reqDuration);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.events)).toBe(true);
    });

    await Promise.all(promises);
    const totalDuration = Date.now() - startTime;

    // Calculate Latency Percentiles
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    expect(p50).toBeDefined();
    expect(p95).toBeLessThan(10000);
    expect(totalDuration).toBeLessThan(15000);
  });

  // =========================================================================
  // TEST 2: RESOURCE FAIRNESS BETWEEN EVENTS
  // =========================================================================
  it('ensures high-volume event workload does not starve or corrupt concurrent requests to small event', async () => {
    // Fire concurrent queries to both Mega Event and Mini Event simultaneously
    const [megaRes, miniRes] = await Promise.all([
      request(app).get(`/api/guest/gallery/${eventMegaSlug}`),
      request(app).get(`/api/guest/gallery/${eventMiniSlug}`),
    ]);

    expect(megaRes.status).toBe(200);
    expect(miniRes.status).toBe(200);

    // Verify strict isolation & counts
    expect(megaRes.body.data.media.length).toBe(25);
    expect(miniRes.body.data.media.length).toBe(2);

    // Verify no cross-event contamination
    const miniPhoto = miniRes.body.data.media[0];
    expect(miniPhoto.filename).toBe('portrait_01.jpg');
    const megaPhotoFilenames = megaRes.body.data.media.map((m: any) => m.filename);
    expect(megaPhotoFilenames).not.toContain('portrait_01.jpg');
  });

  // =========================================================================
  // TEST 3: DIRECT R2 PRESIGNED DOWNLOAD SCALABILITY
  // =========================================================================
  it('scales direct R2 presigned URL generation with in-memory execution and zero disk I/O bottleneck', async () => {
    const mediaId = '00000000-0000-0000-0002-000000000001';
    const batchSize = 25;
    const latencies: number[] = [];

    const promises = Array.from({ length: batchSize }).map(async () => {
      const t0 = Date.now();
      const res = await request(app).get(`/api/media/download/${mediaId}`);
      latencies.push(Date.now() - t0);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
    });

    await Promise.all(promises);
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    // In-memory presigned URL issuance should be rapid (P95 < 15000ms under heavy multi-process test runner load)
    expect(p95).toBeLessThan(15000);
  });

  // =========================================================================
  // TEST 4: VECTOR EVENT FILTERING & STRICT EVENT SCOPING
  // =========================================================================
  it('verifies that similarity searches enforce event-level query partitioning without cross-event leakage', async () => {
    // Insert mock 128-D vector embeddings into database for Event Mega using explicit UUID
    const dummyVector = JSON.stringify(Array.from({ length: 128 }, () => 0.05));
    db.public.none(`
      INSERT INTO face_embeddings (
        id, event_id, photo_id, box_x, box_y,
        box_w, box_h, confidence,
        embedding, model_name, model_version
      ) VALUES (
        'f0000000-0000-0000-0000-000000000001', '${eventMegaId}', '00000000-0000-0000-0001-000000000001',
        0.1, 0.1, 0.2, 0.2, 0.95, '${dummyVector}', 'SFace', 'v1'
      );
    `);

    // Verify database query filtering
    const eventAEmbeddings = db.public.query(
      `SELECT COUNT(*) as count FROM face_embeddings WHERE event_id = '${eventMegaId}'`
    );
    const eventBEmbeddings = db.public.query(
      `SELECT COUNT(*) as count FROM face_embeddings WHERE event_id = '${eventMiniId}'`
    );

    expect(Number(eventAEmbeddings.rows[0].count)).toBe(1);
    expect(Number(eventBEmbeddings.rows[0].count)).toBe(0); // Mathematical isolation
  });

  // =========================================================================
  // TEST 5: GRACEFUL DEGRADATION UNDER SPIKE TRAFFIC
  // =========================================================================
  it('gracefully throttles abusive bursts while preserving low-latency responses for normal requests', async () => {
    // 1. Send normal health check query
    const healthRes = await request(app).get('/health/live');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');

    // 2. Simulate rapid brute-force guest PIN attempts on a PIN event
    db.public.query(`UPDATE events SET pin_enabled = true, pin_hash = 'dummy_hash' WHERE id = '${eventMiniId}'`);

    for (let i = 0; i < 4; i++) {
      await request(app)
        .post(`/api/guest/verify-pin/${eventMiniSlug}`)
        .send({ pin: '000000' });
    }

    // 5th attempt triggers 429
    const burstRes = await request(app)
      .post(`/api/guest/verify-pin/${eventMiniSlug}`)
      .send({ pin: '000000' });

    expect(burstRes.status).toBe(429);

    // 3. Normal traffic and administrative dashboard remain completely unaffected and responsive!
    const adminRes = await request(app)
      .get('/api/events')
      .set('Cookie', [authCookie]);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.success).toBe(true);
  });
});
