import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IMemoryDb } from 'pg-mem';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
} from '../helpers/db_test_helper.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { createApp } from '../../apps/api/src/app.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import { revokeEventGuestSessions, hashToken } from '../../apps/api/src/services/guestSessionService.js';

describe('Phase 18: Guest PIN Protection & Temporary Sessions Integration Tests', () => {
  let db: IMemoryDb;
  let app: any;

  const eventA = 'a0000000-0000-0000-0000-000000000001';
  const eventB = 'b0000000-0000-0000-0000-000000000002';
  const eventUnprotected = 'c0000000-0000-0000-0000-000000000003';
  const eventMisconfigured = 'd0000000-0000-0000-0000-000000000004';

  const correctPinA = '004271'; // Leading zero test
  const correctPinB = '987654';

  beforeEach(() => {
    resetPinRateLimiterStore();
    db = createTestDatabase();

    // Create Pool Adapter
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
    insertTestPhotographer(db, { id: 1 });

    const pinHashA = bcrypt.hashSync(correctPinA, 10);
    const pinHashB = bcrypt.hashSync(correctPinB, 10);

    // Event A: PIN Protected
    insertTestEvent(db, {
      id: eventA,
      slug: 'royal-wedding-2026',
      name: 'Royal Wedding 2026',
      status: 'active',
      visibility: 'public',
      pin_enabled: true,
      pin_hash: pinHashA,
    });

    // Event B: PIN Protected with different PIN
    insertTestEvent(db, {
      id: eventB,
      slug: 'coastal-gala-2026',
      name: 'Coastal Gala 2026',
      status: 'active',
      visibility: 'public',
      pin_enabled: true,
      pin_hash: pinHashB,
    });

    // Event C: Unprotected (PIN Disabled)
    insertTestEvent(db, {
      id: eventUnprotected,
      slug: 'open-exhibition-2026',
      name: 'Open Exhibition 2026',
      status: 'active',
      visibility: 'public',
      pin_enabled: false,
      pin_hash: null,
    });

    // Event D: Misconfigured (pin_enabled = true but pin_hash = NULL)
    insertTestEvent(db, {
      id: eventMisconfigured,
      slug: 'broken-event-2026',
      name: 'Broken Event 2026',
      status: 'active',
      visibility: 'public',
      pin_enabled: true,
      pin_hash: null,
    });

    // Insert folders & media for Event A
    const folderA1 = 'f0000000-0000-0000-0000-000000000001';
    insertTestFolder(db, { id: folderA1, event_id: eventA, name: 'Ceremony' });
    insertTestMedia(db, {
      id: '10000000-0000-0000-0000-000000000001',
      event_id: eventA,
      folder_id: folderA1,
      status: 'ready',
      filename: 'ceremony_01.jpg',
    });

    // Insert folders & media for Event B
    const folderB1 = 'f0000000-0000-0000-0000-000000000002';
    insertTestFolder(db, { id: folderB1, event_id: eventB, name: 'Reception' });
    insertTestMedia(db, {
      id: '20000000-0000-0000-0000-000000000002',
      event_id: eventB,
      folder_id: folderB1,
      status: 'ready',
      filename: 'reception_01.jpg',
    });
  });

  afterEach(() => {
    resetPinRateLimiterStore();
  });

  it('1. UNPROTECTED EVENT: Resolves and allows gallery access without PIN', async () => {
    const metaRes = await request(app)
      .get('/api/guest/event/open-exhibition-2026')
      .expect(200);

    expect(metaRes.body.data.event.pin_protected).toBe(false);
    expect(metaRes.body.data.event.pin_hash).toBeUndefined();

    const galleryRes = await request(app)
      .get('/api/guest/gallery/open-exhibition-2026')
      .expect(200);

    expect(galleryRes.body.success).toBe(true);
    expect(Array.isArray(galleryRes.body.data.folders)).toBe(true);
  });

  it('2. PROTECTED EVENT METADATA: Discloses pin_protected = true without leaking pin_hash', async () => {
    const res = await request(app)
      .get('/api/guest/event/royal-wedding-2026')
      .expect(200);

    expect(res.body.data.event.pin_protected).toBe(true);
    expect(res.body.data.event.pin_hash).toBeUndefined();
    expect(res.body.data.event.name).toBe('Royal Wedding 2026');
  });

  it('3. PROTECTED EVENT REJECTION: Requesting gallery without token fails with 401 EVENT_PIN_REQUIRED', async () => {
    const res = await request(app)
      .get('/api/guest/gallery/royal-wedding-2026')
      .expect(401);

    expect(res.body.error.code).toBe('EVENT_PIN_REQUIRED');
  });

  it('4. INCORRECT PIN: Submitting wrong PIN fails with 401 INVALID_EVENT_PIN', async () => {
    const res = await request(app)
      .post('/api/guest/verify-pin/royal-wedding-2026')
      .send({ pin: '999999' })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_EVENT_PIN');
  });

  it('5. BRUTE FORCE RATE LIMITING: 5 failed attempts locks out client with 429 PIN_RATE_LIMITED', async () => {
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post('/api/guest/verify-pin/royal-wedding-2026')
        .send({ pin: '111111' })
        .expect(401);
    }

    // 5th attempt locks out
    const lockoutRes = await request(app)
      .post('/api/guest/verify-pin/royal-wedding-2026')
      .send({ pin: '111111' })
      .expect(429);

    expect(lockoutRes.body.error.code).toBe('PIN_RATE_LIMITED');
    expect(lockoutRes.headers['retry-after']).toBeDefined();

    // Even with the correct PIN, requests during lockout are rejected
    await request(app)
      .post('/api/guest/verify-pin/royal-wedding-2026')
      .send({ pin: correctPinA })
      .expect(429);
  });

  it('6. SUCCESSFUL PIN VERIFICATION: Issues session token, sets cookie, and records in PostgreSQL', async () => {
    const res = await request(app)
      .post('/api/guest/verify-pin/royal-wedding-2026')
      .send({ pin: correctPinA }) // '004271' with leading zero
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.guestToken).toBeDefined();
    expect(res.body.data.eventId).toBe(eventA);

    // Verify Set-Cookie header contains HttpOnly session cookie
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some((c: string) => c.includes(`guest_session_${eventA}`))).toBe(true);

    // Verify record in PostgreSQL guest_sessions table
    const token = res.body.data.guestToken;
    const tokenHash = hashToken(token);

    const rows = db.public.many(
      `SELECT id, event_id, token_hash FROM guest_sessions WHERE token_hash = '${tokenHash}'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].event_id).toBe(eventA);
  });

  it('7. AUTHORIZED GALLERY ACCESS: Guest token unlocks protected gallery media and folders', async () => {
    const authRes = await request(app)
      .post('/api/guest/verify-pin/royal-wedding-2026')
      .send({ pin: correctPinA })
      .expect(200);

    const guestToken = authRes.body.data.guestToken;

    // Use X-Guest-Token header
    const galleryRes = await request(app)
      .get('/api/guest/gallery/royal-wedding-2026')
      .set('X-Guest-Token', guestToken)
      .expect(200);

    expect(galleryRes.body.success).toBe(true);
    expect(galleryRes.body.data.folders.length).toBe(1);
    expect(galleryRes.body.data.media.length).toBe(1);
    expect(galleryRes.body.data.media[0].filename).toBe('ceremony_01.jpg');
  });

  it('8. CROSS-EVENT ISOLATION: Token for Event A CANNOT access Event B', async () => {
    const authResA = await request(app)
      .post('/api/guest/verify-pin/royal-wedding-2026')
      .send({ pin: correctPinA })
      .expect(200);

    const guestTokenA = authResA.body.data.guestToken;

    // Attempt to access Event B with Event A's token
    const crossRes = await request(app)
      .get('/api/guest/gallery/coastal-gala-2026')
      .set('X-Guest-Token', guestTokenA)
      .expect(401);

    expect(crossRes.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('9. FAIL-CLOSED BEHAVIOR: Event with pin_enabled = true but NULL pin_hash returns 403 PIN_CONFIGURATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/guest/verify-pin/broken-event-2026')
      .send({ pin: '123456' })
      .expect(403);

    expect(res.body.error.code).toBe('PIN_CONFIGURATION_ERROR');

    // Direct gallery access also fails closed
    await request(app)
      .get('/api/guest/gallery/broken-event-2026')
      .expect(403);
  });

  it('10. SESSION REVOCATION: Changing or revoking PIN invalidates previously issued guest sessions', async () => {
    const authRes = await request(app)
      .post('/api/guest/verify-pin/royal-wedding-2026')
      .send({ pin: correctPinA })
      .expect(200);

    const guestToken = authRes.body.data.guestToken;

    // Verify token works
    await request(app)
      .get('/api/guest/gallery/royal-wedding-2026')
      .set('X-Guest-Token', guestToken)
      .expect(200);

    // Photographer changes PIN / revokes sessions for Event A
    await revokeEventGuestSessions(eventA);

    // Previously authorized token must now be rejected
    const revokedRes = await request(app)
      .get('/api/guest/gallery/royal-wedding-2026')
      .set('X-Guest-Token', guestToken)
      .expect(401);

    expect(revokedRes.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('11. EXPLICIT SESSION CLEAR: Guest logout revokes session and clears cookie', async () => {
    const authRes = await request(app)
      .post('/api/guest/verify-pin/royal-wedding-2026')
      .send({ pin: correctPinA })
      .expect(200);

    const guestToken = authRes.body.data.guestToken;

    // Call session clear
    const clearRes = await request(app)
      .post(`/api/guest/session/clear/${eventA}`)
      .set('X-Guest-Token', guestToken)
      .expect(200);

    expect(clearRes.body.success).toBe(true);

    // Token is now revoked from DB
    await request(app)
      .get('/api/guest/gallery/royal-wedding-2026')
      .set('X-Guest-Token', guestToken)
      .expect(401);
  });
});
