import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { createTestDatabase, insertTestMedia } from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';

describe('Complete Photographer Event & Folder Lifecycle Flow', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'CompleteLifecyclePassword2026!';
  let authCookie: string;
  let eventId: string;
  let ceremonyFolderId: string;
  let receptionFolderId: string;
  let portraitsFolderId: string;

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

    // Login
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

  it('Step 1: Create a client event container', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('Cookie', [authCookie])
      .send({
        name: 'Zara & Kabir — Palace Wedding',
        client_name: 'Zara Mehta',
        client_email: 'zara@example.com',
        event_date: '2026-12-18',
        location: 'Umaid Bhawan Palace, Jodhpur',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    eventId = res.body.data.event.id;
    expect(eventId).toBeDefined();
  });

  it('Step 2: Inspect initial folder list (must be empty with 0 media)', async () => {
    const res = await request(app)
      .get(`/api/events/${eventId}/folders`)
      .set('Cookie', [authCookie]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.folders).toHaveLength(0);
    expect(res.body.data.root_media_count).toBe(0);
    expect(res.body.data.total_media_count).toBe(0);
  });

  it('Step 3: Create multiple ceremony folders (Ceremony, Reception, Portraits)', async () => {
    // 1. Ceremony
    const res1 = await request(app)
      .post(`/api/events/${eventId}/folders`)
      .set('Cookie', [authCookie])
      .send({ name: 'Ceremony' });
    expect(res1.status).toBe(201);
    ceremonyFolderId = res1.body.data.folder.id;

    // 2. Reception
    const res2 = await request(app)
      .post(`/api/events/${eventId}/folders`)
      .set('Cookie', [authCookie])
      .send({ name: 'Reception' });
    expect(res2.status).toBe(201);
    receptionFolderId = res2.body.data.folder.id;

    // 3. Portraits
    const res3 = await request(app)
      .post(`/api/events/${eventId}/folders`)
      .set('Cookie', [authCookie])
      .send({ name: 'Couple Portraits' });
    expect(res3.status).toBe(201);
    portraitsFolderId = res3.body.data.folder.id;

    // Verify all 3 appear in order
    const listRes = await request(app)
      .get(`/api/events/${eventId}/folders`)
      .set('Cookie', [authCookie]);
    expect(listRes.body.data.folders).toHaveLength(3);
    expect(listRes.body.data.folders.map((f: any) => f.name)).toEqual([
      'Ceremony',
      'Reception',
      'Couple Portraits',
    ]);
  });

  it('Step 4: Associate media items with Ceremony folder and Event Root', async () => {
    // 2 photos in Ceremony
    insertTestMedia(db, {
      id: '50000000-0000-0000-0000-000000000001',
      event_id: eventId,
      folder_id: ceremonyFolderId,
    });
    insertTestMedia(db, {
      id: '50000000-0000-0000-0000-000000000002',
      event_id: eventId,
      folder_id: ceremonyFolderId,
    });

    // 1 photo in Event Root
    insertTestMedia(db, {
      id: '50000000-0000-0000-0000-000000000003',
      event_id: eventId,
      folder_id: null,
    });

    const listRes = await request(app)
      .get(`/api/events/${eventId}/folders`)
      .set('Cookie', [authCookie]);

    const ceremony = listRes.body.data.folders.find((f: any) => f.id === ceremonyFolderId);
    expect(ceremony.media_count).toBe(2);
    expect(listRes.body.data.root_media_count).toBe(1);
    expect(listRes.body.data.total_media_count).toBe(3);
  });

  it('Step 5: Move media between folders and root', async () => {
    // Move photo 1 from Ceremony to Reception
    const moveRes = await request(app)
      .patch(`/api/events/${eventId}/media/50000000-0000-0000-0000-000000000001/folder`)
      .set('Cookie', [authCookie])
      .send({ folderId: receptionFolderId });

    expect(moveRes.status).toBe(200);
    expect(moveRes.body.data.media.folder_id).toBe(receptionFolderId);

    // Verify updated counts
    const listRes = await request(app)
      .get(`/api/events/${eventId}/folders`)
      .set('Cookie', [authCookie]);

    const ceremony = listRes.body.data.folders.find((f: any) => f.id === ceremonyFolderId);
    const reception = listRes.body.data.folders.find((f: any) => f.id === receptionFolderId);
    expect(ceremony.media_count).toBe(1);
    expect(reception.media_count).toBe(1);
  });

  it('Step 6: Rename Reception folder to "Grand Sangeet & Reception"', async () => {
    const renameRes = await request(app)
      .patch(`/api/events/${eventId}/folders/${receptionFolderId}`)
      .set('Cookie', [authCookie])
      .send({ name: 'Grand Sangeet & Reception' });

    expect(renameRes.status).toBe(200);
    expect(renameRes.body.data.folder.name).toBe('Grand Sangeet & Reception');
    expect(renameRes.body.data.folder.media_count).toBe(1); // Media survives rename
  });

  it('Step 7: SAFE DELETION — Delete Ceremony folder (photos must safely move to Event Root)', async () => {
    const deleteRes = await request(app)
      .delete(`/api/events/${eventId}/folders/${ceremonyFolderId}`)
      .set('Cookie', [authCookie]);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.media_reassigned_count).toBe(1);

    // Inspect list: Ceremony is gone, root media count increased from 1 to 2
    const listRes = await request(app)
      .get(`/api/events/${eventId}/folders`)
      .set('Cookie', [authCookie]);

    expect(listRes.body.data.folders).toHaveLength(2);
    expect(listRes.body.data.folders.some((f: any) => f.id === ceremonyFolderId)).toBe(false);
    expect(listRes.body.data.root_media_count).toBe(2);
    expect(listRes.body.data.total_media_count).toBe(3); // Zero media destroyed!
  });
});
