import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { createTestDatabase } from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { clearMemoryRateLimitStore } from '../../apps/api/src/middleware/rateLimiter.js';

describe('Events Domain REST API Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'EventMasterPassword2026!';
  let authCookie: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    db = createTestDatabase();
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography');`
    );

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);

    // Obtain authenticated photographer session cookie
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'photographer@studiolumina.photo',
        password: TEST_PASSWORD,
      });

    const rawCookies = loginRes.header['set-cookie'];
    const sessionCookie = Array.isArray(rawCookies)
      ? rawCookies.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : rawCookies;

    authCookie = sessionCookie.split(';')[0];
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  beforeEach(() => {
    clearMemoryRateLimitStore();
  });

  describe('Authentication & IDOR Boundary Guard', () => {
    it('should reject unauthenticated GET /api/events with 401', async () => {
      const res = await request(app).get('/api/events');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should reject unauthenticated POST /api/events with 401', async () => {
      const res = await request(app)
        .post('/api/events')
        .send({
          name: 'Unauthorized Wedding',
          client_name: 'Test Client',
          event_date: '2026-10-15',
        });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when requesting a nonexistent event UUID (IDOR defense)', async () => {
      const res = await request(app)
        .get('/api/events/00000000-0000-0000-0000-999999999999')
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });
  });

  describe('Event Creation (POST /api/events)', () => {
    it('should create an event with explicit safe defaults (draft, private, downloads disabled)', async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Ananya & Rahul — Wedding',
          client_name: 'Ananya Sharma',
          client_email: 'ananya@example.com',
          event_date: '2026-11-20',
          location: 'The Oberoi Rajvilas, Jaipur',
          description: 'Three-day traditional royal wedding celebration.',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const event = res.body.data.event;
      expect(event.name).toBe('Ananya & Rahul — Wedding');
      expect(event.slug).toBe('ananya-rahul-wedding');
      expect(event.client_name).toBe('Ananya Sharma');
      expect(event.client_email).toBe('ananya@example.com');
      expect(event.status).toBe('draft');
      expect(event.visibility).toBe('private');
      expect(event.allow_downloads).toBe(false);
      expect(event.pin_enabled).toBe(false);
      expect(event.watermark_enabled).toBe(false);
      expect(event.face_search_enabled).toBe(true);
      // Ensure pin_hash and owner_id are never exposed
      expect(event.pin_hash).toBeUndefined();
      expect(event.owner_id).toBeUndefined();
    });

    it('should handle slug collisions gracefully by appending numeric suffixes', async () => {
      const res1 = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Corporate Summit 2026',
          client_name: 'Global Tech Inc',
          event_date: '2026-12-01',
        });
      expect(res1.status).toBe(201);
      expect(res1.body.data.event.slug).toBe('corporate-summit-2026');

      const res2 = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Corporate Summit 2026',
          client_name: 'Other Client',
          event_date: '2026-12-05',
        });
      expect(res2.status).toBe(201);
      expect(res2.body.data.event.slug).toBe('corporate-summit-2026-2');
    });

    it('should reject event creation if public window exceeds 30 days', async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Overextended Public Gallery',
          client_name: 'Test',
          event_date: '2026-10-10',
          visibility: 'public',
          public_start: '2026-10-01T00:00:00.000Z',
          public_until: '2026-11-15T00:00:00.000Z', // 45 days
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PUBLIC_WINDOW_EXCEEDED');
    });

    it('should configure PIN protection securely with bcrypt hash without leaking it', async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'VIP Private Gala',
          client_name: 'Secret Client',
          event_date: '2026-10-25',
          pin_enabled: true,
          pin: '8492',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const event = res.body.data.event;
      expect(event.pin_enabled).toBe(true);
      expect(event.pin).toBeUndefined();
      expect(event.pin_hash).toBeUndefined();
    });
  });

  describe('Event Listing & Queries (GET /api/events)', () => {
    it('should list events with pagination and filters', async () => {
      const res = await request(app)
        .get('/api/events?limit=10&page=1')
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.events)).toBe(true);
      expect(res.body.data.events.length).toBeGreaterThan(0);
      expect(res.body.meta.total).toBeGreaterThan(0);
      expect(res.body.meta.page).toBe(1);
    });

    it('should filter events by search term matching name or client_name', async () => {
      const res = await request(app)
        .get('/api/events?search=Ananya')
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.events.length).toBe(1);
      expect(res.body.data.events[0].client_name).toBe('Ananya Sharma');
    });
  });

  describe('Event Details & Updates (GET/PATCH /api/events/:id)', () => {
    let testEventId: string;

    beforeAll(async () => {
      const createRes = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Edit Target Event',
          client_name: 'Target Client',
          event_date: '2026-10-30',
        });
      testEventId = createRes.body.data.event.id;
    });

    it('should retrieve full event details by ID', async () => {
      const res = await request(app)
        .get(`/api/events/${testEventId}`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.id).toBe(testEventId);
      expect(res.body.data.event.name).toBe('Edit Target Event');
    });

    it('should partially update event metadata without resetting untouched fields', async () => {
      const res = await request(app)
        .patch(`/api/events/${testEventId}`)
        .set('Cookie', [authCookie])
        .send({
          name: 'Updated Event Title',
          allow_downloads: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const updated = res.body.data.event;
      expect(updated.name).toBe('Updated Event Title');
      expect(updated.allow_downloads).toBe(true);
      // Untouched fields must remain identical
      expect(updated.client_name).toBe('Target Client');
      expect(updated.event_date).toBe('2026-10-30');
    });
  });

  describe('Publication & Visibility Flow (publish / unpublish)', () => {
    let testEventId: string;

    beforeAll(async () => {
      const createRes = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Visibility Test Event',
          client_name: 'Client Vis',
          event_date: '2026-10-12',
        });
      testEventId = createRes.body.data.event.id;
    });

    it('should publish event with 30-day public window and transition visibility to public', async () => {
      const now = new Date();
      const in20Days = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);

      const res = await request(app)
        .post(`/api/events/${testEventId}/publish`)
        .set('Cookie', [authCookie])
        .send({
          public_start: now.toISOString(),
          public_until: in20Days.toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.visibility).toBe('public');
      expect(res.body.data.event.status).toBe('active');
    });

    it('should unpublish event back to private visibility', async () => {
      const res = await request(app)
        .post(`/api/events/${testEventId}/unpublish`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.visibility).toBe('private');
    });
  });

  describe('Lifecycle State Machine (archive / restore)', () => {
    let testEventId: string;

    beforeAll(async () => {
      const createRes = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Archive Lifecycle Event',
          client_name: 'Client Arc',
          event_date: '2026-10-14',
        });
      testEventId = createRes.body.data.event.id;
    });

    it('should archive event and safely privatize it', async () => {
      const res = await request(app)
        .post(`/api/events/${testEventId}/archive`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.status).toBe('archived');
      expect(res.body.data.event.visibility).toBe('private');
    });

    it('should restore archived event back to active status', async () => {
      const res = await request(app)
        .post(`/api/events/${testEventId}/restore`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.status).toBe('active');
    });
  });

  describe('Deliberate Event Deletion (DELETE /api/events/:id)', () => {
    let testEventId: string;

    beforeAll(async () => {
      const createRes = await request(app)
        .post('/api/events')
        .set('Cookie', [authCookie])
        .send({
          name: 'Event To Be Deleted',
          client_name: 'Client Del',
          event_date: '2026-10-18',
        });
      testEventId = createRes.body.data.event.id;
    });

    it('should reject deletion if confirmation name does not match', async () => {
      const res = await request(app)
        .delete(`/api/events/${testEventId}`)
        .set('Cookie', [authCookie])
        .send({
          confirmEventName: 'Wrong Name',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should delete event successfully when confirmation name matches', async () => {
      const res = await request(app)
        .delete(`/api/events/${testEventId}`)
        .set('Cookie', [authCookie])
        .send({
          confirmEventName: 'Event To Be Deleted',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);

      // Subsequent lookup should return 404
      const lookup = await request(app)
        .get(`/api/events/${testEventId}`)
        .set('Cookie', [authCookie]);
      expect(lookup.status).toBe(404);
    });
  });
});
