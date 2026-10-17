import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';
import db, { initDatabase } from '../../server/db.js';
import guestRouter from '../../server/routes/guest.js';
import eventRouter from '../../server/routes/events.js';
import authRouter from '../../server/routes/auth.js';
import { signPhotographerToken } from '../../server/middleware/auth.js';
import SelectionService from '../../server/services/selection_service.js';

describe('Phase 46: Client Photo Selection, Proofing, Favorites & Package Quotas Integration Tests', () => {
  let app: express.Express;
  let photographerToken: string;

  const testEventId = 'test_event_proofing_1';
  const testEventSlug = 'proofing-wedding-test-46';
  const testPhotoIds = ['photo_p46_1', 'photo_p46_2', 'photo_p46_3', 'photo_p46_4'];
  const testGuestSessionId = 'guest_sess_alice_46';

  beforeAll(() => {
    initDatabase();

    photographerToken = signPhotographerToken({
      id: 1,
      email: 'photographer@studiolumina.photo',
    });
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/guest', guestRouter);
    app.use('/api/events', eventRouter);
    app.use('/api/auth', authRouter);

    // Clean up test event and associated records
    db.prepare('DELETE FROM selection_revisions WHERE selection_id IN (SELECT id FROM selection_collections WHERE event_id = ?)').run(testEventId);
    db.prepare('DELETE FROM selection_items WHERE selection_id IN (SELECT id FROM selection_collections WHERE event_id = ?)').run(testEventId);
    db.prepare('DELETE FROM selection_collections WHERE event_id = ?').run(testEventId);
    db.prepare('DELETE FROM media WHERE event_id = ?').run(testEventId);
    db.prepare('DELETE FROM events WHERE id = ?').run(testEventId);

    // Seed test event with package quota of 3 photos
    db.prepare(`
      INSERT INTO events (
        id, slug, name, client_name, client_email, event_date, status, visibility,
        client_selection_mode, selection_package_name, selection_package_quota,
        selection_min_quota, selection_allow_extra, selection_allow_changes_after_submission,
        selection_requires_approval, selection_multiple_rounds
      ) VALUES (
        ?, ?, 'Elena & Julian Wedding', 'Elena Rostova', 'elena@example.com', '2026-10-25', 'active', 'public',
        'package_quota', 'Fine-Art Heirloom Package', 3,
        1, 0, 1,
        1, 1
      )
    `).run(testEventId, testEventSlug);

    // Seed test photos in media table
    const insertMedia = db.prepare(`
      INSERT INTO media (
        id, event_id, type, filename, original_name, mime_type, file_size, status,
        storage_key_original, storage_key_preview, storage_key_thumbnail
      ) VALUES (?, ?, 'photo', ?, ?, 'image/jpeg', 4500000, 'ready', ?, ?, ?)
    `);

    for (let i = 0; i < testPhotoIds.length; i++) {
      const pid = testPhotoIds[i];
      insertMedia.run(
        pid,
        testEventId,
        `${pid}.jpg`,
        `Wedding_Ceremony_${i + 1}.jpg`,
        `events/${testEventId}/originals/${pid}.jpg`,
        `events/${testEventId}/previews/${pid}.jpg`,
        `events/${testEventId}/thumbnails/${pid}.jpg`
      );
    }
  });

  describe('1. Selection Initialization & Event Metadata', () => {
    it('returns event metadata with client selection configuration for guests', async () => {
      const res = await request(app).get(`/api/guest/event/${testEventSlug}`);
      expect(res.status).toBe(200);
      expect(res.body.event).toBeDefined();
      expect(res.body.event.client_selection_mode).toBe('package_quota');
      expect(res.body.event.selection_package_name).toBe('Fine-Art Heirloom Package');
      expect(res.body.event.selection_package_quota).toBe(3);
      expect(res.body.event.selection_min_quota).toBe(1);
    });

    it('initializes an active selection collection for a guest session', async () => {
      const res = await request(app)
        .get(`/api/guest/selection/${testEventSlug}`)
        .set('x-guest-session-id', testGuestSessionId);

      expect(res.status).toBe(200);
      expect(res.body.collection).toBeDefined();
      expect(res.body.collection.event_id).toBe(testEventId);
      expect(res.body.collection.status).toBe('draft');
      expect(res.body.collection.quota).toBe(3);
      expect(res.body.collection.selected_count).toBe(0);
      expect(res.body.collection.favorites_count).toBe(0);
      expect(res.body.items).toEqual({});
    });
  });

  describe('2. Favorites vs. Selection Separation & Quota Enforcement', () => {
    it('allows unlimited favorites without consuming package quota', async () => {
      // Favorite photo 1
      const fav1 = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[0], isFavorite: true });

      expect(fav1.status).toBe(200);
      expect(fav1.body.favoritesCount).toBe(1);
      expect(fav1.body.selectedCount).toBe(0);

      // Favorite photo 2
      const fav2 = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[1], isFavorite: true });

      expect(fav2.status).toBe(200);
      expect(fav2.body.favoritesCount).toBe(2);
      expect(fav2.body.selectedCount).toBe(0);

      // Unfavorite photo 1
      const unfav1 = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[0], isFavorite: false });

      expect(unfav1.status).toBe(200);
      expect(unfav1.body.favoritesCount).toBe(1);
    });

    it('strictly enforces package quota when selecting photos', async () => {
      // Select Photo 1 (1 / 3)
      const sel1 = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[0], isSelected: true });
      expect(sel1.status).toBe(200);
      expect(sel1.body.selectedCount).toBe(1);

      // Select Photo 2 (2 / 3)
      const sel2 = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[1], isSelected: true });
      expect(sel2.status).toBe(200);
      expect(sel2.body.selectedCount).toBe(2);

      // Select Photo 3 (3 / 3 - Quota Reached)
      const sel3 = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[2], isSelected: true });
      expect(sel3.status).toBe(200);
      expect(sel3.body.selectedCount).toBe(3);
      expect(sel3.body.quotaReached).toBe(true);

      // Attempt Photo 4 (4 / 3 - Exceeds Quota)
      const sel4 = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[3], isSelected: true });

      expect(sel4.status).toBe(400);
      expect(sel4.body.code).toBe('PACKAGE_QUOTA_REACHED');
      expect(sel4.body.quota).toBe(3);
      expect(sel4.body.selectedCount).toBe(3);

      // Verify that unselecting Photo 1 allows selecting Photo 4
      const unsel1 = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[0], isSelected: false });
      expect(unsel1.status).toBe(200);
      expect(unsel1.body.selectedCount).toBe(2);

      const sel4Retry = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[3], isSelected: true });
      expect(sel4Retry.status).toBe(200);
      expect(sel4Retry.body.selectedCount).toBe(3);
    });
  });

  describe('3. Submission & Revision History Workflow', () => {
    it('rejects submission when selected count is 0', async () => {
      const res = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/submit`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ clientName: 'Elena Rostova', notes: 'Empty submission' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('EMPTY_SELECTION');
    });

    it('submits selection, snapshots revision, and transitions status to submitted', async () => {
      // Select 2 photos
      await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[0], isSelected: true });

      await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[1], isSelected: true });

      const submitRes = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/submit`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({
          clientName: 'Elena Rostova',
          clientEmail: 'elena@example.com',
          notes: 'Please retouch cover image',
        });

      expect(submitRes.status).toBe(200);
      expect(submitRes.body.success).toBe(true);
      expect(submitRes.body.selection.status).toBe('submitted');
      expect(submitRes.body.selection.client_name).toBe('Elena Rostova');
      expect(submitRes.body.submittedCount).toBe(2);
      expect(submitRes.body.version).toBe(2);

      // Verify revision record exists
      const rev = db.prepare('SELECT * FROM selection_revisions WHERE selection_id = ?').get(submitRes.body.selection.id);
      expect(rev).toBeDefined();
      expect(rev.selected_count).toBe(2);
      const photoIds = JSON.parse(rev.photo_ids);
      expect(photoIds).toContain(testPhotoIds[0]);
      expect(photoIds).toContain(testPhotoIds[1]);
    });
  });

  describe('4. Photographer Review, Change Requests & Approval Workflow', () => {
    let activeSelectionId: string;

    beforeEach(async () => {
      // Setup submitted selection with 2 photos
      await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[0], isSelected: true });

      await request(app)
        .post(`/api/guest/selection/${testEventSlug}/item`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ photoId: testPhotoIds[1], isSelected: true });

      const submitRes = await request(app)
        .post(`/api/guest/selection/${testEventSlug}/submit`)
        .set('x-guest-session-id', testGuestSessionId)
        .send({ clientName: 'Elena Rostova' });

      activeSelectionId = submitRes.body.selection.id;
    });

    it('allows photographer to list and inspect selections for an event', async () => {
      const listRes = await request(app)
        .get(`/api/events/${testEventId}/selections`)
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.totalCount).toBeGreaterThanOrEqual(1);

      const detailRes = await request(app)
        .get(`/api/events/${testEventId}/selections/${activeSelectionId}`)
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.selection.id).toBe(activeSelectionId);
      expect(detailRes.body.revisions.length).toBeGreaterThanOrEqual(1);
    });

    it('allows photographer to request changes with custom feedback', async () => {
      const changeRes = await request(app)
        .post(`/api/events/${testEventId}/selections/${activeSelectionId}/request-changes`)
        .set('Authorization', `Bearer ${photographerToken}`)
        .send({ feedback: 'Please select 1 more portrait photo to complete your package.' });

      expect(changeRes.status).toBe(200);
      expect(changeRes.body.selection.status).toBe('changes_requested');
      expect(changeRes.body.selection.photographer_feedback).toBe('Please select 1 more portrait photo to complete your package.');

      // Verify guest sees changes_requested status
      const guestCheck = await request(app)
        .get(`/api/guest/selection/${testEventSlug}`)
        .set('x-guest-session-id', testGuestSessionId);

      expect(guestCheck.status).toBe(200);
      expect(guestCheck.body.collection.status).toBe('changes_requested');
      expect(guestCheck.body.collection.photographer_feedback).toContain('Please select 1 more portrait');
    });

    it('allows photographer to approve selection and prepare delivery', async () => {
      const approveRes = await request(app)
        .post(`/api/events/${testEventId}/selections/${activeSelectionId}/approve`)
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.selection.status).toBe('approved');
      expect(approveRes.body.selection.approved_at).toBeDefined();

      // Update delivery status to ready
      const deliveryRes = await request(app)
        .post(`/api/events/${testEventId}/selections/${activeSelectionId}/delivery`)
        .set('Authorization', `Bearer ${photographerToken}`)
        .send({
          deliveryStatus: 'ready',
          deliveryLink: 'https://cloud.studiolumina.photo/delivery/elena_final.zip',
        });

      expect(deliveryRes.status).toBe(200);
      expect(deliveryRes.body.selection.delivery_status).toBe('ready');

      // Guest accesses delivery link
      const guestDelivery = await request(app)
        .get(`/api/guest/selection/${testEventSlug}/delivery`)
        .set('x-guest-session-id', testGuestSessionId);

      expect(guestDelivery.status).toBe(200);
      expect(guestDelivery.body.deliveryStatus).toBe('ready');
      expect(guestDelivery.body.deliveryLink).toBe('https://cloud.studiolumina.photo/delivery/elena_final.zip');
    });
  });

  describe('5. Security, IDOR & Biometric Protection', () => {
    it('prevents guests from accessing or mutating selections of other events', async () => {
      // Create Event B
      const eventBId = 'event_b_isolated';
      const eventBSlug = 'isolated-event-b';
      db.prepare(`
        INSERT INTO events (id, slug, name, client_name, event_date, status, visibility, client_selection_mode)
        VALUES (?, ?, 'Event B', 'Client B', '2026-11-01', 'active', 'public', 'package_quota')
      `).run(eventBId, eventBSlug);

      // Attempt to add Event A's photo to Event B's selection
      const res = await request(app)
        .post(`/api/guest/selection/${eventBSlug}/item`)
        .set('x-guest-session-id', 'guest_b')
        .send({ photoId: testPhotoIds[0], isSelected: true });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Photo does not exist in this event');

      db.prepare('DELETE FROM events WHERE id = ?').run(eventBId);
    });

    it('rejects unauthorized guest access to photographer approval endpoints', async () => {
      const res = await request(app)
        .post(`/api/events/${testEventId}/selections/fake_selection/approve`);

      expect(res.status).toBe(401);
    });

    it('verifies that selection endpoints never expose raw 128-D face embeddings or biometric vectors', async () => {
      const res = await request(app)
        .get(`/api/guest/selection/${testEventSlug}`)
        .set('x-guest-session-id', testGuestSessionId);

      expect(res.status).toBe(200);
      const str = JSON.stringify(res.body);
      expect(str).not.toContain('embedding');
      expect(str).not.toContain('box_x');
      expect(str).not.toContain('confidence');
    });
  });

  describe('6. Count Reconciliation & Integrity', () => {
    it('safely repairs tampered selection counts', async () => {
      // Initialize selection
      const { collection } = SelectionService.getOrInitSelection(testEventId, testGuestSessionId);

      // Select 2 items
      SelectionService.updateItem(testEventId, testGuestSessionId, { photoId: testPhotoIds[0], isSelected: true });
      SelectionService.updateItem(testEventId, testGuestSessionId, { photoId: testPhotoIds[1], isSelected: true });

      // Deliberately tamper with selected_count in DB
      db.prepare('UPDATE selection_collections SET selected_count = 999 WHERE id = ?').run(collection.id);

      // Run reconciliation
      const rec = SelectionService.reconcileSelectionCounts(collection.id);
      expect(rec.selectedCount).toBe(2);
      expect(rec.deltaSelected).toBe(-997);

      const repaired = db.prepare('SELECT selected_count FROM selection_collections WHERE id = ?').get(collection.id);
      expect(repaired.selected_count).toBe(2);
    });
  });
});
