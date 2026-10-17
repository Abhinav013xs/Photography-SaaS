import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,

  insertTestMedia,
} from '../helpers/db_test_helper.js';

describe('Phase 19: Public / Private Gallery System Integration Tests', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof createTestDatabase>;
  let authCookie: string;

  const eventPublicNoPin = '10000000-0000-0000-0000-000000000001';
  const eventPublicPin = '20000000-0000-0000-0000-000000000002';
  const eventPrivateNoPin = '30000000-0000-0000-0000-000000000003';
  const eventPrivatePin = '40000000-0000-0000-0000-000000000004';

  const testPin = '123456';
  const pinHash = bcrypt.hashSync(testPin, 10);

  beforeEach(() => {
    resetPinRateLimiterStore();
    db = createTestDatabase();

    const poolMock: any = {
      query: async (text: string, params: any[] = []) => {
        let sql = text;
        if (params && params.length > 0) {
          params.forEach((p, idx) => {
            const placeholder = new RegExp(`\\$${idx + 1}(?![0-9])`, 'g');
            if (p === null || p === undefined) {
              sql = sql.replace(placeholder, 'NULL');
            } else if (typeof p === 'number') {
              sql = sql.replace(placeholder, String(p));
            } else if (typeof p === 'boolean') {
              sql = sql.replace(placeholder, p ? 'TRUE' : 'FALSE');
            } else if (p instanceof Date) {
              sql = sql.replace(placeholder, `'${p.toISOString()}'`);
            } else {
              sql = sql.replace(placeholder, `'${String(p).replace(/'/g, "''")}'`);
            }
          });
        }
        try {
          const res = db.public.query(sql);
          return { rows: res.rows || [], rowCount: res.rowCount || 0 };
        } catch (err: any) {
          throw err;
        }
      },
    };

    setDatabasePool(poolMock);
    app = createApp();

    // Seed Photographer
    insertTestPhotographer(db, { id: 1, email: 'studio@lumina.com' });
    const token = signSessionToken({ id: 1, email: 'studio@lumina.com' });
    authCookie = `${SESSION_COOKIE_NAME}=${token}`;

    // Event 1: Public, No PIN
    insertTestEvent(db, {
      id: eventPublicNoPin,
      slug: 'public-no-pin-2026',
      name: 'Public Open Exhibition',
      status: 'active',
      visibility: 'public',
      pin_enabled: false,
      pin_hash: null,
    });

    // Event 2: Public, PIN Enabled
    insertTestEvent(db, {
      id: eventPublicPin,
      slug: 'public-pin-2026',
      name: 'Public PIN Protected Wedding',
      status: 'active',
      visibility: 'public',
      pin_enabled: true,
      pin_hash: pinHash,
    });

    // Event 3: Private, No PIN
    insertTestEvent(db, {
      id: eventPrivateNoPin,
      slug: 'private-no-pin-2026',
      name: 'Private Corporate Gala',
      status: 'active',
      visibility: 'private',
      pin_enabled: false,
      pin_hash: null,
    });

    // Event 4: Private, PIN Enabled
    insertTestEvent(db, {
      id: eventPrivatePin,
      slug: 'private-pin-2026',
      name: 'Private VIP Ceremony',
      status: 'active',
      visibility: 'private',
      pin_enabled: true,
      pin_hash: pinHash,
    });

    // Seed media for events
    insertTestMedia(db, {
      id: '50000000-0000-0000-0000-000000000001',
      event_id: eventPublicNoPin,
      status: 'ready',
      filename: 'open_01.jpg',
    });
    insertTestMedia(db, {
      id: '50000000-0000-0000-0000-000000000002',
      event_id: eventPublicPin,
      status: 'ready',
      filename: 'wedding_01.jpg',
    });
    insertTestMedia(db, {
      id: '50000000-0000-0000-0000-000000000003',
      event_id: eventPrivateNoPin,
      status: 'ready',
      filename: 'private_01.jpg',
    });
    insertTestMedia(db, {
      id: '50000000-0000-0000-0000-000000000004',
      event_id: eventPrivatePin,
      status: 'ready',
      filename: 'vip_01.jpg',
    });
  });

  describe('Scenario A: Public, No PIN', () => {
    it('should allow guest to view metadata and media for public unprotected event', async () => {
      // 1. Metadata
      const metaRes = await request(app).get('/api/guest/event/public-no-pin-2026');
      expect(metaRes.status).toBe(200);
      expect(metaRes.body.success).toBe(true);
      expect(metaRes.body.data.event.name).toBe('Public Open Exhibition');
      expect(metaRes.body.data.event.visibility).toBe('public');
      expect(metaRes.body.data.event.pin_protected).toBe(false);

      // 2. Gallery media
      const galRes = await request(app).get('/api/guest/gallery/public-no-pin-2026');
      expect(galRes.status).toBe(200);
      expect(galRes.body.success).toBe(true);
      expect(galRes.body.data.media).toHaveLength(1);
      expect(galRes.body.data.media[0].filename).toBe('open_01.jpg');
    });
  });

  describe('Scenario B: Public, PIN Enabled', () => {
    it('should require PIN verification for public protected event and grant access on valid PIN', async () => {
      // 1. Metadata reveals PIN is required
      const metaRes = await request(app).get('/api/guest/event/public-pin-2026');
      expect(metaRes.status).toBe(200);
      expect(metaRes.body.data.event.pin_protected).toBe(true);

      // 2. Gallery access without PIN returns 401
      const galRes1 = await request(app).get('/api/guest/gallery/public-pin-2026');
      expect(galRes1.status).toBe(401);
      expect(galRes1.body.error.code).toBe('EVENT_PIN_REQUIRED');

      // 3. Verify PIN
      const pinRes = await request(app)
        .post('/api/guest/verify-pin/public-pin-2026')
        .send({ pin: testPin });
      expect(pinRes.status).toBe(200);
      const guestToken = pinRes.body.data.guestToken;
      expect(guestToken).toBeDefined();

      // 4. Access gallery with token
      const galRes2 = await request(app)
        .get('/api/guest/gallery/public-pin-2026')
        .set('x-guest-token', guestToken);
      expect(galRes2.status).toBe(200);
      expect(galRes2.body.data.media).toHaveLength(1);
    });
  });

  describe('Scenario C: Private, No PIN', () => {
    it('should deny guest access to private event metadata and gallery', async () => {
      // 1. Metadata is denied
      const metaRes = await request(app).get('/api/guest/event/private-no-pin-2026');
      expect(metaRes.status).toBe(403);
      expect(metaRes.body.error.message).toContain('private');

      // 2. Gallery is denied
      const galRes = await request(app).get('/api/guest/gallery/private-no-pin-2026');
      expect(galRes.status).toBe(403);
      expect(galRes.body.error.message).toContain('private');
    });
  });

  describe('Scenario D: Private, PIN Enabled', () => {
    it('should deny guest access even if event has PIN protection and PIN is known', async () => {
      // 1. Metadata is denied
      const metaRes = await request(app).get('/api/guest/event/private-pin-2026');
      expect(metaRes.status).toBe(403);
      expect(metaRes.body.error.message).toContain('private');

      // 2. Submitting correct PIN is rejected immediately (PIN never overrides private visibility)
      const pinRes = await request(app)
        .post('/api/guest/verify-pin/private-pin-2026')
        .send({ pin: testPin });
      expect(pinRes.status).toBe(403);
      expect(pinRes.body.error.message).toContain('private');

      // 3. Gallery is denied
      const galRes = await request(app).get('/api/guest/gallery/private-pin-2026');
      expect(galRes.status).toBe(403);
      expect(galRes.body.error.message).toContain('private');
    });
  });

  describe('Scenario E: Revocation of In-Flight Guest Access', () => {
    it('should immediately eject guest when photographer changes event to private and revoke DB sessions', async () => {
      // 1. Guest verifies PIN on public event
      const pinRes = await request(app)
        .post('/api/guest/verify-pin/public-pin-2026')
        .send({ pin: testPin });
      expect(pinRes.status).toBe(200);
      const guestToken = pinRes.body.data.guestToken;

      // 2. Guest can access gallery
      const galRes1 = await request(app)
        .get('/api/guest/gallery/public-pin-2026')
        .set('x-guest-token', guestToken);
      expect(galRes1.status).toBe(200);

      // Verify guest session exists in DB
      const sessionsBefore = db.public.query(
        `SELECT COUNT(*)::int as count FROM guest_sessions WHERE event_id = '${eventPublicPin}'`
      );
      expect(sessionsBefore.rows[0].count).toBe(1);

      // 3. Photographer changes visibility to private
      const patchRes = await request(app)
        .patch(`/api/events/${eventPublicPin}/visibility`)
        .set('Cookie', [authCookie])
        .send({ visibility: 'private' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.event.visibility).toBe('private');

      // 4. Guest attempts to access gallery with previous token -> 403 Forbidden!
      const galRes2 = await request(app)
        .get('/api/guest/gallery/public-pin-2026')
        .set('x-guest-token', guestToken);
      expect(galRes2.status).toBe(403);
      expect(galRes2.body.error.message).toContain('private');

      // 5. Database session was purged
      const sessionsAfter = db.public.query(
        `SELECT COUNT(*)::int as count FROM guest_sessions WHERE event_id = '${eventPublicPin}'`
      );
      expect(sessionsAfter.rows[0].count).toBe(0);
    });
  });

  describe('Scenario F: Return to Public', () => {
    it('should restore public access when event is returned to public while preserving PIN configuration', async () => {
      // 1. Start private PIN event
      const metaRes1 = await request(app).get('/api/guest/event/private-pin-2026');
      expect(metaRes1.status).toBe(403);

      // 2. Photographer makes it public
      const patchRes = await request(app)
        .patch(`/api/events/${eventPrivatePin}/visibility`)
        .set('Cookie', [authCookie])
        .send({ visibility: 'public' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.event.visibility).toBe('public');
      expect(patchRes.body.data.event.pin_enabled).toBe(true); // PIN preserved!

      // 3. Guest can now view metadata and sees PIN is required
      const metaRes2 = await request(app).get('/api/guest/event/private-pin-2026');
      expect(metaRes2.status).toBe(200);
      expect(metaRes2.body.data.event.pin_protected).toBe(true);

      // 4. Guest enters PIN and accesses gallery
      const pinRes = await request(app)
        .post('/api/guest/verify-pin/private-pin-2026')
        .send({ pin: testPin });
      expect(pinRes.status).toBe(200);

      const galRes = await request(app)
        .get('/api/guest/gallery/private-pin-2026')
        .set('x-guest-token', pinRes.body.data.guestToken);
      expect(galRes.status).toBe(200);
      expect(galRes.body.data.media).toHaveLength(1);
      expect(galRes.body.data.media[0].filename).toBe('vip_01.jpg'); // Media perfectly preserved!
    });
  });

  describe('Photographer Access & Ownership Preservation', () => {
    it('should allow photographer to view and manage private event details', async () => {
      const getRes = await request(app)
        .get(`/api/events/${eventPrivateNoPin}`)
        .set('Cookie', [authCookie]);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.event.name).toBe('Private Corporate Gala');
      expect(getRes.body.data.event.visibility).toBe('private');
    });

    it('should reject unauthenticated caller from changing event visibility', async () => {
      const res = await request(app)
        .patch(`/api/events/${eventPublicNoPin}/visibility`)
        .send({ visibility: 'private' });
      expect(res.status).toBe(401);
    });

    it('should reject invalid visibility values on PATCH /api/events/:id/visibility', async () => {
      const res = await request(app)
        .patch(`/api/events/${eventPublicNoPin}/visibility`)
        .set('Cookie', [authCookie])
        .send({ visibility: 'unlisted' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject non-existent event ID with 404', async () => {
      const res = await request(app)
        .patch('/api/events/99999999-9999-9999-9999-999999999999/visibility')
        .set('Cookie', [authCookie])
        .send({ visibility: 'private' });
      expect(res.status).toBe(404);
    });
  });
});
