import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { createTestDatabase } from '../helpers/db_test_helper.js';
import { clearMemoryRateLimitStore } from '../../apps/api/src/middleware/rateLimiter.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';

describe('Security & Threat Protection Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'StrongSecurityPassword2026!';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  });

  beforeEach(() => {
    clearMemoryRateLimitStore();

    db = createTestDatabase();
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina');`
    );

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  describe('Brute-Force & Rate Limiting Defense', () => {
    it('should lock out login attempts after 5 consecutive failures and return HTTP 429', async () => {
      const clientIp = '198.51.100.42'; // Simulated client IP

      // Perform 5 consecutive failed login attempts
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', clientIp)
          .send({
            email: 'photographer@studiolumina.photo',
            password: `WrongPasswordAttempt_${i}`,
          });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      }

      // The 6th attempt must be rejected by the rate limiter before password verification
      const blockedRes = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', clientIp)
        .send({
          email: 'photographer@studiolumina.photo',
          password: TEST_PASSWORD, // Even with the right password, they are locked out!
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.success).toBe(false);
      expect(blockedRes.body.error.code).toBe('RATE_LIMITED');
      expect(blockedRes.body.error.message).toContain('Too many failed attempts');
    }, 30000);
  });

  describe('CSRF & Origin Header Validation', () => {
    it('should reject state-changing requests from untrusted origins with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'https://malicious-attacker-domain.evil')
        .send({
          email: 'photographer@studiolumina.photo',
          password: TEST_PASSWORD,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('not authorized');
    });

    it('should permit state-changing requests from configured frontend origin', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({
          email: 'photographer@studiolumina.photo',
          password: TEST_PASSWORD,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Security Headers (Helmet Enforcement)', () => {
    it('should set defensive security headers on all responses', async () => {
      const res = await request(app).get('/health/live');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(['SAMEORIGIN', 'DENY']).toContain(res.headers['x-frame-options']);
      expect(res.headers['referrer-policy']).toBeDefined();
    });
  });

  describe('Session Token Cryptographic Integrity', () => {
    it('should reject session tokens signed with a foreign secret', async () => {
      // Craft token with wrong secret
      const rogueToken = jwt.sign(
        { sub: 1, email: 'photographer@studiolumina.photo' },
        'rogue-attacker-signing-secret-key-12345',
        {
          issuer: 'studio-lumina-api',
          audience: 'studio-lumina-client',
        }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${rogueToken}`]);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should reject session tokens with incorrect issuer or audience claim', async () => {
      const rogueToken = jwt.sign(
        { sub: 1, email: 'photographer@studiolumina.photo' },
        process.env.AUTH_SECRET || 'dev-insecure-auth-secret-change-in-prod-min-32-chars-long!!',
        {
          issuer: 'rogue-issuer',
          audience: 'rogue-audience',
        }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${rogueToken}`]);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });
});
