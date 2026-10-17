import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { createTestDatabase } from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { clearMemoryRateLimitStore } from '../../apps/api/src/middleware/rateLimiter.js';

describe('Dashboard Flow & Authenticated Lifecycle Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'DashboardMasterPassword2026!';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  });

  beforeEach(() => {
    clearMemoryRateLimitStore();

    db = createTestDatabase();
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'owner@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography');`
    );

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  it('Step 1: Dashboard access without session must be rejected with 401 UNAUTHORIZED', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('Step 2: Photographer logs in, receives session cookie and hydrates dashboard profile', async () => {
    // 1. Authenticate
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'owner@studiolumina.photo',
        password: TEST_PASSWORD,
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.photographer.businessName).toBe('Studio Lumina');
    expect(loginRes.body.data.photographer.email).toBe('owner@studiolumina.photo');

    const cookies = loginRes.header['set-cookie'];
    expect(cookies).toBeDefined();
    const sessionCookie = Array.isArray(cookies)
      ? cookies.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : cookies;
    expect(sessionCookie).toBeDefined();

    // Extract cookie value for subsequent authenticated calls
    const cookieHeader = sessionCookie.split(';')[0];

    // 2. Hydrate dashboard profile (/api/auth/me)
    const profileRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [cookieHeader]);

    expect(profileRes.status).toBe(200);
    expect(profileRes.body.success).toBe(true);
    expect(profileRes.body.data.photographer.id).toBe(1);
    expect(profileRes.body.data.photographer.businessName).toBe('Studio Lumina');
    expect(profileRes.body.data.photographer.password_hash).toBeUndefined();

    // 3. Subsystem Health Diagnostics (/api/health) used by dashboard SystemHealthCard
    const healthRes = await request(app).get('/health/live');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');

    // 4. Change password from Studio Settings (/api/auth/password)
    const NEW_PASSWORD = 'BrandNewMasterPassword2026!';
    const changePassRes = await request(app)
      .put('/api/auth/password')
      .set('Cookie', [cookieHeader])
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      });

    expect(changePassRes.status).toBe(200);
    expect(changePassRes.body.success).toBe(true);
    expect(changePassRes.header['set-cookie']).toBeDefined();

    // 5. Sign out from Dashboard account menu (/api/auth/logout)
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [cookieHeader]);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    const clearedCookie = logoutRes.header['set-cookie'];
    expect(clearedCookie).toBeDefined();
  });
});
