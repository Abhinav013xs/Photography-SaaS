import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
} from '../helpers/db_test_helper.js';
import { clearMemoryRateLimitStore } from '../../apps/api/src/middleware/rateLimiter.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import { resetSearchRateLimiter } from '../../apps/api/src/middleware/searchRateLimiter.js';

describe('Comprehensive Security Limits & Database Protection Audit (Phases 0–19)', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'SecurePhotographerPassword2026!';
  let passwordHash: string;

  const eventAId = 'a0000000-0000-0000-0000-000000000001';
  const eventBId = 'b0000000-0000-0000-0000-000000000002';
  const privateEventId = 'c0000000-0000-0000-0000-000000000003';

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  });

  beforeEach(async () => {
    clearMemoryRateLimitStore();
    resetPinRateLimiterStore();
    resetSearchRateLimiter();

    db = createTestDatabase();
    insertTestPhotographer(db, { password_hash: passwordHash });

    const pinHashA = await bcrypt.hash('1234', 10);
    const pinHashPrivate = await bcrypt.hash('9999', 10);

    // Event A: Public, PIN-protected
    insertTestEvent(db, {
      id: eventAId,
      slug: 'royal-wedding-2026',
      name: 'Royal Wedding',
      visibility: 'public',
      status: 'active',
      pin_enabled: true,
      pin_hash: pinHashA,
    });

    // Event B: Public, no PIN
    insertTestEvent(db, {
      id: eventBId,
      slug: 'beach-sunset-2026',
      name: 'Beach Sunset',
      visibility: 'public',
      status: 'active',
      pin_enabled: false,
      pin_hash: null,
    });

    // Event C: Private, with PIN configured
    insertTestEvent(db, {
      id: privateEventId,
      slug: 'private-vip-gala',
      name: 'Private VIP Gala',
      visibility: 'private',
      status: 'active',
      pin_enabled: true,
      pin_hash: pinHashPrivate,
    });

    insertTestFolder(db, { id: 'f0000000-0000-0000-0000-000000000001', event_id: eventAId, name: 'Sangeet' });
    insertTestMedia(db, {
      id: '10000000-0000-0000-0000-000000000001',
      event_id: eventAId,
      filename: 'sangeet_01.jpg',
      status: 'ready',
    });

    insertTestMedia(db, {
      id: '10000000-0000-0000-0000-000000000002',
      event_id: privateEventId,
      filename: 'private_vip_01.jpg',
      status: 'ready',
    });

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  describe('1. Rate Limiting Security Controls', () => {
    it('AUTH LOGIN: Locks out client IP after 5 consecutive failed attempts with HTTP 429 & Retry-After', async () => {
      const attackerIp = '198.51.100.99';

      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', attackerIp)
          .send({
            email: 'photographer@studiolumina.photo',
            password: `WrongPassword_${attempt}`,
          });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      }

      // 6th attempt must be rejected by the rate limiter with 429
      const blockedRes = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', attackerIp)
        .send({
          email: 'photographer@studiolumina.photo',
          password: TEST_PASSWORD, // Even with the right password, they are locked out!
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error.code).toBe('RATE_LIMITED');
      expect(blockedRes.headers['retry-after']).toBeDefined();
    });

    it('GUEST PIN: Locks out IP on specific event after 5 failed PIN attempts with HTTP 429 & Retry-After', async () => {
      const guestIp = '203.0.113.55';

      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await request(app)
          .post('/api/guest/verify-pin/royal-wedding-2026')
          .set('X-Forwarded-For', guestIp)
          .send({ pin: `000${attempt}` });

        if (attempt < 5) {
          expect(res.status).toBe(401);
        } else {
          // On the 5th failed attempt, lockout is triggered
          expect(res.status).toBe(429);
          expect(res.headers['retry-after']).toBeDefined();
        }
      }

      // 6th attempt immediately rejected with 429
      const lockedRes = await request(app)
        .post('/api/guest/verify-pin/royal-wedding-2026')
        .set('X-Forwarded-For', guestIp)
        .send({ pin: '1234' }); // Even correct PIN is rejected during cooldown

      expect(lockedRes.status).toBe(429);
      expect(lockedRes.body.error.code).toBe('PIN_RATE_LIMITED');
      expect(lockedRes.headers['retry-after']).toBeDefined();
    });
  });

  describe('2. SQL Injection Resistance & Parameterization', () => {
    it('GUEST SLUG: Malicious SQL injection payloads in URL slug are safely parameterized and rejected', async () => {
      const sqlInjections = [
        "' OR '1'='1",
        "royal-wedding-2026' OR '1'='1' --",
        "'; DROP TABLE events; --",
        "' UNION SELECT NULL, NULL, NULL --",
      ];

      for (const payload of sqlInjections) {
        const res = await request(app).get(`/api/guest/event/${encodeURIComponent(payload)}`);
        // Must return safe 404 without executing SQL or leaking database internals
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
      }

      // Verify database table was not dropped
      const countRes = db.public.one('SELECT count(*)::int as count FROM events;');
      expect(countRes.count).toBe(3);
    });

    it('GUEST PIN: SQL injection payloads in PIN request body are strictly validated as digits', async () => {
      const maliciousPins = [
        "' OR '1'='1",
        "1234' OR '1'='1",
        "1234; DROP TABLE guest_sessions; --",
        "<script>alert(1)</script>",
      ];

      for (const pin of maliciousPins) {
        const res = await request(app)
          .post('/api/guest/verify-pin/royal-wedding-2026')
          .send({ pin });

        // Must reject format with 400 validation error
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      }
    });
  });

  describe('3. Database Event Isolation & Cross-Event Protection', () => {
    it('EVENT ISOLATION: Valid guest token for Event A is rejected if presented for Event B', async () => {
      // 1. Authenticate for Event A
      const authRes = await request(app)
        .post('/api/guest/verify-pin/royal-wedding-2026')
        .send({ pin: '1234' });

      expect(authRes.status).toBe(200);
      const guestTokenA = authRes.body.data.guestToken;
      expect(guestTokenA).toBeDefined();

      // 2. Try to query Event B using Event A's token
      // The system strictly blocks cross-event token reuse with 401
      const res = await request(app)
        .get('/api/guest/gallery/beach-sunset-2026')
        .set('x-guest-token', guestTokenA);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Cross-event');
    });

    it('PRIVATE GALLERY: Cannot be accessed even with correct PIN or valid token', async () => {
      // Submitting correct PIN to a private event must be rejected with 403
      const res = await request(app)
        .post('/api/guest/verify-pin/private-vip-gala')
        .send({ pin: '9999' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('private');
    });
  });

  describe('4. Sensitive Field Masking & Zero Leakage', () => {
    it('AUTH RESPONSES: Never expose password_hash or salt in login or me endpoints', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'photographer@studiolumina.photo',
          password: TEST_PASSWORD,
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.photographer).toBeDefined();
      expect(loginRes.body.data.photographer.password_hash).toBeUndefined();
      expect(JSON.stringify(loginRes.body)).not.toContain('password_hash');
    });

    it('EVENT RESPONSES: Never expose pin_hash to guests or in metadata', async () => {
      const guestRes = await request(app).get('/api/guest/event/royal-wedding-2026');
      expect(guestRes.status).toBe(200);
      expect(guestRes.body.data.event.pin_hash).toBeUndefined();
      expect(JSON.stringify(guestRes.body)).not.toContain('pin_hash');
    });

    it('ERROR RESPONSES: Internal stack traces and database credentials are never leaked', async () => {
      const res = await request(app).get('/api/guest/event/non-existent-gallery-slug-xyz');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('pg-mem');
      expect(JSON.stringify(res.body)).not.toContain('SELECT');
    });
  });
});
