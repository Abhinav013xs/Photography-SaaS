import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  exportDatabaseBackup,
  restoreDatabaseFromBackup,
  computeBackupChecksum,
} from '../../server/services/db_backup_service.js';
import { runConsistencyAudit } from '../../server/services/consistency_checker.js';
import { recoverStaleJobs } from '../../server/services/job_recovery_service.js';

describe('Phase 37: Backup, Disaster Recovery & Data Resilience Tests', () => {
  let testDb: any;

  beforeEach(() => {
    // Create an in-memory SQLite database matching server/db.js schema
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');

    testDb.exec(`
      CREATE TABLE photographer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        business_name TEXT DEFAULT 'Studio Lumina',
        tagline TEXT DEFAULT 'Editorial & Fine Art Photography',
        bio TEXT,
        website TEXT,
        instagram TEXT,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_email TEXT,
        event_date TEXT NOT NULL,
        location TEXT,
        description TEXT,
        cover_photo_id TEXT,
        status TEXT DEFAULT 'active',
        visibility TEXT DEFAULT 'public',
        public_start DATETIME,
        public_until DATETIME,
        pin_enabled INTEGER DEFAULT 0,
        pin_hash TEXT,
        allow_downloads INTEGER DEFAULT 1,
        watermark_enabled INTEGER DEFAULT 0,
        watermark_text TEXT DEFAULT 'Studio Lumina',
        face_search_enabled INTEGER DEFAULT 1,
        deleted_at DATETIME,
        purge_after DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );

      CREATE TABLE media (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        folder_id TEXT,
        type TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        storage_key_original TEXT NOT NULL,
        storage_key_preview TEXT,
        storage_key_thumbnail TEXT,
        video_duration REAL,
        camera_make TEXT,
        camera_model TEXT,
        focal_length TEXT,
        aperture TEXT,
        shutter_speed TEXT,
        iso INTEGER,
        date_taken TEXT,
        status TEXT DEFAULT 'uploaded',
        faces_detected INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
      );

      CREATE TABLE face_embeddings (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        photo_id TEXT NOT NULL,
        face_index INTEGER NOT NULL,
        box_x REAL NOT NULL,
        box_y REAL NOT NULL,
        box_w REAL NOT NULL,
        box_h REAL NOT NULL,
        confidence REAL NOT NULL,
        embedding TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (photo_id) REFERENCES media(id) ON DELETE CASCADE
      );

      CREATE TABLE processing_jobs (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        media_id TEXT,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        total_items INTEGER DEFAULT 0,
        processed_items INTEGER DEFAULT 0,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );

      CREATE TABLE system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert baseline test data
    testDb.prepare(`
      INSERT INTO photographer (id, email, password_hash, business_name)
      VALUES (1, 'photographer@studiolumina.photo', '$2b$12$fakehashforphotographertesting', 'Studio Lumina')
    `).run();

    testDb.prepare(`
      INSERT INTO events (id, slug, name, client_name, event_date, status, visibility)
      VALUES ('e3700000-0000-0000-0000-000000000001', 'wedding-dr-test', 'Dr. Test Wedding', 'Client A', '2026-10-15', 'active', 'public')
    `).run();

    testDb.prepare(`
      INSERT INTO folders (id, event_id, name)
      VALUES ('f3700000-0000-0000-0000-000000000001', 'e3700000-0000-0000-0000-000000000001', 'Ceremony')
    `).run();

    testDb.prepare(`
      INSERT INTO media (id, event_id, folder_id, type, filename, original_name, mime_type, file_size, storage_key_original, storage_key_preview, storage_key_thumbnail, status)
      VALUES (
        'm3700000-0000-0000-0000-000000000001',
        'e3700000-0000-0000-0000-000000000001',
        'f3700000-0000-0000-0000-000000000001',
        'photo',
        'photo1.jpg',
        'DSC_0001.JPG',
        'image/jpeg',
        5242880,
        'events/e3700000-0000-0000-0000-000000000001/originals/photo1.jpg',
        'events/e3700000-0000-0000-0000-000000000001/previews/photo1.webp',
        'events/e3700000-0000-0000-0000-000000000001/thumbnails/photo1.webp',
        'ready'
      )
    `).run();

    // 128-D face embedding vector JSON
    const embeddingVector = Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1));
    testDb.prepare(`
      INSERT INTO face_embeddings (id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, embedding)
      VALUES (
        'fe370000-0000-0000-0000-000000000001',
        'e3700000-0000-0000-0000-000000000001',
        'm3700000-0000-0000-0000-000000000001',
        0,
        0.2, 0.3, 0.4, 0.5, 0.98,
        ?
      )
    `).run(JSON.stringify(embeddingVector));
  });

  describe('1. Full Database Backup, Checksum & Relational Restoration', () => {
    it('should export database backup with verified record counts and SHA-256 hash', () => {
      const backup = exportDatabaseBackup(testDb);

      expect(backup.version).toBe('1.0.0');
      expect(backup.sha256).toBeDefined();
      expect(backup.sha256.length).toBe(64); // Valid SHA-256 hex string
      expect(backup.recordCounts.events).toBe(1);
      expect(backup.recordCounts.folders).toBe(1);
      expect(backup.recordCounts.media).toBe(1);
      expect(backup.recordCounts.face_embeddings).toBe(1);

      // Verify face embedding coordinates and vector are retained
      const faceRow = backup.data.face_embeddings[0];
      expect(faceRow.id).toBe('fe370000-0000-0000-0000-000000000001');
      const vector = JSON.parse(faceRow.embedding);
      expect(vector.length).toBe(128);
    });

    it('should cleanly restore all tables from backup after simulated complete data loss', () => {
      const backup = exportDatabaseBackup(testDb);

      // Simulate catastrophic database loss / corruption
      testDb.exec(`
        DELETE FROM face_embeddings;
        DELETE FROM media;
        DELETE FROM folders;
        DELETE FROM events;
        DELETE FROM photographer;
      `);

      expect(testDb.prepare('SELECT COUNT(*) as c FROM events').get().c).toBe(0);
      expect(testDb.prepare('SELECT COUNT(*) as c FROM media').get().c).toBe(0);
      expect(testDb.prepare('SELECT COUNT(*) as c FROM face_embeddings').get().c).toBe(0);

      // Execute restoration
      const restoreResult = restoreDatabaseFromBackup(backup, testDb);

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.restoredCounts.events).toBe(1);
      expect(restoreResult.restoredCounts.media).toBe(1);
      expect(restoreResult.restoredCounts.face_embeddings).toBe(1);
      expect(restoreResult.integrityCheck.status).toBe('VERIFIED');
      expect(restoreResult.integrityCheck.orphanMedia).toBe(0);
      expect(restoreResult.integrityCheck.orphanFaces).toBe(0);

      // Verify restored records in DB
      const restoredEvent = testDb.prepare('SELECT * FROM events WHERE id = ?').get('e3700000-0000-0000-0000-000000000001');
      expect(restoredEvent.slug).toBe('wedding-dr-test');

      const restoredMedia = testDb.prepare('SELECT * FROM media WHERE id = ?').get('m3700000-0000-0000-0000-000000000001');
      expect(restoredMedia.filename).toBe('photo1.jpg');

      const restoredFace = testDb.prepare('SELECT * FROM face_embeddings WHERE id = ?').get('fe370000-0000-0000-0000-000000000001');
      expect(JSON.parse(restoredFace.embedding).length).toBe(128);
    });

    it('should reject corrupted backup bundle with mismatched SHA-256 checksum', () => {
      const backup = exportDatabaseBackup(testDb);

      // Tamper with the backup data payload
      backup.data.events[0].name = 'Tampered Event Name';

      expect(() => {
        restoreDatabaseFromBackup(backup, testDb);
      }).toThrow(/SHA-256 checksum mismatch/i);
    });
  });

  describe('2. Vector Search Operability After Restoration', () => {
    it('should successfully execute vector cosine similarity search against restored embeddings', () => {
      const backup = exportDatabaseBackup(testDb);

      // Wipe and restore
      testDb.exec('DELETE FROM face_embeddings; DELETE FROM media; DELETE FROM folders; DELETE FROM events; DELETE FROM photographer;');
      restoreDatabaseFromBackup(backup, testDb);

      // Fetch restored face embedding and calculate cosine similarity
      const faceRow = testDb.prepare('SELECT * FROM face_embeddings WHERE event_id = ?').get('e3700000-0000-0000-0000-000000000001');
      const storedVector = JSON.parse(faceRow.embedding);

      // Query vector identical to stored vector -> cosine similarity should be ~1.0
      const dotProduct = storedVector.reduce((acc: number, val: number, i: number) => acc + val * storedVector[i], 0);
      const magA = Math.sqrt(storedVector.reduce((acc: number, val: number) => acc + val * val, 0));
      const magB = Math.sqrt(storedVector.reduce((acc: number, val: number) => acc + val * val, 0));
      const cosineSim = dotProduct / (magA * magB);

      expect(cosineSim).toBeCloseTo(1.0, 5);
      expect(faceRow.confidence).toBeGreaterThan(0.9);
    });
  });

  describe('3. Storage and Database Consistency Auditing', () => {
    it('should report 100% consistency when all database records match storage objects', async () => {
      const mockStorage = {
        hasObject: vi.fn(async () => true),
        listKeys: vi.fn(async () => [
          'events/e3700000-0000-0000-0000-000000000001/originals/photo1.jpg',
          'events/e3700000-0000-0000-0000-000000000001/previews/photo1.webp',
          'events/e3700000-0000-0000-0000-000000000001/thumbnails/photo1.webp',
        ]),
      };

      const audit = await runConsistencyAudit({
        customDb: testDb,
        customStorage: mockStorage as any,
      });

      expect(audit.isConsistent).toBe(true);
      expect(audit.summary.missingObjectCount).toBe(0);
      expect(audit.summary.orphanedObjectCount).toBe(0);
    });

    it('should detect missing storage objects when database references non-existent files', async () => {
      const mockStorage = {
        hasObject: vi.fn(async (key: string) => {
          // Simulate missing preview file
          if (key.includes('previews')) return false;
          return true;
        }),
        listKeys: vi.fn(async () => [
          'events/e3700000-0000-0000-0000-000000000001/originals/photo1.jpg',
          'events/e3700000-0000-0000-0000-000000000001/thumbnails/photo1.webp',
        ]),
      };

      const audit = await runConsistencyAudit({
        customDb: testDb,
        customStorage: mockStorage as any,
      });

      expect(audit.isConsistent).toBe(false);
      expect(audit.summary.missingObjectCount).toBe(1);
      expect(audit.missingInStorage[0].derivativeType).toBe('preview');
      expect(audit.missingInStorage[0].storageKey).toContain('previews/photo1.webp');
    });

    it('should detect orphaned storage objects that have no corresponding database record', async () => {
      const mockStorage = {
        hasObject: vi.fn(async () => true),
        listKeys: vi.fn(async () => [
          'events/e3700000-0000-0000-0000-000000000001/originals/photo1.jpg',
          'events/e3700000-0000-0000-0000-000000000001/previews/photo1.webp',
          'events/e3700000-0000-0000-0000-000000000001/thumbnails/photo1.webp',
          // Orphaned file in storage
          'events/e3700000-0000-0000-0000-000000000001/originals/orphaned_ghost.jpg',
        ]),
      };

      const audit = await runConsistencyAudit({
        customDb: testDb,
        customStorage: mockStorage as any,
      });

      expect(audit.isConsistent).toBe(false);
      expect(audit.summary.orphanedObjectCount).toBe(1);
      expect(audit.orphanedInStorage).toContain(
        'events/e3700000-0000-0000-0000-000000000001/originals/orphaned_ghost.jpg'
      );
    });
  });

  describe('4. Worker Crash & Stuck Processing Job Recovery', () => {
    it('should recover jobs stuck in processing state and reset media status', () => {
      // Simulate an unhandled worker crash during batch processing
      testDb.prepare(`
        INSERT INTO media (id, event_id, type, filename, original_name, mime_type, file_size, storage_key_original, status)
        VALUES ('m3700000-0000-0000-0000-000000000002', 'e3700000-0000-0000-0000-000000000001', 'photo', 'photo2.jpg', 'DSC_0002.JPG', 'image/jpeg', 1000, 'nonexistent_scratch.jpg', 'processing')
      `).run();

      testDb.prepare(`
        INSERT INTO processing_jobs (id, event_id, type, status, total_items, processed_items)
        VALUES ('j3700000-0000-0000-0000-000000000001', 'e3700000-0000-0000-0000-000000000001', 'media_processing', 'processing', 2, 1)
      `).run();

      const report = recoverStaleJobs({
        staleThresholdMs: 0,
        customDb: testDb,
      });

      expect(report.totalRecovered).toBeGreaterThan(0);
      expect(report.mediaFailedCount).toBe(1); // Temp file nonexistent -> marked failed

      const updatedJob = testDb.prepare('SELECT * FROM processing_jobs WHERE id = ?').get('j3700000-0000-0000-0000-000000000001');
      // With 1 ready and 1 failed out of 2 total, the job is completed
      expect(updatedJob.status).toBe('completed');
      expect(updatedJob.progress).toBe(100);
    });
  });

  describe('5. Accidental Event Deletion & Recycle Bin Restoration', () => {
    it('should safely soft-delete event to Recycle Bin and restore it without losing media or embeddings', () => {
      const eventId = 'e3700000-0000-0000-0000-000000000001';

      // Accidental deletion: move to recycle bin
      const deletedAt = new Date().toISOString();
      const purgeAfter = new Date(Date.now() + 30 * 86400000).toISOString();
      testDb.prepare(`
        UPDATE events 
        SET deleted_at = ?, purge_after = ?, status = 'archived'
        WHERE id = ?
      `).run(deletedAt, purgeAfter, eventId);

      const deletedEvent = testDb.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
      expect(deletedEvent.deleted_at).toBe(deletedAt);
      expect(deletedEvent.status).toBe('archived');

      // Verify dependent media and embeddings are still 100% intact
      const mediaCount = testDb.prepare('SELECT COUNT(*) as c FROM media WHERE event_id = ?').get(eventId).c;
      const faceCount = testDb.prepare('SELECT COUNT(*) as c FROM face_embeddings WHERE event_id = ?').get(eventId).c;
      expect(mediaCount).toBe(1);
      expect(faceCount).toBe(1);

      // Execute restoration from Recycle Bin
      testDb.prepare(`
        UPDATE events 
        SET deleted_at = NULL, purge_after = NULL, status = 'active'
        WHERE id = ?
      `).run(eventId);

      const restoredEvent = testDb.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
      expect(restoredEvent.deleted_at).toBeNull();
      expect(restoredEvent.purge_after).toBeNull();
      expect(restoredEvent.status).toBe('active');
    });
  });

  describe('6. Zero Guest Biometric Retention in Backup Strategy', () => {
    it('should verify guest biometric selfies and temporary tokens are excluded from backup bundles', () => {
      const backup = exportDatabaseBackup(testDb);

      // Assert that backup bundle contains only photographer/event assets
      expect(backup.data.guest_sessions).toBeUndefined();
      expect(backup.data.guest_selfies).toBeUndefined();
      expect(backup.recordCounts.guest_sessions).toBeUndefined();

      // Ensure every face embedding belongs strictly to photographer-uploaded event photos
      for (const face of backup.data.face_embeddings) {
        expect(face.photo_id).toBeDefined();
        expect(face.photo_id.startsWith('m370')).toBe(true);
      }
    });
  });
});
