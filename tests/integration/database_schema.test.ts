import { describe, it, expect, beforeEach } from 'vitest';
import type { IMemoryDb } from 'pg-mem';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
  insertTestFaceEmbedding,
} from '../helpers/db_test_helper.js';

describe('Database Schema Integrity & Relational Constraints', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = createTestDatabase();
    insertTestPhotographer(db);
  });

  describe('Photographer / Owner Constraints', () => {
    it('should enforce unique email constraint on photographer', () => {
      expect(() => {
        db.public.none(
          `INSERT INTO photographer (email, password_hash, business_name)
           VALUES ('photographer@studiolumina.photo', 'hash2', 'Duplicate Studio');`
        );
      }).toThrow();
    });

    it('should reject photographer record without password_hash', () => {
      expect(() => {
        db.public.none(
          `INSERT INTO photographer (email, password_hash, business_name)
           VALUES ('other@studiolumina.photo', NULL, 'Other Studio');`
        );
      }).toThrow();
    });
  });

  describe('Events Constraints', () => {
    it('should reject event referencing a non-existent owner_id', () => {
      expect(() => {
        db.public.none(
          `INSERT INTO events (id, owner_id, slug, name, client_name, event_date)
           VALUES ('e0000000-0000-0000-0000-000000000999', 999, 'bad-event', 'Bad Event', 'Client', '2026-10-10');`
        );
      }).toThrow();
    });

    it('should enforce unique slug across events', () => {
      insertTestEvent(db, { id: 'e0000000-0000-0000-0000-000000000001', slug: 'wedding-slug' });
      expect(() => {
        insertTestEvent(db, { id: 'e0000000-0000-0000-0000-000000000002', slug: 'wedding-slug' });
      }).toThrow();
    });

    it('should enforce valid status enum values on events', () => {
      expect(() => {
        db.public.none(
          `INSERT INTO events (id, owner_id, slug, name, client_name, event_date, status)
           VALUES ('e0000000-0000-0000-0000-000000000003', 1, 'bad-status', 'Test', 'Client', '2026-10-10', 'invalid_status');`
        );
      }).toThrow();
    });

    it('should enforce valid visibility enum values on events', () => {
      expect(() => {
        db.public.none(
          `INSERT INTO events (id, owner_id, slug, name, client_name, event_date, visibility)
           VALUES ('e0000000-0000-0000-0000-000000000004', 1, 'bad-visibility', 'Test', 'Client', '2026-10-10', 'unlisted');`
        );
      }).toThrow();
    });
  });

  describe('Folders Constraints', () => {
    beforeEach(() => {
      insertTestEvent(db, { id: 'e0000000-0000-0000-0000-000000000001', slug: 'event-a' });
      insertTestEvent(db, { id: 'e0000000-0000-0000-0000-000000000002', slug: 'event-b' });
    });

    it('should enforce unique folder name within the same event', () => {
      insertTestFolder(db, {
        id: 'f0000000-0000-0000-0000-000000000001',
        event_id: 'e0000000-0000-0000-0000-000000000001',
        name: 'Ceremony',
      });

      expect(() => {
        insertTestFolder(db, {
          id: 'f0000000-0000-0000-0000-000000000002',
          event_id: 'e0000000-0000-0000-0000-000000000001',
          name: 'Ceremony',
        });
      }).toThrow();
    });

    it('should allow identical folder names across different events', () => {
      const folderA = insertTestFolder(db, {
        id: 'f0000000-0000-0000-0000-000000000001',
        event_id: 'e0000000-0000-0000-0000-000000000001',
        name: 'Ceremony',
      });
      const folderB = insertTestFolder(db, {
        id: 'f0000000-0000-0000-0000-000000000002',
        event_id: 'e0000000-0000-0000-0000-000000000002',
        name: 'Ceremony',
      });

      expect(folderA.name).toBe('Ceremony');
      expect(folderB.name).toBe('Ceremony');
    });
  });

  describe('Media & Safe Folder Deletion Rules', () => {
    const eventA = 'e0000000-0000-0000-0000-000000000001';
    const folderA = 'f0000000-0000-0000-0000-000000000001';

    beforeEach(() => {
      insertTestEvent(db, { id: eventA, slug: 'event-a' });
      insertTestFolder(db, { id: folderA, event_id: eventA, name: 'Ceremony' });
    });

    it('SAFE FOLDER DELETION: deleting a folder must set media.folder_id to NULL and NOT delete the photo', () => {
      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000001',
        event_id: eventA,
        folder_id: folderA,
        filename: 'ceremony_01.jpg',
      });

      // Confirm photo is initially in folderA
      const before = db.public.one(
        `SELECT folder_id FROM media WHERE id = '10000000-0000-0000-0000-000000000001'`
      );
      expect(before.folder_id).toBe(folderA);

      // Delete folderA
      db.public.none(`DELETE FROM folders WHERE id = '${folderA}'`);

      // Verify photo STILL exists, but folder_id is now NULL (Uncategorized)
      const after = db.public.one(
        `SELECT id, folder_id, event_id FROM media WHERE id = '10000000-0000-0000-0000-000000000001'`
      );
      expect(after).toBeDefined();
      expect(after.id).toBe('10000000-0000-0000-0000-000000000001');
      expect(after.event_id).toBe(eventA);
      expect(after.folder_id).toBeNull();
    });

    it('FK INTEGRITY: rejects media referencing a non-existent folder_id', () => {
      expect(() => {
        insertTestMedia(db, {
          id: '10000000-0000-0000-0000-000000000099',
          event_id: eventA,
          folder_id: 'f0000000-0000-0000-0000-000000000999',
        });
      }).toThrow();
    });

    it('should reject media with negative file_size', () => {
      expect(() => {
        insertTestMedia(db, {
          id: '10000000-0000-0000-0000-000000000002',
          event_id: eventA,
          file_size: -100,
        });
      }).toThrow();
    });
  });

  describe('Biometric Face Embeddings & Cascade Rules', () => {
    const eventId = 'e0000000-0000-0000-0000-000000000001';
    const mediaId = '10000000-0000-0000-0000-000000000001';

    beforeEach(() => {
      insertTestEvent(db, { id: eventId });
      insertTestMedia(db, { id: mediaId, event_id: eventId });
    });

    it('should reject face bounding box coordinates outside [0, 1] range', () => {
      expect(() => {
        db.public.none(
          `INSERT INTO face_embeddings (id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, embedding)
           VALUES ('20000000-0000-0000-0000-000000000001', '${eventId}', '${mediaId}', 0, 1.5, 0.1, 0.2, 0.2, 0.95, '[0.1]');`
        );
      }).toThrow();
    });

    it('should cascade delete face embeddings when parent media is deleted', () => {
      insertTestFaceEmbedding(db, {
        id: '20000000-0000-0000-0000-000000000001',
        event_id: eventId,
        photo_id: mediaId,
      });

      // Verify embedding exists
      const before = db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${mediaId}'`);
      expect(before.length).toBe(1);

      // Delete parent media
      db.public.none(`DELETE FROM media WHERE id = '${mediaId}'`);

      // Verify embedding is automatically removed
      const after = db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${mediaId}'`);
      expect(after.length).toBe(0);
    });

    it('should cascade delete all event data when event is deleted', () => {
      const folderId = 'f0000000-0000-0000-0000-000000000001';
      insertTestFolder(db, { id: folderId, event_id: eventId });
      insertTestFaceEmbedding(db, {
        id: '20000000-0000-0000-0000-000000000001',
        event_id: eventId,
        photo_id: mediaId,
      });

      // Delete event
      db.public.none(`DELETE FROM events WHERE id = '${eventId}'`);

      // All child tables should be empty
      expect(db.public.many(`SELECT id FROM folders WHERE event_id = '${eventId}'`).length).toBe(0);
      expect(db.public.many(`SELECT id FROM media WHERE event_id = '${eventId}'`).length).toBe(0);
      expect(db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventId}'`).length).toBe(0);
    });
  });
});
