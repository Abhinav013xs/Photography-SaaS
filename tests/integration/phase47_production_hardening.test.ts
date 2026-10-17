import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import db, { initDatabase } from '../../server/db.js';
import guestRouter from '../../server/routes/guest.js';
import eventRouter from '../../server/routes/events.js';
import authRouter from '../../server/routes/auth.js';
import storage, { assertValidStorageKey } from '../../server/storage/r2.js';
import { signPhotographerToken, authenticatePhotographer } from '../../server/middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

describe('Phase 47: Production Hardening, Security Audit & Reliability Integration Tests', () => {
  let app: express.Express;
  let validToken: string;

  const testEventId = 'a1111111-2222-3333-4444-555555555555';
  const testSlug = 'hardening-test-event-47';

  beforeAll(() => {
    initDatabase();
    validToken = signPhotographerToken({ id: 1, email: 'photographer@studiolumina.photo' });
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Request ID tracking middleware
    app.use((req, res, next) => {
      const reqId = req.headers['x-request-id'] || uuidv4();
      req.id = reqId as string;
      res.setHeader('X-Request-Id', reqId);
      next();
    });

    // Mount health & ready
    app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        live: true,
        timestamp: new Date().toISOString(),
        service: 'Studio Lumina Photography Platform',
        requestId: req.id,
      });
    });

    app.get('/api/ready', (req, res) => {
      try {
        db.prepare('SELECT 1').get();
        res.json({
          status: 'ready',
          ready: true,
          database: 'connected',
          timestamp: new Date().toISOString(),
          requestId: req.id,
        });
      } catch (err: any) {
        res.status(503).json({ status: 'not_ready', error: err.message });
      }
    });

    app.use('/api/auth', authRouter);
    app.use('/api/events', eventRouter);
    app.use('/api/guest', guestRouter);

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({
        error: `Endpoint not found: ${req.method} ${req.path}`,
        code: 'ROUTE_NOT_FOUND',
        requestId: req.id,
      });
    });

    // Reset photographer status to active
    db.prepare("UPDATE photographer SET status = 'active', suspension_reason = NULL WHERE id = 1").run();

    // Clean up test event
    db.prepare('DELETE FROM selection_revisions WHERE selection_id IN (SELECT id FROM selection_collections WHERE event_id = ?)').run(testEventId);
    db.prepare('DELETE FROM selection_items WHERE selection_id IN (SELECT id FROM selection_collections WHERE event_id = ?)').run(testEventId);
    db.prepare('DELETE FROM selection_collections WHERE event_id = ?').run(testEventId);
    db.prepare('DELETE FROM media WHERE event_id = ?').run(testEventId);
    db.prepare('DELETE FROM folders WHERE event_id = ?').run(testEventId);
    db.prepare('DELETE FROM events WHERE id = ?').run(testEventId);
  });

  describe('1. Authentication Revocation & Suspension Enforcement', () => {
    it('allows active photographer requests with valid token', async () => {
      const res = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(false);
      expect(res.body.events).toBeDefined();
    });

    it('rejects suspended photographer requests immediately with HTTP 403', async () => {
      const suspendedPhotographerId = 9947;
      db.prepare(`
        INSERT OR REPLACE INTO photographer (id, email, password_hash, status, suspension_reason)
        VALUES (?, 'suspended@studiolumina.photo', 'dummy_hash', 'suspended', 'Billing default')
      `).run(suspendedPhotographerId);

      const suspendedToken = signPhotographerToken({ id: suspendedPhotographerId, email: 'suspended@studiolumina.photo' });

      const res = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${suspendedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Account Suspended');
      expect(res.body.message).toContain('Billing default');
    });

    it('rejects tokens belonging to nonexistent photographer accounts with HTTP 401', async () => {
      const nonExistentToken = signPhotographerToken({ id: 999999, email: 'ghost@example.com' });

      const res = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${nonExistentToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Account no longer exists');
    });
  });

  describe('2. Dual Health & Readiness Probes & Request ID Tracking', () => {
    it('GET /api/health returns liveness probe with X-Request-Id header', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.live).toBe(true);
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
    });

    it('GET /api/ready returns readiness probe with database verification', async () => {
      const res = await request(app).get('/api/ready');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.ready).toBe(true);
      expect(res.body.database).toBe('connected');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('propagates client-supplied X-Request-Id across responses', async () => {
      const customRequestId = 'req-lumina-custom-trace-999';
      const res = await request(app)
        .get('/api/health')
        .set('x-request-id', customRequestId);

      expect(res.headers['x-request-id']).toBe(customRequestId);
      expect(res.body.requestId).toBe(customRequestId);
    });

    it('returns structured JSON 404 for nonexistent API endpoints with request ID', async () => {
      const res = await request(app).get('/api/non-existent-route-xyz');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROUTE_NOT_FOUND');
      expect(res.body.requestId).toBeDefined();
    });
  });

  describe('3. Cloudflare R2 Storage Security & Path Traversal Defenses', () => {
    it('assertValidStorageKey permits deterministic keys conforming to events/{eventId}/{category}/{filename}', () => {
      const validKey = `events/${testEventId}/originals/wedding_photo_01.jpg`;
      expect(() => assertValidStorageKey(validKey)).not.toThrow();
    });

    it('assertValidStorageKey rejects path traversal sequences (.. and \\)', () => {
      expect(() => assertValidStorageKey(`events/${testEventId}/originals/../../../etc/passwd`)).toThrow(
        /Path traversal/
      );
      expect(() => assertValidStorageKey(`events\\${testEventId}\\originals\\photo.jpg`)).toThrow(
        /Path traversal/
      );
    });

    it('assertValidStorageKey rejects invalid or non-UUID event IDs', () => {
      expect(() => assertValidStorageKey('events/invalid-event-id/originals/photo.jpg')).toThrow(
        /Invalid event UUID/
      );
    });

    it('assertValidStorageKey rejects disallowed categories', () => {
      expect(() => assertValidStorageKey(`events/${testEventId}/secret_dumps/photo.jpg`)).toThrow(
        /Category "secret_dumps" is not permitted/
      );
    });

    it('deleteObjects safely executes batch deletion across storage keys', async () => {
      const testKey1 = `events/${testEventId}/thumbnails/thumb_1.jpg`;
      const testKey2 = `events/${testEventId}/thumbnails/thumb_2.jpg`;

      // Save dummy objects
      await storage.putObject(testKey1, Buffer.from('test 1'), 'image/jpeg');
      await storage.putObject(testKey2, Buffer.from('test 2'), 'image/jpeg');

      expect(await storage.hasObject(testKey1)).toBe(true);
      expect(await storage.hasObject(testKey2)).toBe(true);

      // Batch delete
      await storage.deleteObjects([testKey1, testKey2]);

      expect(await storage.hasObject(testKey1)).toBe(false);
      expect(await storage.hasObject(testKey2)).toBe(false);
    });
  });

  describe('4. Lifecycle & Recycle Bin Data Integrity', () => {
    it('excludes soft-deleted (trashed) events from default event listings', async () => {
      // Create active event
      db.prepare(`
        INSERT INTO events (id, slug, name, client_name, event_date, status, visibility)
        VALUES (?, ?, 'Active Wedding', 'Sarah Connor', '2026-11-01', 'active', 'public')
      `).run(testEventId, testSlug);

      const activeList = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${validToken}`);

      expect(activeList.body.events.some((e: any) => e.id === testEventId)).toBe(true);

      // Move event to Recycle Bin
      const trashRes = await request(app)
        .post(`/api/events/${testEventId}/trash`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(trashRes.status).toBe(200);

      // Verify event is now excluded from default listing
      const updatedList = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${validToken}`);

      expect(updatedList.body.events.some((e: any) => e.id === testEventId)).toBe(false);

      // Verify event is present in Recycle Bin listing
      const binList = await request(app)
        .get('/api/events/bin')
        .set('Authorization', `Bearer ${validToken}`);

      expect(binList.body.events.some((e: any) => e.id === testEventId)).toBe(true);
    });

    it('restores trashed event back to active lifecycle', async () => {
      // Seed trashed event
      db.prepare(`
        INSERT INTO events (id, slug, name, client_name, event_date, status, visibility, deleted_at, purge_after)
        VALUES (?, ?, 'Restored Wedding', 'Sarah Connor', '2026-11-01', 'trashed', 'private', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(testEventId, testSlug);

      const restoreRes = await request(app)
        .post(`/api/events/${testEventId}/restore`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(restoreRes.status).toBe(200);

      const event = db.prepare('SELECT status, deleted_at, purge_after FROM events WHERE id = ?').get(testEventId) as any;
      expect(event.status).toBe('active');
      expect(event.deleted_at).toBeNull();
      expect(event.purge_after).toBeNull();
    });

    it('atomic permanent deletion cascades cleanly across events, media, and selections', async () => {
      // Seed event, folder, media, and selection
      db.prepare(`
        INSERT INTO events (id, slug, name, client_name, event_date, status, visibility)
        VALUES (?, ?, 'Permanent Delete Wedding', 'Sarah Connor', '2026-11-01', 'trashed', 'private')
      `).run(testEventId, testSlug);

      const folderId = uuidv4();
      db.prepare('INSERT INTO folders (id, event_id, name) VALUES (?, ?, ?)').run(folderId, testEventId, 'Folder 1');

      const photoId = uuidv4();
      db.prepare(`
        INSERT INTO media (id, event_id, folder_id, type, filename, original_name, mime_type, file_size, storage_key_original, status)
        VALUES (?, ?, ?, 'photo', 'test.jpg', 'test.jpg', 'image/jpeg', 1000, 'events/dummy', 'ready')
      `).run(photoId, testEventId, folderId);

      const selectionId = uuidv4();
      db.prepare(`
        INSERT INTO selection_collections (id, event_id, session_id, status)
        VALUES (?, ?, 'sess_123', 'submitted')
      `).run(selectionId, testEventId);

      // Permanently delete event
      const permRes = await request(app)
        .delete(`/api/events/${testEventId}/permanent`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(permRes.status).toBe(200);

      // Verify all associated records were purged
      expect(db.prepare('SELECT id FROM events WHERE id = ?').get(testEventId)).toBeUndefined();
      expect(db.prepare('SELECT id FROM folders WHERE event_id = ?').get(testEventId)).toBeUndefined();
      expect(db.prepare('SELECT id FROM media WHERE event_id = ?').get(testEventId)).toBeUndefined();
      expect(db.prepare('SELECT id FROM selection_collections WHERE event_id = ?').get(testEventId)).toBeUndefined();
    });
  });
});
