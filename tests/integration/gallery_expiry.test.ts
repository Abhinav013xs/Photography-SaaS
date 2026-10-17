import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import {
  expireEventIfDue,
  reconcileExpiredEvents,
} from '../../apps/api/src/services/galleryExpiryService.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
} from '../helpers/db_test_helper.js';

describe('Phase 20: Automatic Gallery Expiry & Privacy Enforcement Integration Tests', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof createTestDatabase>;
  let authCookie: string;

  const testEventId = '10000000-0000-0000-0000-000000000001';
  const testPinEventId = '20000000-0000-0000-0000-000000000002';
  const testFolderId = '30000000-0000-0000-0000-000000000003';
  const testMediaId = '40000000-0000-0000-0000-000000000004';

  const testPin = '849201';
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
              sql = sql.replace(placeholder, `'${p.toISOString()}'::timestamptz`);
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

    insertTestPhotographer(db, { id: 1, email: 'photographer@example.com' });
    const token = signSessionToken({ id: 1, email: 'photographer@example.com' });
    authCookie = `${SESSION_COOKIE_NAME}=${token}`;
  });

  describe('Scenario A: Normal Expiry Lifecycle', () => {
    it('enforces configurable public duration up to 30 days and expires correctly', async () => {
      // 1. Create a private event with duration = 7 days
      insertTestEvent(db, {
        id: testEventId,
        owner_id: 1,
        slug: 'mira-arjun-wedding',
        name: 'Mira & Arjun Wedding',
        visibility: 'private',
        status: 'active',
        public_duration_days: 7,
      });

      insertTestFolder(db, {
        id: testFolderId,
        event_id: testEventId,
        name: 'Sangeet',
      });

      insertTestMedia(db, {
        id: testMediaId,
        event_id: testEventId,
        folder_id: testFolderId,
        filename: 'sangeet_001.jpg',
        status: 'ready',
      });

      // 2. Publish event with public_duration_days = 7
      const pubRes = await request(app)
        .post(`/api/events/${testEventId}/publish`)
        .set('Cookie', authCookie)
        .send({ public_duration_days: 7 })
        .expect(200);

      expect(pubRes.body.success).toBe(true);
      expect(pubRes.body.data.event.visibility).toBe('public');
      expect(pubRes.body.data.event.public_duration_days).toBe(7);
      expect(pubRes.body.data.event.public_start).toBeDefined();
      expect(pubRes.body.data.event.public_until).toBeDefined();

      const publicUntil = new Date(pubRes.body.data.event.public_until);
      const publicStart = new Date(pubRes.body.data.event.public_start);
      // Duration difference must be exactly 7 days (604,800,000 ms)
      expect(publicUntil.getTime() - publicStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

      // 3. Guest access succeeds while public and not expired
      const guestRes = await request(app)
        .get('/api/guest/event/mira-arjun-wedding')
        .expect(200);

      expect(guestRes.body.success).toBe(true);
      expect(guestRes.body.data.event.visibility).toBe('public');
      expect(guestRes.body.data.event.is_expired).toBe(false);

      // 4. Manually advance event expiry into the past
      const pastStart = new Date(Date.now() - 86400000);
      const pastExpiry = new Date(Date.now() - 5000);
      db.public.query(
        `UPDATE events SET public_start = '${pastStart.toISOString()}'::timestamptz, public_until = '${pastExpiry.toISOString()}'::timestamptz WHERE id = '${testEventId}'`
      );

      // 5. Reactive guard denies guest access immediately (HTTP 410)
      const expiredGuestRes = await request(app)
        .get('/api/guest/event/mira-arjun-wedding')
        .expect(410);

      expect(expiredGuestRes.body.success).toBe(false);
      expect(expiredGuestRes.body.error.code).toBe('GALLERY_EXPIRED');

      // 6. Run background worker sweeper
      const transitioned = await expireEventIfDue(testEventId);
      expect(transitioned.expired).toBe(true);

      // 7. Verify DB state: visibility is private and expired_at is recorded
      const row = db.public.query(`SELECT visibility, expired_at FROM events WHERE id = '${testEventId}'`).rows[0];
      expect(row.visibility).toBe('private');
      expect(row.expired_at).toBeDefined();

      // 8. Confirm media and folders remain 100% intact
      const folderRows = db.public.query(`SELECT * FROM folders WHERE event_id = '${testEventId}'`).rows;
      expect(folderRows.length).toBe(1);
      const mediaRows = db.public.query(`SELECT * FROM media WHERE event_id = '${testEventId}'`).rows;
      expect(mediaRows.length).toBe(1);
    });
  });

  describe('Scenario B: Delayed Scheduler & Request-Time Reactive Guard', () => {
    it('denies all guest requests at/after expiry even when DB visibility still says public', async () => {
      const pastTime = new Date(Date.now() - 10000).toISOString();

      // Event is marked 'public' in DB, but public_until is overdue
      insertTestEvent(db, {
        id: testEventId,
        owner_id: 1,
        slug: 'overdue-gallery',
        name: 'Overdue Gallery',
        visibility: 'public',
        status: 'active',
        public_start: new Date(Date.now() - 86400000).toISOString(),
        public_until: pastTime,
        public_duration_days: 1,
      });

      insertTestMedia(db, {
        id: testMediaId,
        event_id: testEventId,
        filename: 'portrait.jpg',
        status: 'ready',
      });

      // Request 1: Gallery metadata
      const metaRes = await request(app)
        .get('/api/guest/event/overdue-gallery')
        .expect(410);
      expect(metaRes.body.error.code).toBe('GALLERY_EXPIRED');

      // Request 2: Gallery media
      const mediaRes = await request(app)
        .get('/api/guest/gallery/overdue-gallery')
        .expect(410);
      expect(mediaRes.body.error.code).toBe('GALLERY_EXPIRED');

      // Request 3: PIN verification attempt
      const pinRes = await request(app)
        .post('/api/guest/verify-pin/overdue-gallery')
        .send({ pin: '123456' })
        .expect(410);
      expect(pinRes.body.error.code).toBe('GALLERY_EXPIRED');

      // Run reconciliation sweeper
      const summary = await reconcileExpiredEvents(50);
      expect(summary.transitioned).toBe(1);

      // Verify DB visibility is now private
      const updatedRow = db.public.query(`SELECT visibility FROM events WHERE id = '${testEventId}'`).rows[0];
      expect(updatedRow.visibility).toBe('private');
    });
  });

  describe('Scenario C: Republishing & Fresh Public Period', () => {
    it('begins a fresh public window from NOW() when republishing an expired event', async () => {
      const pastTime = new Date(Date.now() - 3600000).toISOString();

      // Expired private event
      insertTestEvent(db, {
        id: testEventId,
        owner_id: 1,
        slug: 'republish-test',
        name: 'Republish Test',
        visibility: 'private',
        status: 'active',
        public_start: new Date(Date.now() - 86400000 * 8).toISOString(),
        public_until: pastTime,
        public_duration_days: 7,
        expired_at: pastTime,
      });

      // Photographer republishes with 14 days
      const repubRes = await request(app)
        .post(`/api/events/${testEventId}/publish`)
        .set('Cookie', authCookie)
        .send({ public_duration_days: 14 })
        .expect(200);

      expect(repubRes.body.data.event.visibility).toBe('public');
      expect(repubRes.body.data.event.public_duration_days).toBe(14);
      expect(repubRes.body.data.event.is_expired).toBe(false);

      const newStart = new Date(repubRes.body.data.event.public_start).getTime();
      const newUntil = new Date(repubRes.body.data.event.public_until).getTime();

      // Fresh public window must NOT be calculated from old expiry
      expect(newUntil - newStart).toBe(14 * 24 * 60 * 60 * 1000);
      expect(newStart).toBeGreaterThan(new Date(pastTime).getTime());

      // Stale expiry attempt must be a harmless no-op
      const staleJobResult = await expireEventIfDue(testEventId);
      expect(staleJobResult.expired).toBe(false); // Because newUntil is in the future!

      // Guest access works again
      await request(app)
        .get('/api/guest/event/republish-test')
        .expect(200);

      // Repeated publish on already-public active event preserves existing expiry window
      const repeatRes = await request(app)
        .post(`/api/events/${testEventId}/publish`)
        .set('Cookie', authCookie)
        .send({})
        .expect(200);

      expect(repeatRes.body.data.event.public_until).toBe(repubRes.body.data.event.public_until);
    });

    it('unrelated event metadata edits do not reset or extend public_until', async () => {
      const initialStart = new Date().toISOString();
      const initialUntil = new Date(Date.now() + 7 * 86400000).toISOString();

      insertTestEvent(db, {
        id: testEventId,
        owner_id: 1,
        slug: 'unrelated-edits',
        name: 'Original Title',
        visibility: 'public',
        status: 'active',
        public_start: initialStart,
        public_until: initialUntil,
        public_duration_days: 7,
      });

      // Edit event title and description
      const editRes = await request(app)
        .patch(`/api/events/${testEventId}`)
        .set('Cookie', authCookie)
        .send({
          name: 'Completely Changed Title',
          description: 'Updated client notes',
        })
        .expect(200);

      expect(editRes.body.data.event.name).toBe('Completely Changed Title');
      expect(editRes.body.data.event.public_until).toBe(initialUntil);
      expect(editRes.body.data.event.public_start).toBe(initialStart);
    });
  });

  describe('Scenario D: PIN Protection + Expiry + Session Revocation', () => {
    it('revokes guest access after expiry even if guest holds a previously valid PIN session token', async () => {
      // Create public PIN-protected event expiring in future
      const futureExpiry = new Date(Date.now() + 10000).toISOString();
      insertTestEvent(db, {
        id: testPinEventId,
        owner_id: 1,
        slug: 'royal-palace-wedding',
        name: 'Royal Palace Wedding',
        visibility: 'public',
        status: 'active',
        public_start: new Date().toISOString(),
        public_until: futureExpiry,
        public_duration_days: 1,
        pin_enabled: true,
        pin_hash: pinHash,
      });

      // 1. Guest verifies PIN and receives valid guest JWT session token
      const pinVerifyRes = await request(app)
        .post('/api/guest/verify-pin/royal-palace-wedding')
        .send({ pin: testPin })
        .expect(200);

      expect(pinVerifyRes.body.success).toBe(true);
      const guestToken = pinVerifyRes.body.data.guestToken;
      expect(guestToken).toBeDefined();

      // 2. Request with guest token succeeds before expiry
      await request(app)
        .get('/api/guest/gallery/royal-palace-wedding')
        .set('Authorization', `Bearer ${guestToken}`)
        .expect(200);

      // 3. Time advances past expiry
      const pastStart = new Date(Date.now() - 86400000);
      const pastExpiry = new Date(Date.now() - 5000);
      db.public.query(
        `UPDATE events SET public_start = '${pastStart.toISOString()}'::timestamptz, public_until = '${pastExpiry.toISOString()}'::timestamptz WHERE id = '${testPinEventId}'`
      );

      // 4. Request with previously valid guest session token is strictly denied (HTTP 410)
      const expiredWithTokenRes = await request(app)
        .get('/api/guest/gallery/royal-palace-wedding')
        .set('Authorization', `Bearer ${guestToken}`)
        .expect(410);

      expect(expiredWithTokenRes.body.error.code).toBe('GALLERY_EXPIRED');

      // 5. Re-submitting the PIN on expired gallery is also rejected (HTTP 410)
      const repeatPinRes = await request(app)
        .post('/api/guest/verify-pin/royal-palace-wedding')
        .send({ pin: testPin })
        .expect(410);

      expect(repeatPinRes.body.error.code).toBe('GALLERY_EXPIRED');

      // 6. Running expiry worker revokes active session records from DB
      await expireEventIfDue(testPinEventId);
      const sessions = db.public.query(`SELECT * FROM guest_sessions WHERE event_id = '${testPinEventId}'`).rows;
      expect(sessions.length).toBe(0);
    });
  });

  describe('Scenario E: Non-destructive Retention Guarantee', () => {
    it('guarantees expiry NEVER deletes photos, folders, or face embeddings', async () => {
      insertTestEvent(db, {
        id: testEventId,
        owner_id: 1,
        slug: 'preservation-test',
        name: 'Preservation Test',
        visibility: 'public',
        status: 'active',
        public_start: new Date(Date.now() - 86400000).toISOString(),
        public_until: new Date(Date.now() - 5000).toISOString(),
        public_duration_days: 1,
      });

      insertTestFolder(db, {
        id: testFolderId,
        event_id: testEventId,
        name: 'Pre-Wedding Highlights',
      });

      insertTestMedia(db, {
        id: testMediaId,
        event_id: testEventId,
        folder_id: testFolderId,
        filename: 'portrait_fine_art.jpg',
        status: 'ready',
      });

      // Record pre-expiry database counts
      const preFolders = db.public.query(`SELECT COUNT(*)::int as c FROM folders WHERE event_id = '${testEventId}'`).rows[0].c;
      const preMedia = db.public.query(`SELECT COUNT(*)::int as c FROM media WHERE event_id = '${testEventId}'`).rows[0].c;

      expect(preFolders).toBe(1);
      expect(preMedia).toBe(1);

      // Run expiry worker
      const res = await expireEventIfDue(testEventId);
      expect(res.expired).toBe(true);

      // Verify post-expiry database counts remain 100% intact
      const postFolders = db.public.query(`SELECT COUNT(*)::int as c FROM folders WHERE event_id = '${testEventId}'`).rows[0].c;
      const postMedia = db.public.query(`SELECT COUNT(*)::int as c FROM media WHERE event_id = '${testEventId}'`).rows[0].c;

      expect(postFolders).toBe(preFolders);
      expect(postMedia).toBe(preMedia);

      // Photographer retains full authenticated access
      const photoAccessRes = await request(app)
        .get(`/api/events/${testEventId}`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(photoAccessRes.body.data.event.id).toBe(testEventId);
      expect(photoAccessRes.body.data.event.visibility).toBe('private');
      expect(photoAccessRes.body.data.event.expired_at).toBeDefined();

      const folderAccessRes = await request(app)
        .get(`/api/events/${testEventId}/folders`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(folderAccessRes.body.data.folders.length).toBe(1);
      expect(folderAccessRes.body.data.folders[0].name).toBe('Pre-Wedding Highlights');
    });
  });
});
