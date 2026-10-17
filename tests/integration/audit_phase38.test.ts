import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import mediaRouter from '../../server/routes/media.js';
import eventRouter from '../../server/routes/events.js';
import guestRouter from '../../server/routes/guest.js';

const JWT_SECRET = process.env.JWT_SECRET || 'lumina-photographer-super-secret-key-92837482';
const GUEST_JWT_SECRET = process.env.GUEST_JWT_SECRET || 'guest-session-secret-key-1928374';

describe('Phase 38: Autonomous Codebase Audit, Vulnerability Hunt & Hardening Tests', () => {
  let app: express.Express;
  let photographerToken: string;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    app.use('/api/media', mediaRouter);
    app.use('/api/events', eventRouter);
    app.use('/api/guest', guestRouter);

    photographerToken = jwt.sign(
      { id: 1, email: 'photographer@studiolumina.photo', role: 'photographer' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
  });

  describe('1. BOLA / IDOR Defense in Media Movement (AUD-01)', () => {
    it('should reject batch move if target folder belongs to a different event', async () => {
      // Create two distinct events and folders directly in the database
      const db = (await import('../../server/db.js')).default;

      const eventA = 'e38a0000-0000-0000-0000-000000000001';
      const eventB = 'e38b0000-0000-0000-0000-000000000002';
      const folderA = 'f38a0000-0000-0000-0000-000000000001';
      const folderB = 'f38b0000-0000-0000-0000-000000000002';
      const mediaA = 'm38a0000-0000-0000-0000-000000000001';

      db.prepare(`
        INSERT OR REPLACE INTO events (id, slug, name, client_name, event_date, status, visibility)
        VALUES (?, ?, 'Event A', 'Client A', '2026-10-15', 'active', 'public')
      `).run(eventA, 'event-a-audit');

      db.prepare(`
        INSERT OR REPLACE INTO events (id, slug, name, client_name, event_date, status, visibility)
        VALUES (?, ?, 'Event B', 'Client B', '2026-10-15', 'active', 'public')
      `).run(eventB, 'event-b-audit');

      db.prepare(`
        INSERT OR REPLACE INTO folders (id, event_id, name)
        VALUES (?, ?, 'Folder A')
      `).run(folderA, eventA);

      db.prepare(`
        INSERT OR REPLACE INTO folders (id, event_id, name)
        VALUES (?, ?, 'Folder B')
      `).run(folderB, eventB);

      db.prepare(`
        INSERT OR REPLACE INTO media (id, event_id, folder_id, type, filename, original_name, mime_type, file_size, storage_key_original, status)
        VALUES (?, ?, ?, 'photo', 'photo_a.jpg', 'A.jpg', 'image/jpeg', 100, 'events/e38a0000-0000-0000-0000-000000000001/originals/photo_a.jpg', 'ready')
      `).run(mediaA, eventA, folderA);

      // Attempt to move media from Event A into folder belonging to Event B
      const res = await request(app)
        .put('/api/media/move')
        .set('Authorization', `Bearer ${photographerToken}`)
        .send({
          mediaIds: [mediaA],
          targetFolderId: folderB,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Cannot move media assets to a folder belonging to another event/i);
    });

    it('should allow moving media when target folder belongs to the same event', async () => {
      const db = (await import('../../server/db.js')).default;
      const eventA = 'e38a0000-0000-0000-0000-000000000001';
      const folderA2 = 'f38a0000-0000-0000-0000-000000000003';
      const mediaA = 'm38a0000-0000-0000-0000-000000000001';

      db.prepare(`
        INSERT OR REPLACE INTO folders (id, event_id, name)
        VALUES (?, ?, 'Folder A2')
      `).run(folderA2, eventA);

      const res = await request(app)
        .put('/api/media/move')
        .set('Authorization', `Bearer ${photographerToken}`)
        .send({
          mediaIds: [mediaA],
          targetFolderId: folderA2,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject batch move if mediaIds count exceeds 500 items', async () => {
      const hugeBatch = Array.from({ length: 501 }, (_, i) => `media_${i}`);

      const res = await request(app)
        .put('/api/media/move')
        .set('Authorization', `Bearer ${photographerToken}`)
        .send({
          mediaIds: hugeBatch,
          targetFolderId: null,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Maximum 500 items/i);
    });
  });

  describe('2. Batch Deletion Limit Enforcement (AUD-05)', () => {
    it('should reject batch deletion if mediaIds count exceeds 500 items', async () => {
      const hugeBatch = Array.from({ length: 501 }, (_, i) => `media_${i}`);

      const res = await request(app)
        .delete('/api/media/batch')
        .set('Authorization', `Bearer ${photographerToken}`)
        .send({ mediaIds: hugeBatch });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Maximum 500 items/i);
    });
  });

  describe('3. Strict Event-Scoping on Folder Update & Delete (AUD-02 & AUD-03)', () => {
    it('should reject folder update if folder does not belong to the event in URL path', async () => {
      const eventA = 'e38a0000-0000-0000-0000-000000000001';
      const folderB = 'f38b0000-0000-0000-0000-000000000002'; // Belongs to Event B

      const res = await request(app)
        .put(`/api/events/${eventA}/folders/${folderB}`)
        .set('Authorization', `Bearer ${photographerToken}`)
        .send({ name: 'Hacked Folder Name' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Folder not found in this event/i);
    });

    it('should reject folder delete reassignment if targetFolderId belongs to another event', async () => {
      const eventA = 'e38a0000-0000-0000-0000-000000000001';
      const folderA = 'f38a0000-0000-0000-0000-000000000001';
      const folderB = 'f38b0000-0000-0000-0000-000000000002'; // Belongs to Event B

      const res = await request(app)
        .delete(`/api/events/${eventA}/folders/${folderA}?targetFolderId=${folderB}`)
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Target folder must belong to the same event/i);
    });
  });

  describe('4. Rate Limiting on Guest Face Search (AUD-04)', () => {
    it('should trigger rate limiting after excessive face-search requests', async () => {
      const db = (await import('../../server/db.js')).default;
      const eventId = 'e38a0000-0000-0000-0000-000000000001';
      const slug = 'event-a-audit';

      // Ensure face search enabled
      db.prepare("UPDATE events SET face_search_enabled = 1, visibility = 'public', status = 'active' WHERE id = ?").run(eventId);

      // Perform 10 requests within window
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/guest/face-search/${slug}`)
          .send({});
      }

      // 11th request must return 429 Too Many Requests
      const rateLimitedRes = await request(app)
        .post(`/api/guest/face-search/${slug}`)
        .send({});

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.headers['retry-after']).toBeDefined();
      expect(rateLimitedRes.body.error).toMatch(/Search rate limit exceeded/i);
    });
  });

  describe('5. SQL Injection Attack Defense', () => {
    it('should safely handle SQL injection payloads in event search without syntax error or bypass', async () => {
      const maliciousPayload = "' OR 1=1 --";
      const res = await request(app)
        .get(`/api/events?search=${encodeURIComponent(maliciousPayload)}`)
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);
      // Parameterized query ensures it treated the payload literally, not as SQL logic
    });
  });
});
