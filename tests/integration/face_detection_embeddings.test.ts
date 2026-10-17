import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { IMemoryDb } from 'pg-mem';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
  insertTestFaceEmbedding,
} from '../helpers/db_test_helper.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  indexPhotoFaces,
  getPhotoFaceDetections,
} from '../../apps/api/src/services/faceIndexingService.js';
import * as aiClient from '../../apps/api/src/infrastructure/aiClient.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';

describe('Phase 14 & Phase 15: AI Face Detection & Embedding Integration Tests', () => {
  let db: IMemoryDb;

  const eventA = 'a0000000-0000-0000-0000-000000000001';
  const eventB = 'b0000000-0000-0000-0000-000000000002';
  const photoA1 = '10000000-0000-0000-0000-0000000000a1';
  const photoA2 = '10000000-0000-0000-0000-0000000000a2';
  const photoB1 = '20000000-0000-0000-0000-0000000000b1';

  beforeEach(() => {
    db = createTestDatabase();
    insertTestPhotographer(db);

    insertTestEvent(db, { id: eventA, slug: 'wedding-event-a', name: 'Wedding A' });
    insertTestEvent(db, { id: eventB, slug: 'corporate-event-b', name: 'Corporate B' });

    insertTestMedia(db, {
      id: photoA1,
      event_id: eventA,
      filename: 'photo_a1.jpg',
      type: 'photo',
      status: 'ready',
    });
    insertTestMedia(db, {
      id: photoA2,
      event_id: eventA,
      filename: 'photo_a2.jpg',
      type: 'photo',
      status: 'ready',
    });
    insertTestMedia(db, {
      id: photoB1,
      event_id: eventB,
      filename: 'photo_b1.jpg',
      type: 'photo',
      status: 'ready',
    });

    const poolMock = db.adapters.createPg().Pool;
    setDatabasePool(new poolMock());

    // Mock storage getObject to return dummy image buffer
    vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(Buffer.from('dummy_image_data_buffer'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDatabasePool(null);
  });

  describe('Photo Face Indexing Pipeline (indexPhotoFaces)', () => {
    it('indexes a single detected face and updates media.faces_detected', async () => {
      const mockEmbedding = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1) * 0.1);
      const norm = Math.sqrt(mockEmbedding.reduce((s, v) => s + v * v, 0));
      const normalizedVector = mockEmbedding.map(v => v / norm);

      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 1,
        faces: [
          {
            faceIndex: 0,
            boxX: 0.25,
            boxY: 0.30,
            boxW: 0.20,
            boxH: 0.25,
            confidence: 0.95,
            modelName: 'SFace',
            modelVersion: 'v1',
            embedding: normalizedVector,
          },
        ],
      });

      const result = await indexPhotoFaces(photoA1, eventA);

      expect(result.status).toBe('completed');
      expect(result.facesDetected).toBe(1);
      expect(result.embeddingsCount).toBe(1);

      // Verify PostgreSQL table state
      const embeddings = db.public.many(
        `SELECT id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, model_name, model_version
         FROM face_embeddings WHERE photo_id = '${photoA1}'`
      );
      expect(embeddings).toHaveLength(1);
      expect(embeddings[0].event_id).toBe(eventA);
      expect(embeddings[0].confidence).toBeCloseTo(0.95, 2);
      expect(embeddings[0].model_name).toBe('SFace');
      expect(embeddings[0].model_version).toBe('v1');

      // Verify media.faces_detected counter updated
      const mediaRow = db.public.one(`SELECT faces_detected FROM media WHERE id = '${photoA1}'`);
      expect(mediaRow.faces_detected).toBe(1);
    });

    it('indexes multi-face group photograph with multiple bounding boxes', async () => {
      const vec = Array.from({ length: 128 }, () => 1 / Math.sqrt(128));

      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 3,
        faces: [
          { faceIndex: 0, boxX: 0.1, boxY: 0.2, boxW: 0.15, boxH: 0.2, confidence: 0.91, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
          { faceIndex: 1, boxX: 0.4, boxY: 0.22, boxW: 0.16, boxH: 0.21, confidence: 0.88, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
          { faceIndex: 2, boxX: 0.7, boxY: 0.19, boxW: 0.14, boxH: 0.19, confidence: 0.94, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
        ],
      });

      const result = await indexPhotoFaces(photoA2, eventA);

      expect(result.status).toBe('completed');
      expect(result.facesDetected).toBe(3);
      expect(result.embeddingsCount).toBe(3);

      const rows = db.public.many(
        `SELECT face_index, box_x, confidence FROM face_embeddings WHERE photo_id = '${photoA2}' ORDER BY face_index ASC`
      );
      expect(rows).toHaveLength(3);
      expect(rows.map((r: any) => r.face_index)).toEqual([0, 1, 2]);

      const mediaRow = db.public.one(`SELECT faces_detected FROM media WHERE id = '${photoA2}'`);
      expect(mediaRow.faces_detected).toBe(3);
    });

    it('handles zero-face photographs as valid completion with 0 faces recorded', async () => {
      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 0,
        faces: [],
      });

      const result = await indexPhotoFaces(photoA1, eventA);

      expect(result.status).toBe('completed');
      expect(result.facesDetected).toBe(0);
      expect(result.embeddingsCount).toBe(0);

      const rows = db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${photoA1}'`);
      expect(rows).toHaveLength(0);

      const mediaRow = db.public.one(`SELECT faces_detected FROM media WHERE id = '${photoA1}'`);
      expect(mediaRow.faces_detected).toBe(0);
    });

    it('is idempotent: re-indexing replaces existing face embeddings rather than duplicating', async () => {
      const vec = Array.from({ length: 128 }, () => 1 / Math.sqrt(128));

      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 1,
        faces: [{ faceIndex: 0, boxX: 0.2, boxY: 0.2, boxW: 0.2, boxH: 0.2, confidence: 0.90, modelName: 'SFace', modelVersion: 'v1', embedding: vec }],
      });

      // Run 1st index
      await indexPhotoFaces(photoA1, eventA);
      let rows = db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${photoA1}'`);
      expect(rows).toHaveLength(1);

      // Run 2nd index with updated detection
      vi.spyOn(aiClient, 'extractFaceEmbeddings').mockResolvedValue({
        status: 'success',
        faceCount: 2,
        faces: [
          { faceIndex: 0, boxX: 0.2, boxY: 0.2, boxW: 0.2, boxH: 0.2, confidence: 0.90, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
          { faceIndex: 1, boxX: 0.5, boxY: 0.2, boxW: 0.2, boxH: 0.2, confidence: 0.85, modelName: 'SFace', modelVersion: 'v1', embedding: vec },
        ],
      });

      await indexPhotoFaces(photoA1, eventA);
      rows = db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${photoA1}'`);
      expect(rows).toHaveLength(2); // Replaced, not 1 + 2 = 3
    });
  });

  describe('Event Boundary Isolation & Cascade Purge', () => {
    const feA1 = '30000000-0000-0000-0000-0000000000a1';
    const feB1 = '40000000-0000-0000-0000-0000000000b1';

    beforeEach(() => {
      insertTestFaceEmbedding(db, { id: feA1, event_id: eventA, photo_id: photoA1 });
      insertTestFaceEmbedding(db, { id: feB1, event_id: eventB, photo_id: photoB1 });
    });

    it('strictly isolates face embeddings by event_id in database queries', () => {
      const embeddingsA = db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventA}'`);
      expect(embeddingsA).toHaveLength(1);
      expect(embeddingsA[0].id).toBe(feA1);

      const embeddingsB = db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventB}'`);
      expect(embeddingsB).toHaveLength(1);
      expect(embeddingsB[0].id).toBe(feB1);
    });

    it('cascades deletion: deleting media deletes its face embeddings automatically', () => {
      db.public.none(`DELETE FROM media WHERE id = '${photoA1}'`);

      const remainingA = db.public.many(`SELECT id FROM face_embeddings WHERE photo_id = '${photoA1}'`);
      expect(remainingA).toHaveLength(0);

      // Event B embedding is preserved
      const remainingB = db.public.many(`SELECT id FROM face_embeddings WHERE id = '${feB1}'`);
      expect(remainingB).toHaveLength(1);
    });

    it('cascades deletion: deleting event deletes all its face embeddings', () => {
      db.public.none(`DELETE FROM events WHERE id = '${eventA}'`);

      const remainingA = db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventA}'`);
      expect(remainingA).toHaveLength(0);

      const remainingB = db.public.many(`SELECT id FROM face_embeddings WHERE event_id = '${eventB}'`);
      expect(remainingB).toHaveLength(1);
    });

    it('getPhotoFaceDetections returns bounding boxes without exposing raw vector embeddings', async () => {
      const detections = await getPhotoFaceDetections(photoA1, eventA);
      expect(detections).toHaveLength(1);
      const first = detections[0]!;
      expect(first.photoId).toBe(photoA1);
      expect(first.boxX).toBeDefined();
      expect(first.confidence).toBeDefined();
      // Ensure raw embedding is not on the returned object
      expect((first as any).embedding).toBeUndefined();
    });
  });
});
