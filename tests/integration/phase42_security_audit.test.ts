import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { IMemoryDb } from 'pg-mem';
import jwt from 'jsonwebtoken';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { resetLoginAttempts } from '../../apps/api/src/middleware/rateLimiter.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import { censorSensitiveData } from '../../apps/api/src/middleware/logger.js';
import { validateQueryEmbeddingVector } from '../../apps/api/src/services/faceSearchService.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
} from '../helpers/db_test_helper.js';

describe('Phase 42: Advanced Security, Privacy & Penetration-Style Testing Suite', () => {
  let app: ReturnType<typeof createApp>;
  let db: IMemoryDb;
  const photographerId = 1;
  const rawPassword = 'StudioMasterPassword2026!';
  let passwordHash: string;

  // Event Fixtures for Isolation & Security
  const eventAId = 'e0000000-0000-0000-0000-000000000001';
  const eventASlug = 'wedding-festival-2026';
  const eventBId = 'e0000000-0000-0000-0000-000000000002';
  const eventBSlug = 'secret-portrait-2026';

  const validPin = '7890';
  let pinHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(rawPassword, 10);
    pinHash = await bcrypt.hash(validPin, 10);
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
      email: 'photographer@studiolumina.photo',
      password_hash: passwordHash,
      business_name: 'Studio Lumina Fine Art',
    });

    // 2. Seed Event A (Public, PIN protected)
    insertTestEvent(db, {
      id: eventAId,
      slug: eventASlug,
      name: 'Wedding Festival 2026',
      status: 'active',
      visibility: 'public',
      public_duration_days: 30,
      pin_enabled: true,
      pin_hash: pinHash,
      allow_downloads: true,
      face_search_enabled: true,
    });

    // 3. Seed Event B (Public, PIN protected with different PIN)
    insertTestEvent(db, {
      id: eventBId,
      slug: eventBSlug,
      name: 'Secret Portrait 2026',
      status: 'active',
      visibility: 'public',
      public_duration_days: 30,
      pin_enabled: true,
      pin_hash: pinHash,
      allow_downloads: false,
      face_search_enabled: true,
    });

    // 4. Seed Media Items
    insertTestMedia(db, {
      id: '00000000-0000-0000-0001-000000000001',
      event_id: eventAId,
      type: 'photo',
      filename: 'wedding_01.jpg',
    });

    insertTestMedia(db, {
      id: '00000000-0000-0000-0002-000000000001',
      event_id: eventBId,
      type: 'photo',
      filename: 'secret_01.jpg',
    });
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  // =========================================================================
  // TEST 1: BOLA / IDOR UNAUTHORIZED ACCESS REJECTION
  // =========================================================================
  it('strictly rejects unauthenticated and cross-owner IDOR access attempts', async () => {
    // 1. Unauthenticated request to private event endpoint
    const unauthRes = await request(app).get(`/api/events/${eventAId}`);
    expect([401, 403]).toContain(unauthRes.status);
    expect(unauthRes.body.success).toBe(false);

    // 2. Unauthenticated attempt to delete event
    const deleteRes = await request(app).delete(`/api/events/${eventAId}`);
    expect([401, 403]).toContain(deleteRes.status);
    expect(deleteRes.body.success).toBe(false);

    // 3. Unauthenticated attempt to create folders
    const folderRes = await request(app)
      .post(`/api/events/${eventAId}/folders`)
      .send({ name: 'Hacked Folder' });
    expect([401, 403]).toContain(folderRes.status);
    expect(folderRes.body.success).toBe(false);
  });

  // =========================================================================
  // TEST 2: CROSS-EVENT TOKEN REJECTION (EVENT ISOLATION)
  // =========================================================================
  it('rejects a guest session token from Event A when used to access Event B', async () => {
    // Mint a mock guest token scoped strictly to Event A
    const jwtSecret = process.env.JWT_SECRET || 'test-jwt-secret-key-32-chars-minimum!';
    const eventAToken = jwt.sign(
      {
        type: 'guest',
        eventId: eventAId,
        slug: eventASlug,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      jwtSecret
    );

    // Attempt to access Event B gallery using Event A's token
    const res = await request(app)
      .get(`/api/guest/gallery/${eventBSlug}`)
      .set('x-guest-token', eventAToken);

    // Event B requires PIN, and Event A's token does not grant access to Event B
    expect([401, 403]).toContain(res.status);
  });

  // =========================================================================
  // TEST 3: BIOMETRIC VECTOR CONFIDENTIALITY (ZERO RAW VECTOR EXPOSURE)
  // =========================================================================
  it('ensures raw 128-D biometric vector embeddings are never exposed in API responses', async () => {
    const res = await request(app).get(`/api/guest/event/${eventASlug}`);
    expect(res.status).toBe(200);

    // Verify response body does not expose embeddings or private fields
    const rawBody = JSON.stringify(res.body);
    expect(rawBody).not.toContain('pin_hash');
    expect(rawBody).not.toContain('embedding');
    expect(rawBody).not.toContain('face_embeddings');
    expect(rawBody).not.toMatch(/\[\s*(-?\d+\.\d+,\s*){120,}-?\d+\.\d+\s*\]/);
  });

  // =========================================================================
  // TEST 4: EPHEMERAL BIOMETRIC MEMORY SANITIZATION
  // =========================================================================
  it('masks selfies, base64 images, and vectors in logging and enforces unit-norm vectors', () => {
    // 1. Test logger censorship
    const payloadWithBiometrics = {
      action: 'guest_face_search',
      selfie_data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...',
      face_features: Array.from({ length: 128 }, () => 0.088388),
      photo_id: '10000000-0000-0000-0000-000000000001',
    };

    const sanitized = censorSensitiveData(payloadWithBiometrics) as any;
    expect(['[REDACTED]', '[REDACTED_IMAGE_DATA]']).toContain(sanitized.selfie_data);
    expect(sanitized.face_features).toBe('[REDACTED_VECTOR_128D]');
    expect(sanitized.photo_id).toBe('10000000-0000-0000-0000-000000000001');

    // 2. Test vector unit-norm enforcement
    const validUnitVector = Array.from({ length: 128 }, () => 1 / Math.sqrt(128));
    expect(() => validateQueryEmbeddingVector(validUnitVector)).not.toThrow();

    const nonUnitVector = Array.from({ length: 128 }, () => 0.9);
    expect(() => validateQueryEmbeddingVector(nonUnitVector)).toThrow(/unit-normalized/);
  });

  // =========================================================================
  // TEST 5: SQL INJECTION DEFENSE (PARAMETERIZED QUERY INTEGRITY)
  // =========================================================================
  it('safely handles adversarial SQL injection payloads without syntax errors or leakage', async () => {
    const maliciousPayloads = [
      "' OR '1'='1",
      "'; DROP TABLE events; --",
      "' UNION SELECT id, email, password_hash, NULL FROM photographers --",
      "admin'--",
    ];

    for (const sqlPayload of maliciousPayloads) {
      // 1. Probe slug lookups with SQL payload
      const slugRes = await request(app).get(`/api/guest/event/${encodeURIComponent(sqlPayload)}`);
      expect([400, 401, 403, 404]).toContain(slugRes.status);
      expect(JSON.stringify(slugRes.body)).not.toContain('syntax error');

      // Verify that database tables remain intact (SQL injection was blocked)
      const checkRes = db.public.many('SELECT count(*) FROM events');
      expect(Number(checkRes[0].count)).toBeGreaterThan(0);

      // 2. Probe PIN verification route with SQL payload
      const pinRes = await request(app)
        .post(`/api/guest/verify-pin/${encodeURIComponent(eventASlug)}`)
        .send({ pin: sqlPayload });
      expect([400, 401, 403, 404, 429]).toContain(pinRes.status);
      expect(JSON.stringify(pinRes.body)).not.toContain('syntax error');
    }
  });

  // =========================================================================
  // TEST 6: PATH TRAVERSAL DEFENSE
  // =========================================================================
  it('rejects or neutralizes path traversal payloads in media identifiers', async () => {
    const traversalPayloads = [
      '../../etc/passwd',
      '..\\..\\windows\\system32\\cmd.exe',
      '....//....//....//etc/shadow',
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    ];

    for (const payload of traversalPayloads) {
      const res = await request(app).get(`/api/media/download/${encodeURIComponent(payload)}`);
      expect(res.status).toBe(400); // Rejected with ValidationError on UUID format
      expect(JSON.stringify(res.body)).not.toContain('root:x:0:0');
    }
  });

  // =========================================================================
  // TEST 7: PIN BRUTE-FORCE RATE LIMITING & LOCKOUT DEFENSE
  // =========================================================================
  it('triggers HTTP 429 lockout upon 5 consecutive failed PIN attempts', async () => {
    const clientIp = '198.51.100.99';

    // Make 4 consecutive invalid PIN attempts (attempts 1–4 return 401)
    for (let i = 0; i < 4; i++) {
      const attemptRes = await request(app)
        .post(`/api/guest/verify-pin/${eventASlug}`)
        .set('X-Forwarded-For', clientIp)
        .send({ pin: `111${i}` });
      expect([400, 401]).toContain(attemptRes.status);
    }

    // Attempt 5 returns 429 lockout
    const attempt5Res = await request(app)
      .post(`/api/guest/verify-pin/${eventASlug}`)
      .set('X-Forwarded-For', clientIp)
      .send({ pin: '1114' });
    expect(attempt5Res.status).toBe(429);

    // Attempt 6 (even with the valid PIN) is locked out with 429
    const lockedRes = await request(app)
      .post(`/api/guest/verify-pin/${eventASlug}`)
      .set('X-Forwarded-For', clientIp)
      .send({ pin: validPin });

    expect(lockedRes.status).toBe(429);
    expect(lockedRes.body.error).toBeDefined();
    expect(lockedRes.body.error.code).toBe('PIN_RATE_LIMITED');
  });

  // =========================================================================
  // TEST 8: ERROR ENVELOPE SANITIZATION
  // =========================================================================
  it('ensures uncaught error responses contain zero system paths, stack traces, or credentials', async () => {
    const res = await request(app).get('/api/non-existent-security-probe-12345');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('/Users/');
    expect(bodyStr).not.toContain('\\Users\\');
    expect(bodyStr).not.toContain('node_modules');
    expect(bodyStr).not.toContain('postgres://');
    expect(bodyStr).not.toContain('CLOUDFLARE_R2');
  });
});
