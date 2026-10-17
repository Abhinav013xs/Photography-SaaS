import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestMedia,
  insertTestStorageUsage,
} from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { clearMemoryRateLimitStore } from '../../apps/api/src/middleware/rateLimiter.js';

describe('Storage Management REST API Integration Tests (Phase 9)', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'StorageOwnerPassword2026!';
  let authCookie: string;

  const EVENT_A_ID = 'e0000000-0000-0000-0000-000000000001';
  const EVENT_B_ID = 'e0000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    db = createTestDatabase();
    // Insert sole photographer (ID = 1)
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography');`
    );

    // Insert events
    insertTestEvent(db, {
      id: EVENT_A_ID,
      owner_id: 1,
      slug: 'wedding-a-2026',
      name: 'Event A — Grand Wedding',
    });

    insertTestEvent(db, {
      id: EVENT_B_ID,
      owner_id: 1,
      slug: 'wedding-b-2026',
      name: 'Event B — Sunset Reception',
    });

    // Seed storage usage for Event A
    insertTestStorageUsage(db, {
      event_id: EVENT_A_ID,
      original_bytes: 20000000,
      preview_bytes: 1500000,
      thumbnail_bytes: 350000,
      video_bytes: 10000000,
      total_bytes: 31850000,
    });

    // Seed media directly for Event B
    insertTestMedia(db, {
      id: '10000000-0000-0000-0000-000000000001',
      event_id: EVENT_B_ID,
      type: 'photo',
      file_size: 8000000,
    });
  });

  beforeEach(async () => {
    pool = db.adapters.createPg().Pool;
    setDatabasePool(new pool());
    clearMemoryRateLimitStore();

    // Authenticate photographer
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'photographer@studiolumina.photo',
        password: TEST_PASSWORD,
      });

    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies?.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(sessionCookie).toBeDefined();
    authCookie = sessionCookie!.split(';')[0];
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  describe('GET /api/storage/usage', () => {
    it('should return 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/storage/usage');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should return 401 when session cookie is invalid or forged', async () => {
      const res = await request(app)
        .get('/api/storage/usage')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=forged.invalid.jwt.token`]);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 200 with accurate measured storage usage for authenticated photographer', async () => {
      const res = await request(app)
        .get('/api/storage/usage')
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data).toBeDefined();

      // Event A (31,850,000) + Event B (8,000,000) = 39,850,000
      expect(data.totalBytes).toBe(39850000);
      expect(data.breakdown.originalPhotosBytes).toBe(28000000); // 20M from A + 8M from B
      expect(data.breakdown.derivedImagesBytes).toBe(1850000); // 1.5M + 350K from A
      expect(data.breakdown.videosBytes).toBe(10000000); // 10M from A

      expect(data.events).toHaveLength(2);
      expect(data.r2).toBeDefined();
      expect(data.r2.managementUrl).toContain('https://dash.cloudflare.com');
      expect(data.r2.billingUrl).toContain('https://dash.cloudflare.com');
      expect(typeof data.isStale).toBe('boolean');
      expect(typeof data.calculatedAt).toBe('string');
    });

    it('should also work on GET /api/storage alias route', async () => {
      const res = await request(app)
        .get('/api/storage')
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalBytes).toBe(39850000);
    });

    it('should never expose sensitive Cloudflare secrets in response body', async () => {
      const res = await request(app)
        .get('/api/storage/usage')
        .set('Cookie', [authCookie]);

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('R2_SECRET_ACCESS_KEY');
      expect(bodyStr).not.toContain('secretAccessKey');
      expect(bodyStr).not.toContain('accessKeyId');
    });

    it('should safely return 500 when database fails without crashing the process', async () => {
      // Simulate broken pool
      setDatabasePool({
        query: () => Promise.reject(new Error('PostgreSQL connection dropped unexpectedly')),
      } as any);

      const res = await request(app)
        .get('/api/storage/usage')
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });
});
