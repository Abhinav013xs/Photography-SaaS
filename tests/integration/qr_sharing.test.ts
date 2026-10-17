import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { createTestDatabase } from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { clearMemoryRateLimitStore } from '../../apps/api/src/middleware/rateLimiter.js';

describe('Phase 23: QR Code & Gallery Sharing Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'QrSharingPassword2026!';
  let authCookie: string;
  let otherAuthCookie: string;

  const EVENT_1_ID = '11111111-1111-1111-1111-111111111111';
  const EVENT_2_PIN_ID = '22222222-2222-2222-2222-222222222222';
  const EVENT_3_PRIVATE_ID = '33333333-3333-3333-3333-333333333333';
  const EVENT_4_EXPIRED_ID = '44444444-4444-4444-4444-444444444444';
  const OTHER_OWNER_EVENT_ID = '99999999-9999-9999-9999-999999999999';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const pinHash = await bcrypt.hash('5555', 10);

    db = createTestDatabase();

    // Seed Photographer 1 (primary owner) and Photographer 2 (for IDOR tests)
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES 
       (1, 'primary@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography'),
       (2, 'other@studiolumina.photo', '${passwordHash}', 'Other Studio', 'Commercial');`
    );

    // Seed Events
    const now = new Date();
    const futureDate = new Date(now.getTime() + 15 * 86400000).toISOString();
    const pastDate = new Date(now.getTime() - 2 * 86400000).toISOString();

    // Event 1: Public, no PIN
    db.public.none(`
      INSERT INTO events (id, owner_id, slug, name, client_name, event_date, status, visibility, pin_enabled, public_start, public_until)
      VALUES ('${EVENT_1_ID}', 1, 'autumn-wedding-2026', 'Autumn Wedding', 'Sarah & Tom', '2026-10-15', 'active', 'public', FALSE, '${now.toISOString()}', '${futureDate}');
    `);

    // Event 2: Public, with PIN (5555)
    db.public.none(`
      INSERT INTO events (id, owner_id, slug, name, client_name, event_date, status, visibility, pin_enabled, pin_hash, public_start, public_until)
      VALUES ('${EVENT_2_PIN_ID}', 1, 'vip-soiree-2026', 'VIP Soiree', 'Executive Club', '2026-10-20', 'active', 'public', TRUE, '${pinHash}', '${now.toISOString()}', '${futureDate}');
    `);

    // Event 3: Private
    db.public.none(`
      INSERT INTO events (id, owner_id, slug, name, client_name, event_date, status, visibility, pin_enabled)
      VALUES ('${EVENT_3_PRIVATE_ID}', 1, 'private-draft-2026', 'Private Studio Shoot', 'Exclusive Client', '2026-10-25', 'draft', 'private', FALSE);
    `);

    // Event 4: Expired
    db.public.none(`
      INSERT INTO events (id, owner_id, slug, name, client_name, event_date, status, visibility, pin_enabled, public_start, public_until, expired_at)
      VALUES ('${EVENT_4_EXPIRED_ID}', 1, 'vintage-gala-2026', 'Vintage Gala', 'Historic Society', '2026-09-01', 'active', 'public', FALSE, '${pastDate}', '${pastDate}', '${pastDate}');
    `);

    // Event 5: Owned by Photographer 2
    db.public.none(`
      INSERT INTO events (id, owner_id, slug, name, client_name, event_date, status, visibility, pin_enabled)
      VALUES ('${OTHER_OWNER_EVENT_ID}', 2, 'other-owner-event', 'Other Event', 'Client B', '2026-10-10', 'active', 'public', FALSE);
    `);

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);

    // Login Photographer 1
    const login1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'primary@studiolumina.photo', password: TEST_PASSWORD });
    const rawCookies1 = login1.header['set-cookie'];
    const c1 = Array.isArray(rawCookies1)
      ? rawCookies1.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : rawCookies1;
    authCookie = c1.split(';')[0];

    // Login Photographer 2
    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'other@studiolumina.photo', password: TEST_PASSWORD });
    const rawCookies2 = login2.header['set-cookie'];
    const c2 = Array.isArray(rawCookies2)
      ? rawCookies2.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : rawCookies2;
    otherAuthCookie = c2.split(';')[0];
  });

  afterAll(() => {
    setDatabasePool(null);
  });

  beforeEach(() => {
    clearMemoryRateLimitStore();
  });

  describe('Authentication & IDOR Boundary Guard', () => {
    it('should reject unauthenticated GET /api/events/:id/qr with 401', async () => {
      const res = await request(app).get(`/api/events/${EVENT_1_ID}/qr`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should reject non-UUID event ID with 400 validation error', async () => {
      const res = await request(app)
        .get('/api/events/not-a-valid-uuid/qr')
        .set('Cookie', [authCookie]);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when requesting a non-existent event UUID', async () => {
      const res = await request(app)
        .get('/api/events/00000000-0000-0000-0000-000000000000/qr')
        .set('Cookie', [authCookie]);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('should prevent cross-photographer IDOR: Photographer 1 cannot access Photographer 2 event QR', async () => {
      const res = await request(app)
        .get(`/api/events/${OTHER_OWNER_EVENT_ID}/qr`)
        .set('Cookie', [authCookie]); // Authenticated as Photographer 1
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });
  });

  describe('QR Generation for Public Open Gallery', () => {
    it('should generate canonical URL, PNG, and SVG for Event 1', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_1_ID}/qr`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.shareUrl).toBe('http://localhost:3000/gallery/autumn-wedding-2026');
      expect(data.eventName).toBe('Autumn Wedding');
      expect(data.clientName).toBe('Sarah & Tom');
      expect(data.pinProtected).toBe(false);
      expect(data.visibility).toBe('public');
      expect(data.isExpired).toBe(false);
      expect(data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(data.qrSvg).toContain('<svg');
      expect(data.qrSvg).not.toContain('<script');

      // Decode the PNG to verify actual QR payload matches shareUrl
      const base64Data = data.qrDataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const png = PNG.sync.read(buffer);
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

      expect(decoded).not.toBeNull();
      expect(decoded?.data).toBe(data.shareUrl);
    });

    it('should allow guest to open canonical gallery route directly for Event 1', async () => {
      const guestRes = await request(app).get('/api/guest/event/autumn-wedding-2026');
      expect(guestRes.status).toBe(200);
      expect(guestRes.body.success).toBe(true);
      expect(guestRes.body.data.event.name).toBe('Autumn Wedding');
      expect(guestRes.body.data.event.pin_protected).toBe(false);
    });
  });

  describe('QR Generation for PIN-Protected Event', () => {
    it('should generate QR code that does NOT leak the PIN in URL or payload', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_2_PIN_ID}/qr`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      const data = res.body.data;

      expect(data.shareUrl).toBe('http://localhost:3000/gallery/vip-soiree-2026');
      expect(data.pinProtected).toBe(true);

      // Verify PIN '5555' is not leaked anywhere in shareUrl, qrSvg, or decoded QR
      expect(data.shareUrl).not.toContain('5555');
      expect(data.shareUrl).not.toContain('pin');
      expect(data.qrSvg).not.toContain('5555');

      const base64Data = data.qrDataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const png = PNG.sync.read(buffer);
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

      expect(decoded?.data).toBe('http://localhost:3000/gallery/vip-soiree-2026');
      expect(decoded?.data).not.toContain('5555');
    });

    it('should enforce PIN gate when guest follows the QR link to Event 2', async () => {
      // Guest resolves metadata: informed that PIN is required
      const guestRes = await request(app).get('/api/guest/event/vip-soiree-2026');
      expect(guestRes.status).toBe(200);
      expect(guestRes.body.data.event.pin_protected).toBe(true);

      // Guest trying to fetch gallery photos without PIN is blocked (401)
      const galleryRes = await request(app).get('/api/guest/gallery/vip-soiree-2026');
      expect(galleryRes.status).toBe(401);
      expect(galleryRes.body.error.code).toBe('EVENT_PIN_REQUIRED');
    });
  });

  describe('QR Generation for Private Event', () => {
    it('should generate QR for preparation in dashboard while marking visibility as private', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_3_PRIVATE_ID}/qr`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.data.visibility).toBe('private');
      expect(res.body.data.shareUrl).toBe('http://localhost:3000/gallery/private-draft-2026');
    });

    it('should reject guest attempting to access private gallery via canonical link', async () => {
      const guestRes = await request(app).get('/api/guest/event/private-draft-2026');
      expect(guestRes.status).toBe(403);
      expect(guestRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('QR Generation for Expired Event', () => {
    it('should flag isExpired in QR metadata when public duration has elapsed', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_4_EXPIRED_ID}/qr`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.data.isExpired).toBe(true);
      expect(res.body.data.shareUrl).toBe('http://localhost:3000/gallery/vintage-gala-2026');
    });

    it('should deny guest access with 410 GALLERY_EXPIRED when following link', async () => {
      const guestRes = await request(app).get('/api/guest/event/vintage-gala-2026');
      expect(guestRes.status).toBe(410);
      expect(guestRes.body.error.code).toBe('GALLERY_EXPIRED');
    });
  });

  describe('Event Isolation', () => {
    it('should ensure Event 1 and Event 2 generate completely isolated URLs and QR payloads', async () => {
      const res1 = await request(app).get(`/api/events/${EVENT_1_ID}/qr`).set('Cookie', [authCookie]);
      const res2 = await request(app).get(`/api/events/${EVENT_2_PIN_ID}/qr`).set('Cookie', [authCookie]);

      expect(res1.body.data.shareUrl).not.toBe(res2.body.data.shareUrl);
      expect(res1.body.data.qrDataUrl).not.toBe(res2.body.data.qrDataUrl);
      expect(res1.body.data.qrSvg).not.toBe(res2.body.data.qrSvg);
    });
  });
});
