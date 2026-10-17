import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { S3Client } from '@aws-sdk/client-s3';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import {
  setR2ClientForTesting,
  resetR2Client,
} from '../../apps/api/src/infrastructure/r2Client.js';
import {
  reconcileExpiredBinEvents,
  calculateDaysRemaining,
} from '../../apps/api/src/services/recycleBinService.js';
import { indexPhotoFaces } from '../../apps/api/src/services/faceIndexingService.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
  insertTestFaceEmbedding,
} from '../helpers/db_test_helper.js';
import type { IMemoryDb } from 'pg-mem';

describe('Event Recycle Bin, Restore & Automatic Permanent Deletion Integration Tests', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'SecurePhotographer2026!';
  let authCookie: string;
  let otherAuthCookie: string;
  let mockS3Client: S3Client;
  const bucketName = 'studio-lumina-bin-bucket';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    db = createTestDatabase();
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography'),
              (2, 'other@studiolumina.photo', '${passwordHash}', 'Studio Other', 'Commercial Photography')
       ON CONFLICT (id) DO NOTHING;`
    );

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);

    // Mock S3 client for storageAdapter
    mockS3Client = new S3Client({
      region: 'auto',
      endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: 'test-key-id',
        secretAccessKey: 'test-secret-key',
      },
    });

    // Obtain photographer 1 auth session cookie
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'photographer@studiolumina.photo',
      password: TEST_PASSWORD,
    });

    const rawCookies = loginRes.header['set-cookie'];
    const sessionCookie = Array.isArray(rawCookies)
      ? rawCookies.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : rawCookies;

    authCookie = sessionCookie.split(';')[0];

    // Obtain photographer 2 auth session cookie (Cross-tenant testing)
    const loginRes2 = await request(app).post('/api/auth/login').send({
      email: 'other@studiolumina.photo',
      password: TEST_PASSWORD,
    });

    const rawCookies2 = loginRes2.header['set-cookie'];
    const sessionCookie2 = Array.isArray(rawCookies2)
      ? rawCookies2.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      : rawCookies2;

    otherAuthCookie = sessionCookie2.split(';')[0];
  });

  afterAll(() => {
    resetR2Client();
    setDatabasePool(null);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    setR2ClientForTesting(mockS3Client, bucketName);
    vi.spyOn(mockS3Client, 'send').mockImplementation(async (command: any) => {
      const cmdName = command?.constructor?.name;
      if (cmdName === 'ListObjectsV2Command') {
        return { Contents: [], IsTruncated: false } as never;
      }
      if (cmdName === 'DeleteObjectsCommand') {
        return { Deleted: [] } as never;
      }
      return {} as never;
    });
  });

  describe('1. Moving an Event to the Recycle Bin (Soft Delete)', () => {
    it('should move an event to the bin, set trashed status and timestamps, without deleting files or embeddings', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000001';
      const eventName = 'Summer Vineyard Wedding 2026';
      insertTestEvent(db, {
        id: eventId,
        name: eventName,
        owner_id: 1,
        status: 'active',
        visibility: 'public',
      });

      const folder = insertTestFolder(db, {
        id: 'bf000000-0000-0000-0000-000000000001',
        event_id: eventId,
        name: 'Ceremony',
      });

      const photo = insertTestMedia(db, {
        id: 'ba000000-0000-0000-0000-000000000001',
        event_id: eventId,
        folder_id: folder.id,
        type: 'photo',
        filename: 'vows.jpg',
      });

      insertTestFaceEmbedding(db, {
        id: 'be000000-0000-0000-0000-000000000001',
        event_id: eventId,
        photo_id: photo.id,
        face_index: 0,
        embedding: '[0.1, 0.2, 0.3]',
      });

      // Soft delete via POST /api/events/:id/trash
      const res = await request(app)
        .post(`/api/events/${eventId}/trash`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trashed).toBe(true);
      expect(res.body.data.status).toBe('trashed');
      expect(res.body.data.deleted_at).toBeDefined();
      expect(res.body.data.purge_after).toBeDefined();
      expect(res.body.data.days_remaining).toBeGreaterThanOrEqual(29);

      // Verify database state: event is trashed, but files and embeddings are INTACT
      const eventRow = db.public.one(`SELECT * FROM events WHERE id = '${eventId}'`);
      expect(eventRow.status).toBe('trashed');
      expect(eventRow.visibility).toBe('private');
      expect(eventRow.deleted_at).not.toBeNull();
      expect(eventRow.purge_after).not.toBeNull();
      expect(eventRow.deleted_by).toBe(1);

      const mediaRows = db.public.many(`SELECT * FROM media WHERE event_id = '${eventId}'`);
      expect(mediaRows).toHaveLength(1);

      const embeddingRows = db.public.many(
        `SELECT * FROM face_embeddings WHERE event_id = '${eventId}'`
      );
      expect(embeddingRows).toHaveLength(1);

      const folderRows = db.public.many(`SELECT * FROM folders WHERE event_id = '${eventId}'`);
      expect(folderRows).toHaveLength(1);
    });

    it('should exclude trashed events from the standard active events list', async () => {
      const res = await request(app).get('/api/events').set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      const found = res.body.data.events.some(
        (e: any) => e.id === 'b1000000-0000-0000-0000-000000000001'
      );
      expect(found).toBe(false);
    });

    it('should list trashed events in GET /api/events/bin with days remaining', async () => {
      const res = await request(app).get('/api/events/bin').set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const trashed = res.body.data.events.find(
        (e: any) => e.id === 'b1000000-0000-0000-0000-000000000001'
      );
      expect(trashed).toBeDefined();
      expect(trashed.status).toBe('trashed');
      expect(trashed.days_remaining).toBeGreaterThanOrEqual(29);
      expect(trashed.deleted_at).toBeDefined();
      expect(trashed.purge_after).toBeDefined();
    });

    it('should list trashed events in GET /api/events/trash with photo/video counts and days remaining', async () => {
      const res = await request(app).get('/api/events/trash').set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const trashed = res.body.data.events.find(
        (e: any) => e.id === 'b1000000-0000-0000-0000-000000000001'
      );
      expect(trashed).toBeDefined();
      expect(trashed.status).toBe('trashed');
      expect(trashed.photo_count).toBe(1);
      expect(trashed.video_count).toBe(0);
      expect(trashed.days_remaining).toBeGreaterThanOrEqual(29);
    });

    it('should reject unauthorized photographer attempting to trash another photographer event with 404', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000001';
      // Photographer 2 attempts to trash Photographer 1's event
      const res = await request(app)
        .post(`/api/events/${eventId}/trash`)
        .set('Cookie', [otherAuthCookie]);

      expect(res.status).toBe(404);
    });

    it('should support soft delete via DELETE /api/events/:id when trash=true is requested', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000002';
      insertTestEvent(db, {
        id: eventId,
        name: 'Mountain Retreat Shoot',
        owner_id: 1,
        status: 'active',
      });

      const res = await request(app)
        .delete(`/api/events/${eventId}?trash=true`)
        .set('Cookie', [authCookie])
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.trashed).toBe(true);
      expect(res.body.data.status).toBe('trashed');

      const eventRow = db.public.one(`SELECT status FROM events WHERE id = '${eventId}'`);
      expect(eventRow.status).toBe('trashed');
    });
  });

  describe('2. Restoring an Event from the Recycle Bin', () => {
    it('should restore a trashed event back to active, clearing deleted_at and purge_after', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000001';

      const res = await request(app)
        .post(`/api/events/${eventId}/restore`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const eventRow = db.public.one(`SELECT * FROM events WHERE id = '${eventId}'`);
      expect(eventRow.status).toBe('active');
      expect(eventRow.deleted_at).toBeNull();
      expect(eventRow.purge_after).toBeNull();
      expect(eventRow.deleted_by).toBeNull();

      // Embeddings and photos must still exist untouched
      const embeddings = db.public.many(
        `SELECT * FROM face_embeddings WHERE event_id = '${eventId}'`
      );
      expect(embeddings).toHaveLength(1);

      // Should reappear in the standard active events list
      const listRes = await request(app).get('/api/events').set('Cookie', [authCookie]);
      const found = listRes.body.data.events.some((e: any) => e.id === eventId);
      expect(found).toBe(true);
    });

    it('should reject restore if event is currently being permanently deleted with 409 Conflict', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000003';
      insertTestEvent(db, {
        id: eventId,
        name: 'Irreversible Gala',
        owner_id: 1,
        status: 'deleting',
      });

      const res = await request(app)
        .post(`/api/events/${eventId}/restore`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/permanent deletion has already started/i);
    });

    it('should reject unauthorized photographer attempting to restore another photographer event with 404', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000001';
      // Photographer 2 attempts to restore Photographer 1's event
      const res = await request(app)
        .post(`/api/events/${eventId}/restore`)
        .set('Cookie', [otherAuthCookie]);

      expect(res.status).toBe(404);
    });

    it('should restore an event whose original public window expired, ensuring it remains private and expired', async () => {
      const expiredEventId = 'b1000000-0000-0000-0000-000000000099';
      const expiredDate = new Date(Date.now() - 48 * 3600 * 1000); // 2 days in past
      insertTestEvent(db, {
        id: expiredEventId,
        name: 'Expired Gala 2026',
        owner_id: 1,
        status: 'trashed',
        visibility: 'private',
        public_until: expiredDate.toISOString(),
      });

      const res = await request(app)
        .post(`/api/events/${expiredEventId}/restore`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.event.visibility).toBe('private');
      expect(res.body.data.event.is_expired).toBe(true);

      const dbRow = db.public.one(`SELECT * FROM events WHERE id = '${expiredEventId}'`);
      expect(dbRow.status).toBe('active');
      expect(dbRow.visibility).toBe('private');
      expect(dbRow.deleted_at).toBeNull();
      expect(dbRow.purge_after).toBeNull();
      expect(dbRow.expired_at).not.toBeNull();
    });
  });

  describe('3. Access Control & Safeguards while in the Bin', () => {
    it('should deny guest gallery access and metadata for trashed events with 403', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000004';
      const slug = 'trashed-guest-test-4a9f';
      insertTestEvent(db, {
        id: eventId,
        name: 'Trashed Gallery',
        slug,
        owner_id: 1,
        status: 'trashed',
        visibility: 'public',
      });

      // Guest metadata resolution
      const resMeta = await request(app).get(`/api/guest/event/${slug}`);
      expect(resMeta.status).toBe(403);

      // Guest gallery media
      const resGallery = await request(app).get(`/api/guest/gallery/${slug}`);
      expect(resGallery.status).toBe(403);
    });

    it('should reject photo uploads to a trashed event with 409 Conflict', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000004';

      const res = await request(app)
        .post(`/api/events/${eventId}/media/presign-batch`)
        .set('Cookie', [authCookie])
        .send({
          items: [
            {
              filename: 'test.jpg',
              sizeBytes: 1024,
              mimeType: 'image/jpeg',
            },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/Recycle Bin/i);
    });

    it('should skip background face indexing when parent event is trashed', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000004';
      const photoId = 'ba000000-0000-0000-0000-000000000004';
      insertTestMedia(db, { id: photoId, event_id: eventId, filename: 'skip.jpg' });

      const indexResult = await indexPhotoFaces(photoId, eventId, Buffer.from('fake image'));
      expect(indexResult.status).toBe('skipped');
      expect(indexResult.error).toMatch(/trashed/i);
    });
  });

  describe('4. Manual Permanent Deletion from the Bin', () => {
    it('should permanently purge an individual trashed event with typed name confirmation', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000005';
      const eventName = 'Destination Beach Gala';
      insertTestEvent(db, { id: eventId, name: eventName, owner_id: 1, status: 'trashed' });

      insertTestMedia(db, {
        id: 'ba000000-0000-0000-0000-000000000005',
        event_id: eventId,
        filename: 'sunset.jpg',
        storage_key_original: `events/${eventId}/originals/sunset.jpg`,
      });

      // Mock storageAdapter.purgeEventPrefix
      const purgeSpy = vi
        .spyOn(storageAdapter, 'purgeEventPrefix')
        .mockResolvedValueOnce({
          eventId,
          deletedCount: 1,
          totalDeleted: 1,
          stagesAttempted: 1,
          keysVerifiedEmpty: true,
        } as any);

      const res = await request(app)
        .delete(`/api/events/${eventId}/permanent`)
        .set('Cookie', [authCookie])
        .send({ confirmEventName: eventName });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);
      expect(purgeSpy).toHaveBeenCalledWith(eventId, expect.any(Object));

      // Database records must be purged
      const eventCount = db.public.one(
        `SELECT count(*) as count FROM events WHERE id = '${eventId}'`
      );
      expect(Number(eventCount.count)).toBe(0);

      const mediaCount = db.public.one(
        `SELECT count(*) as count FROM media WHERE event_id = '${eventId}'`
      );
      expect(Number(mediaCount.count)).toBe(0);
    });

    it('should reject unauthorized photographer attempting to permanently delete another photographer event with 404', async () => {
      const eventId = 'b1000000-0000-0000-0000-000000000005';
      const res = await request(app)
        .delete(`/api/events/${eventId}/permanent`)
        .set('Cookie', [otherAuthCookie])
        .send({ confirmEventName: 'Destination Beach Gala' });

      expect(res.status).toBe(404);
    });
  });

  describe('5. Empty Bin Action', () => {
    it('should permanently delete all trashed events belonging to the photographer while leaving active and other owners events untouched', async () => {
      // Photographer 1: 2 trashed events, 1 active event
      const p1Trash1 = 'b1000000-0000-0000-0000-000000000011';
      const p1Trash2 = 'b1000000-0000-0000-0000-000000000012';
      const p1Active = 'b1000000-0000-0000-0000-000000000013';

      insertTestEvent(db, {
        id: p1Trash1,
        name: 'P1 Trash Event 1',
        owner_id: 1,
        status: 'trashed',
      });
      insertTestEvent(db, {
        id: p1Trash2,
        name: 'P1 Trash Event 2',
        owner_id: 1,
        status: 'trashed',
      });
      insertTestEvent(db, {
        id: p1Active,
        name: 'P1 Active Gallery',
        owner_id: 1,
        status: 'active',
      });

      // Photographer 2: 1 trashed event (must NOT be touched!)
      const p2Trash = 'b1000000-0000-0000-0000-000000000021';
      insertTestEvent(db, {
        id: p2Trash,
        name: 'P2 Trashed Event',
        owner_id: 2,
        status: 'trashed',
      });

      vi.spyOn(storageAdapter, 'purgeEventPrefix').mockResolvedValue({
        eventId: p1Trash1,
        deletedCount: 0,
        totalDeleted: 0,
        prefix: `events/${p1Trash1}/`,
        stagesAttempted: 1,
        keysVerifiedEmpty: true,
      } as any);

      const res = await request(app)
        .post('/api/events/bin/empty')
        .set('Cookie', [authCookie])
        .send({ confirm: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.successfullyDeleted).toBeGreaterThanOrEqual(2);

      // Photographer 1 trashed events are purged
      const p1Check1 = db.public.one(
        `SELECT count(*) as count FROM events WHERE id = '${p1Trash1}'`
      );
      expect(Number(p1Check1.count)).toBe(0);
      const p1Check2 = db.public.one(
        `SELECT count(*) as count FROM events WHERE id = '${p1Trash2}'`
      );
      expect(Number(p1Check2.count)).toBe(0);

      // Photographer 1 active event is completely safe
      const p1ActiveCheck = db.public.one(
        `SELECT count(*) as count FROM events WHERE id = '${p1Active}'`
      );
      expect(Number(p1ActiveCheck.count)).toBe(1);

      // Photographer 2 trashed event is completely untouched (Tenant / Owner Isolation)
      const p2Check = db.public.one(`SELECT count(*) as count FROM events WHERE id = '${p2Trash}'`);
      expect(Number(p2Check.count)).toBe(1);
    });

    it('should support empty bin via POST /api/events/trash/empty alias and handle partial failures gracefully', async () => {
      const trash1 = 'b1000000-0000-0000-0000-000000000071';
      const trash2 = 'b1000000-0000-0000-0000-000000000072';

      insertTestEvent(db, { id: trash1, name: 'Partial Fail 1', owner_id: 1, status: 'trashed' });
      insertTestEvent(db, {
        id: trash2,
        name: 'Partial Success 2',
        owner_id: 1,
        status: 'trashed',
      });

      // First event fails during storage purge, second event succeeds
      vi.spyOn(storageAdapter, 'purgeEventPrefix')
        .mockRejectedValueOnce(new Error('Simulated transient R2 purge failure for trash1'))
        .mockResolvedValueOnce({
          eventId: trash2,
          deletedCount: 0,
          totalDeleted: 0,
          prefix: `events/${trash2}/`,
          stagesAttempted: 1,
          keysVerifiedEmpty: true,
        } as any);

      const res = await request(app)
        .post('/api/events/trash/empty')
        .set('Cookie', [authCookie])
        .send({ confirm: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalRequested).toBeGreaterThanOrEqual(2);
      expect(res.body.data.failedCount).toBeGreaterThanOrEqual(1);
      expect(res.body.data.successfullyDeleted).toBeGreaterThanOrEqual(1);

      // Verify trash2 was deleted
      const check2 = db.public.one(`SELECT count(*) as count FROM events WHERE id = '${trash2}'`);
      expect(Number(check2.count)).toBe(0);

      // Verify trash1 is still in database with failed job state (recoverable)
      const check1 = db.public.one(`SELECT count(*) as count FROM events WHERE id = '${trash1}'`);
      expect(Number(check1.count)).toBe(1);
    });
  });

  describe('6. Automatic Permanent Deletion via Scheduled Purge Worker', () => {
    it('should purge events whose purge_after date has passed, while ignoring events still within retention period', async () => {
      const now = new Date();
      const pastPurgeDate = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
      const futurePurgeDate = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000); // 25 days in future

      // Expired trashed event
      const expiredId = 'b1000000-0000-0000-0000-000000000031';
      insertTestEvent(db, {
        id: expiredId,
        name: 'Expired Autumn Festival',
        owner_id: 1,
        status: 'trashed',
      });
      db.public.none(
        `UPDATE events SET deleted_at = NOW() - INTERVAL '31 days', purge_after = '${pastPurgeDate.toISOString()}' WHERE id = '${expiredId}';`
      );

      // Unexpired trashed event
      const unexpiredId = 'b1000000-0000-0000-0000-000000000032';
      insertTestEvent(db, {
        id: unexpiredId,
        name: 'Freshly Trashed Wedding',
        owner_id: 1,
        status: 'trashed',
      });
      db.public.none(
        `UPDATE events SET deleted_at = NOW(), purge_after = '${futurePurgeDate.toISOString()}' WHERE id = '${unexpiredId}';`
      );

      vi.spyOn(storageAdapter, 'purgeEventPrefix').mockResolvedValue({
        eventId: expiredId,
        deletedCount: 0,
        totalDeleted: 0,
        prefix: `events/${expiredId}/`,
        stagesAttempted: 1,
        keysVerifiedEmpty: true,
      } as any);

      // Run automated reconcile worker
      const result = await reconcileExpiredBinEvents(now);

      expect(result.claimedCount).toBeGreaterThanOrEqual(1);
      expect(result.purgedCount).toBeGreaterThanOrEqual(1);

      // Expired event is purged
      const expiredCheck = db.public.one(
        `SELECT count(*) as count FROM events WHERE id = '${expiredId}'`
      );
      expect(Number(expiredCheck.count)).toBe(0);

      // Unexpired event remains safe in the bin
      const unexpiredCheck = db.public.one(
        `SELECT count(*) as count FROM events WHERE id = '${unexpiredId}'`
      );
      expect(Number(unexpiredCheck.count)).toBe(1);
    });

    it('should correctly calculate days remaining using UTC timestamps', () => {
      const now = new Date('2026-10-10T12:00:00Z');
      const inFiveDays = new Date('2026-10-15T12:00:00Z');
      const inThirtyDays = new Date('2026-11-09T12:00:00Z');
      const inPast = new Date('2026-10-09T12:00:00Z');

      expect(calculateDaysRemaining(inFiveDays, now)).toBe(5);
      expect(calculateDaysRemaining(inThirtyDays, now)).toBe(30);
      expect(calculateDaysRemaining(inPast, now)).toBe(0);
      expect(calculateDaysRemaining(null, now)).toBe(0);
    });
  });
});
