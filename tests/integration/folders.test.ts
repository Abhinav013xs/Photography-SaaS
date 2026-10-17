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
  insertTestFaceEmbedding,
} from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { clearMemoryRateLimitStore } from '../../apps/api/src/middleware/rateLimiter.js';

describe('Folder Management REST API Integration Tests (Phase 7)', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'FolderMasterPassword2026!';
  let authCookie: string;

  const EVENT_A_ID = 'e0000000-0000-0000-0000-000000000001';
  const EVENT_B_ID = 'e0000000-0000-0000-0000-000000000002';
  const FOREIGN_EVENT_ID = 'e0000000-0000-0000-0000-000000000099';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    db = createTestDatabase();
    // Insert single photographer (owner ID = 1)
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (1, 'photographer@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Fine Art Photography');`
    );

    // Insert an alternate photographer for IDOR / ownership isolation tests (owner ID = 2)
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name)
       VALUES (2, 'other@photographer.com', '${passwordHash}', 'Other Studio');`
    );

    // Insert Event A (owned by photographer 1)
    insertTestEvent(db, {
      id: EVENT_A_ID,
      owner_id: 1,
      slug: 'wedding-a-2026',
      name: 'Event A — Grand Wedding',
    });

    // Insert Event B (also owned by photographer 1)
    insertTestEvent(db, {
      id: EVENT_B_ID,
      owner_id: 1,
      slug: 'wedding-b-2026',
      name: 'Event B — Sunset Reception',
    });

    // Insert Foreign Event (owned by photographer 2)
    insertTestEvent(db, {
      id: FOREIGN_EVENT_ID,
      owner_id: 2,
      slug: 'foreign-wedding-2026',
      name: 'Foreign Event — Unauthorized Access',
    });

    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    setDatabasePool(pool);

    // Login as photographer 1 to obtain valid session cookie
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

  describe('1. Authentication & IDOR Authorization Boundaries', () => {
    it('should reject unauthenticated GET /api/events/:eventId/folders with 401', async () => {
      const res = await request(app).get(`/api/events/${EVENT_A_ID}/folders`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should reject unauthenticated POST /api/events/:eventId/folders with 401', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/folders`)
        .send({ name: 'Ceremony' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when listing folders for a nonexistent event UUID', async () => {
      const res = await request(app)
        .get('/api/events/00000000-0000-0000-0000-999999999999/folders')
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('should return 404 when accessing folders for an event owned by another photographer', async () => {
      const res = await request(app)
        .get(`/api/events/${FOREIGN_EVENT_ID}/folders`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('should return 404 when attempting to create a folder in another photographer event', async () => {
      const res = await request(app)
        .post(`/api/events/${FOREIGN_EVENT_ID}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: 'Unauthorized Folder' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
    });
  });

  describe('2. Folder Creation (POST /api/events/:eventId/folders)', () => {
    it('should create a new folder with trimmed name and auto-assigned sort order', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: '  Ceremony  ' });

      if (res.status !== 201) {
        throw new Error(`Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folder).toBeDefined();
      expect(res.body.data.folder.name).toBe('Ceremony');
      expect(res.body.data.folder.event_id).toBe(EVENT_A_ID);
      expect(res.body.data.folder.media_count).toBe(0);
      expect(res.body.data.folder.sort_order).toBe(0);
      expect(res.body.data.folder.id).toBeDefined();
    });

    it('should create subsequent folders with incrementing sort orders', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: 'Reception' });

      expect(res.status).toBe(201);
      expect(res.body.data.folder.name).toBe('Reception');
      expect(res.body.data.folder.sort_order).toBe(1);
    });

    it('should allow explicitly specified sort order', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: 'Couple Portraits', sort_order: 10 });

      expect(res.status).toBe(201);
      expect(res.body.data.folder.name).toBe('Couple Portraits');
      expect(res.body.data.folder.sort_order).toBe(10);
    });

    it('should reject empty or whitespace-only folder name with 400', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject folder name exceeding 255 characters with 400', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: 'X'.repeat(256) });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject duplicate folder name in the same event with 409 FOLDER_NAME_CONFLICT', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: 'ceremony' }); // Case-insensitive duplicate of "Ceremony"

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FOLDER_NAME_CONFLICT');
    });

    it('should allow the same folder name in a DIFFERENT event (event-scoped uniqueness)', async () => {
      const res = await request(app)
        .post(`/api/events/${EVENT_B_ID}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: 'Ceremony' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folder.name).toBe('Ceremony');
      expect(res.body.data.folder.event_id).toBe(EVENT_B_ID);
    });
  });

  describe('3. Folder Listing & Real Media Counts (GET /api/events/:eventId/folders)', () => {
    it('should list all folders for an event in predictable sort order', async () => {
      const res = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folders).toHaveLength(3);
      expect(res.body.data.folders[0].name).toBe('Ceremony');
      expect(res.body.data.folders[1].name).toBe('Reception');
      expect(res.body.data.folders[2].name).toBe('Couple Portraits');
    });

    it('should return accurate media counts when media exists in folders', async () => {
      // Find the Ceremony folder in Event A
      const listRes = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);

      const ceremonyFolder = listRes.body.data.folders.find((f: any) => f.name === 'Ceremony');

      // Insert 3 photos into Ceremony folder
      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000001',
        event_id: EVENT_A_ID,
        folder_id: ceremonyFolder.id,
      });
      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000002',
        event_id: EVENT_A_ID,
        folder_id: ceremonyFolder.id,
      });
      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000003',
        event_id: EVENT_A_ID,
        folder_id: ceremonyFolder.id,
      });

      // Insert 2 photos at event root (folder_id = NULL)
      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000004',
        event_id: EVENT_A_ID,
        folder_id: null,
      });
      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000005',
        event_id: EVENT_A_ID,
        folder_id: null,
      });

      const updatedList = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);

      const ceremony = updatedList.body.data.folders.find((f: any) => f.name === 'Ceremony');
      const reception = updatedList.body.data.folders.find((f: any) => f.name === 'Reception');

      expect(ceremony.media_count).toBe(3);
      expect(reception.media_count).toBe(0);
      expect(updatedList.body.data.root_media_count).toBe(2);
      expect(updatedList.body.data.total_media_count).toBe(5);
    });

    it('should strictly isolate Event A folders from Event B folders', async () => {
      const resB = await request(app)
        .get(`/api/events/${EVENT_B_ID}/folders`)
        .set('Cookie', [authCookie]);

      expect(resB.status).toBe(200);
      expect(resB.body.data.folders).toHaveLength(1);
      expect(resB.body.data.folders[0].name).toBe('Ceremony');
      expect(resB.body.data.folders[0].event_id).toBe(EVENT_B_ID);
      expect(resB.body.data.folders[0].media_count).toBe(0); // Event A media does not bleed into Event B
    });
  });

  describe('4. Folder Details (GET /api/events/:eventId/folders/:folderId)', () => {
    it('should retrieve individual folder metadata with media count', async () => {
      const listRes = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);
      const ceremony = listRes.body.data.folders.find((f: any) => f.name === 'Ceremony');

      const res = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders/${ceremony.id}`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folder.id).toBe(ceremony.id);
      expect(res.body.data.folder.name).toBe('Ceremony');
      expect(res.body.data.folder.media_count).toBe(3);
    });

    it('should return 404 when querying folder ID that belongs to another event', async () => {
      // Get Event B folder
      const listB = await request(app)
        .get(`/api/events/${EVENT_B_ID}/folders`)
        .set('Cookie', [authCookie]);
      const eventBFolder = listB.body.data.folders[0];

      // Query Event B folder using Event A URL path
      const res = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders/${eventBFolder.id}`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FOLDER_NOT_FOUND');
    });
  });

  describe('5. Folder Renaming & Updating (PATCH/PUT /api/events/:eventId/folders/:folderId)', () => {
    it('should rename a folder and update its sort order', async () => {
      const listRes = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);
      const reception = listRes.body.data.folders.find((f: any) => f.name === 'Reception');

      const res = await request(app)
        .patch(`/api/events/${EVENT_A_ID}/folders/${reception.id}`)
        .set('Cookie', [authCookie])
        .send({ name: 'Dinner & Sangeet', sort_order: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folder.name).toBe('Dinner & Sangeet');
      expect(res.body.data.folder.sort_order).toBe(5);
    });

    it('should allow unchanged name when updating only sort order', async () => {
      const listRes = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);
      const ceremony = listRes.body.data.folders.find((f: any) => f.name === 'Ceremony');

      const res = await request(app)
        .patch(`/api/events/${EVENT_A_ID}/folders/${ceremony.id}`)
        .set('Cookie', [authCookie])
        .send({ name: 'Ceremony', sort_order: 0 });

      expect(res.status).toBe(200);
      expect(res.body.data.folder.name).toBe('Ceremony');
    });

    it('should reject rename to an existing folder name in the same event with 409', async () => {
      const listRes = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);
      const couplePortraits = listRes.body.data.folders.find((f: any) => f.name === 'Couple Portraits');

      const res = await request(app)
        .patch(`/api/events/${EVENT_A_ID}/folders/${couplePortraits.id}`)
        .set('Cookie', [authCookie])
        .send({ name: 'Ceremony' }); // Already used by Ceremony folder

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FOLDER_NAME_CONFLICT');
    });

    it('should reject rename of a folder that belongs to another event', async () => {
      const listB = await request(app)
        .get(`/api/events/${EVENT_B_ID}/folders`)
        .set('Cookie', [authCookie]);
      const eventBFolder = listB.body.data.folders[0];

      const res = await request(app)
        .patch(`/api/events/${EVENT_A_ID}/folders/${eventBFolder.id}`)
        .set('Cookie', [authCookie])
        .send({ name: 'Attempted Cross-Event Rename' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FOLDER_NOT_FOUND');
    });
  });

  describe('6. Safe Folder Deletion Mechanics (DELETE /api/events/:eventId/folders/:folderId)', () => {
    it('should delete empty folder cleanly', async () => {
      const listRes = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);
      const couplePortraits = listRes.body.data.folders.find((f: any) => f.name === 'Couple Portraits');

      const res = await request(app)
        .delete(`/api/events/${EVENT_A_ID}/folders/${couplePortraits.id}`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.media_reassigned_count).toBe(0);

      // Verify folder record is gone
      const verifyRes = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders/${couplePortraits.id}`)
        .set('Cookie', [authCookie]);
      expect(verifyRes.status).toBe(404);
    });

    it('CRITICAL RULE: Deleting a folder MUST NEVER delete its photos, safely moving them to event root (folder_id = NULL)', async () => {
      const listRes = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);
      const ceremony = listRes.body.data.folders.find((f: any) => f.name === 'Ceremony');
      expect(ceremony.media_count).toBe(3);

      // Attach a face embedding to one of the photos to verify embeddings survive
      insertTestFaceEmbedding(db, {
        id: '20000000-0000-0000-0000-000000000001',
        event_id: EVENT_A_ID,
        photo_id: '10000000-0000-0000-0000-000000000001',
      });

      // Delete Ceremony folder
      const deleteRes = await request(app)
        .delete(`/api/events/${EVENT_A_ID}/folders/${ceremony.id}`)
        .set('Cookie', [authCookie]);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.media_reassigned_count).toBe(3);

      // Verify all 3 photos still exist in the database with folder_id = NULL
      const photos = db.public.many(
        `SELECT id, event_id, folder_id FROM media WHERE event_id = '${EVENT_A_ID}' AND id IN ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003')`
      );

      expect(photos).toHaveLength(3);
      for (const photo of photos) {
        expect(photo.folder_id).toBeNull(); // Safely moved to event root!
        expect(photo.event_id).toBe(EVENT_A_ID);
      }

      // Verify face embedding survived completely intact
      const embeddings = db.public.many(
        `SELECT id, photo_id FROM face_embeddings WHERE id = '20000000-0000-0000-0000-000000000001'`
      );
      expect(embeddings).toHaveLength(1);
      expect(embeddings[0].photo_id).toBe('10000000-0000-0000-0000-000000000001');

      // Verify listing now shows 5 photos in event root and folder is gone
      const updatedList = await request(app)
        .get(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie]);

      expect(updatedList.body.data.folders.some((f: any) => f.id === ceremony.id)).toBe(false);
      expect(updatedList.body.data.root_media_count).toBe(5);
      expect(updatedList.body.data.total_media_count).toBe(5);
    });

    it('should reject deleting a folder from another event', async () => {
      const listB = await request(app)
        .get(`/api/events/${EVENT_B_ID}/folders`)
        .set('Cookie', [authCookie]);
      const eventBFolder = listB.body.data.folders[0];

      const res = await request(app)
        .delete(`/api/events/${EVENT_A_ID}/folders/${eventBFolder.id}`)
        .set('Cookie', [authCookie]);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FOLDER_NOT_FOUND');
    });
  });

  describe('7. Media Movement Between Folders & Root', () => {
    let targetFolderId: string;

    beforeAll(async () => {
      // Create a fresh folder in Event A
      const createRes = await request(app)
        .post(`/api/events/${EVENT_A_ID}/folders`)
        .set('Cookie', [authCookie])
        .send({ name: 'Morning Haldi' });

      targetFolderId = createRes.body.data.folder.id;
    });

    it('should move single media from event root to a target folder', async () => {
      const res = await request(app)
        .patch(`/api/events/${EVENT_A_ID}/media/10000000-0000-0000-0000-000000000001/folder`)
        .set('Cookie', [authCookie])
        .send({ folderId: targetFolderId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.media.folder_id).toBe(targetFolderId);

      // Verify in DB
      const row = db.public.one(
        `SELECT folder_id FROM media WHERE id = '10000000-0000-0000-0000-000000000001'`
      );
      expect(row.folder_id).toBe(targetFolderId);
    });

    it('should move single media from a folder back to event root with folderId = null', async () => {
      const res = await request(app)
        .patch(`/api/events/${EVENT_A_ID}/media/10000000-0000-0000-0000-000000000001/folder`)
        .set('Cookie', [authCookie])
        .send({ folderId: null });

      expect(res.status).toBe(200);
      expect(res.body.data.media.folder_id).toBeNull();
    });

    it('CRITICAL ISOLATION: should reject moving media to a target folder belonging to another event', async () => {
      const listB = await request(app)
        .get(`/api/events/${EVENT_B_ID}/folders`)
        .set('Cookie', [authCookie]);
      const eventBFolder = listB.body.data.folders[0];

      const res = await request(app)
        .patch(`/api/events/${EVENT_A_ID}/media/10000000-0000-0000-0000-000000000001/folder`)
        .set('Cookie', [authCookie])
        .send({ folderId: eventBFolder.id });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TARGET_FOLDER');
    });

    it('CRITICAL ISOLATION: should reject moving media that belongs to another event', async () => {
      // Insert media into Event B
      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000099',
        event_id: EVENT_B_ID,
        folder_id: null,
      });

      // Try to move Event B media via Event A endpoint
      const res = await request(app)
        .patch(`/api/events/${EVENT_A_ID}/media/10000000-0000-0000-0000-000000000099/folder`)
        .set('Cookie', [authCookie])
        .send({ folderId: targetFolderId });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MEDIA_NOT_FOUND');
    });

    it('should batch move multiple media items to a folder', async () => {
      const mediaIds = [
        '10000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000003',
      ];

      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/move-batch`)
        .set('Cookie', [authCookie])
        .send({
          mediaIds,
          targetFolderId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.moved_count).toBe(2);

      // Verify in DB
      const rows = db.public.many(
        `SELECT id, folder_id FROM media WHERE id IN ('${mediaIds[0]}', '${mediaIds[1]}')`
      );
      expect(rows[0].folder_id).toBe(targetFolderId);
      expect(rows[1].folder_id).toBe(targetFolderId);
    });

    it('should batch move multiple media items to event root (targetFolderId = null)', async () => {
      const mediaIds = [
        '10000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000003',
      ];

      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/move-batch`)
        .set('Cookie', [authCookie])
        .send({
          mediaIds,
          targetFolderId: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.moved_count).toBe(2);

      const rows = db.public.many(
        `SELECT id, folder_id FROM media WHERE id IN ('${mediaIds[0]}', '${mediaIds[1]}')`
      );
      expect(rows[0].folder_id).toBeNull();
      expect(rows[1].folder_id).toBeNull();
    });

    it('should reject batch move if target folder belongs to another event', async () => {
      const listB = await request(app)
        .get(`/api/events/${EVENT_B_ID}/folders`)
        .set('Cookie', [authCookie]);
      const eventBFolder = listB.body.data.folders[0];

      const res = await request(app)
        .post(`/api/events/${EVENT_A_ID}/media/move-batch`)
        .set('Cookie', [authCookie])
        .send({
          mediaIds: ['10000000-0000-0000-0000-000000000001'],
          targetFolderId: eventBFolder.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TARGET_FOLDER');
    });
  });
});
