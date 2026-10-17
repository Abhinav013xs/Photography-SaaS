import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { createTestDatabase } from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { resetLoginAttempts } from '../../apps/api/src/middleware/rateLimiter.js';

describe('Photographer Authentication & Session Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'CorrectHorseBatteryStaple123!';
  let passwordHash: string;

  beforeAll(async () => {
    // Hash password with cost 10 for deterministic testing
    passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  });

  beforeEach(async () => {
    // Reset rate limiter state between tests
    resetLoginAttempts();

    // Create fresh in-memory database with master schema
    db = createTestDatabase();

    // Insert test photographer
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography');`
    );

    // Setup pg adapter pool
    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  describe('POST /api/auth/login', () => {
    it('should authenticate single photographer with valid credentials and set HttpOnly session cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'photographer@studiolumina.photo',
          password: TEST_PASSWORD,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.photographer).toBeDefined();
      expect(res.body.data.photographer.id).toBe(1);
      expect(res.body.data.photographer.email).toBe('photographer@studiolumina.photo');
      expect(res.body.data.photographer.businessName).toBe('Studio Lumina');
      expect(res.body.data.photographer.password_hash).toBeUndefined(); // NEVER expose hash

      // Verify Set-Cookie header contains studio_session
      const setCookie = res.header['set-cookie'];
      expect(setCookie).toBeDefined();
      const sessionCookie = Array.isArray(setCookie)
        ? setCookie.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
        : setCookie;
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('Path=/');
    });

    it('should accept email case-insensitively with leading/trailing whitespace', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: '  PHOTOGRAPHER@StudioLumina.photo  ',
          password: TEST_PASSWORD,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photographer.email).toBe('photographer@studiolumina.photo');
    });

    it('should reject invalid password with generic 401 error to prevent enumeration', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'photographer@studiolumina.photo',
          password: 'WrongPassword999!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      expect(res.body.error.message).toBe('Invalid email or password');
      expect(res.header['set-cookie']).toBeUndefined();
    });

    it('should reject nonexistent email with identical generic 401 error to prevent enumeration', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nobody@studiolumina.photo',
          password: TEST_PASSWORD,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      expect(res.body.error.message).toBe('Invalid email or password');
      expect(res.header['set-cookie']).toBeUndefined();
    });

    it('should reject malformed body with 400 validation error', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'not-an-email',
          password: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return photographer profile when authenticated via session cookie', async () => {
      const token = signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photographer.id).toBe(1);
      expect(res.body.data.photographer.email).toBe('photographer@studiolumina.photo');
      expect(res.body.data.photographer.businessName).toBe('Studio Lumina');
    });

    it('should return photographer profile when authenticated via Bearer token header', async () => {
      const token = signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photographer.id).toBe(1);
    });

    it('should reject unauthenticated request with 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should reject forged or invalid session token with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=forged_session_token_value`]);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('PUT /api/auth/password', () => {
    it('should successfully change password, update hash, and issue new session cookie', async () => {
      const token = signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' });
      const NEW_PASSWORD = 'NewBrandSecurePassword2026!';

      const res = await request(app)
        .put('/api/auth/password')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`])
        .send({
          currentPassword: TEST_PASSWORD,
          newPassword: NEW_PASSWORD,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.header['set-cookie']).toBeDefined();

      // Verify that login now works with NEW password and fails with OLD password
      const newLoginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'photographer@studiolumina.photo',
          password: NEW_PASSWORD,
        });
      expect(newLoginRes.status).toBe(200);

      const oldLoginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'photographer@studiolumina.photo',
          password: TEST_PASSWORD,
        });
      expect(oldLoginRes.status).toBe(401);
    });

    it('should reject password change with incorrect current password', async () => {
      const token = signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' });

      const res = await request(app)
        .put('/api/auth/password')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`])
        .send({
          currentPassword: 'IncorrectCurrentPassword123!',
          newPassword: 'SomeNewPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Current password is incorrect');
    });

    it('should reject password change with weak new password (less than 10 characters)', async () => {
      const token = signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' });

      const res = await request(app)
        .put('/api/auth/password')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`])
        .send({
          currentPassword: TEST_PASSWORD,
          newPassword: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear session cookie and return 200', async () => {
      const token = signSessionToken({ id: 1, email: 'photographer@studiolumina.photo' });

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const setCookie = res.header['set-cookie'];
      expect(setCookie).toBeDefined();
      const sessionCookie = Array.isArray(setCookie)
        ? setCookie.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
        : setCookie;
      expect(sessionCookie).toBeDefined();
      // Verifies cookie is expired/cleared (Max-Age=0 or past date)
      expect(sessionCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
    });
  });
});
