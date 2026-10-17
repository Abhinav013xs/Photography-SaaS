import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { IMemoryDb } from 'pg-mem';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
} from '../helpers/db_test_helper.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  detectAndRecordFaces,
  getMediaFaceDetections,
} from '../../apps/api/src/services/faceDetectionService.js';
import * as aiClient from '../../apps/api/src/infrastructure/aiClient.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';

describe('Phase 14: AI Face Detection Pipeline Integration Tests', () => {
  let db: IMemoryDb;

  const eventA = 'a0000000-0000-0000-0000-000000000001';
  const eventB = 'b0000000-0000-0000-0000-000000000002';
  const photoA1 = '10000000-0000-0000-0000-0000000000a1';
  const photoA2 = '10000000-0000-0000-0000-0000000000a2';
  const photoB1 = '20000000-0000-0000-0000-0000000000b1';

  beforeEach(() => {
    db = createTestDatabase();
    insertTestPhotographer(db);

    insertTestEvent(db, { id: eventA, slug: 'royal-wedding-event-a', name: 'Wedding A' });
    insertTestEvent(db, { id: eventB, slug: 'corporate-summit-event-b', name: 'Corporate B' });

    insertTestMedia(db, {
      id: photoA1,
      event_id: eventA,
      filename: 'solo_portrait.jpg',
      type: 'photo',
      status: 'ready',
    });
    insertTestMedia(db, {
      id: photoA2,
      event_id: eventA,
      filename: 'group_family.jpg',
      type: 'photo',
      status: 'ready',
    });
    insertTestMedia(db, {
      id: photoB1,
      event_id: eventB,
      filename: 'corporate_headshot.jpg',
      type: 'photo',
      status: 'ready',
    });

    const poolMock = db.adapters.createPg().Pool;
    setDatabasePool(new poolMock());

    vi.spyOn(storageAdapter, 'getObject').mockResolvedValue(Buffer.from('fake_image_bytes'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDatabasePool(null);
  });

  describe('Neural Face Detection & Database Recording', () => {
    it('detects a single face and records bounding box in face_detections table', async () => {
      vi.spyOn(aiClient, 'detectFacesInImage').mockResolvedValue({
        status: 'success',
        faceCount: 1,
        faces: [
          {
            faceIndex: 0,
            boxX: 0.35,
            boxY: 0.20,
            boxW: 0.30,
            boxH: 0.45,
            confidence: 0.945,
            landmarks: [
              { x: 0.42, y: 0.33 },
              { x: 0.58, y: 0.33 },
              { x: 0.50, y: 0.42 },
              { x: 0.44, y: 0.52 },
              { x: 0.56, y: 0.52 },
            ],
          },
        ],
      });

      const result = await detectAndRecordFaces(photoA1, eventA);

      expect(result.status).toBe('completed');
      expect(result.facesDetected).toBe(1);

      // Verify row persisted in PostgreSQL face_detections table
      const rows = db.public.many(
        `SELECT id, event_id, media_id, face_index, box_x, box_y, box_w, box_h, confidence, detector_name, detector_version
         FROM face_detections WHERE media_id = '${photoA1}'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].event_id).toBe(eventA);
      expect(rows[0].face_index).toBe(0);
      expect(rows[0].box_x).toBeCloseTo(0.35, 2);
      expect(rows[0].box_y).toBeCloseTo(0.20, 2);
      expect(rows[0].box_w).toBeCloseTo(0.30, 2);
      expect(rows[0].box_h).toBeCloseTo(0.45, 2);
      expect(rows[0].confidence).toBeCloseTo(0.945, 2);
      expect(rows[0].detector_name).toBe('YuNet');
      expect(rows[0].detector_version).toBe('2023mar');

      // Verify media.faces_detected counter updated
      const media = db.public.one(`SELECT faces_detected FROM media WHERE id = '${photoA1}'`);
      expect(media.faces_detected).toBe(1);
    });

    it('detects multiple faces in group photograph and generates separate records for each face', async () => {
      vi.spyOn(aiClient, 'detectFacesInImage').mockResolvedValue({
        status: 'success',
        faceCount: 3,
        faces: [
          { faceIndex: 0, boxX: 0.1, boxY: 0.2, boxW: 0.15, boxH: 0.2, confidence: 0.91 },
          { faceIndex: 1, boxX: 0.4, boxY: 0.22, boxW: 0.16, boxH: 0.21, confidence: 0.88 },
          { faceIndex: 2, boxX: 0.7, boxY: 0.19, boxW: 0.14, boxH: 0.19, confidence: 0.94 },
        ],
      });

      const result = await detectAndRecordFaces(photoA2, eventA);

      expect(result.status).toBe('completed');
      expect(result.facesDetected).toBe(3);

      const rows = db.public.many(
        `SELECT face_index, box_x, confidence FROM face_detections WHERE media_id = '${photoA2}' ORDER BY face_index ASC`
      );
      expect(rows).toHaveLength(3);
      expect(rows.map((r: any) => r.face_index)).toEqual([0, 1, 2]);

      const media = db.public.one(`SELECT faces_detected FROM media WHERE id = '${photoA2}'`);
      expect(media.faces_detected).toBe(3);
    });

    it('handles zero-face photograph as valid completed result with 0 faces recorded', async () => {
      vi.spyOn(aiClient, 'detectFacesInImage').mockResolvedValue({
        status: 'success',
        faceCount: 0,
        faces: [],
      });

      const result = await detectAndRecordFaces(photoA1, eventA);

      expect(result.status).toBe('completed');
      expect(result.facesDetected).toBe(0);

      const rows = db.public.many(`SELECT id FROM face_detections WHERE media_id = '${photoA1}'`);
      expect(rows).toHaveLength(0);

      const media = db.public.one(`SELECT faces_detected FROM media WHERE id = '${photoA1}'`);
      expect(media.faces_detected).toBe(0);
    });

    it('is idempotent: re-detecting safely replaces prior face detections without duplication', async () => {
      // 1st detection run: 1 face
      vi.spyOn(aiClient, 'detectFacesInImage').mockResolvedValue({
        status: 'success',
        faceCount: 1,
        faces: [{ faceIndex: 0, boxX: 0.2, boxY: 0.2, boxW: 0.2, boxH: 0.2, confidence: 0.90 }],
      });
      await detectAndRecordFaces(photoA1, eventA);
      let rows = db.public.many(`SELECT id FROM face_detections WHERE media_id = '${photoA1}'`);
      expect(rows).toHaveLength(1);

      // 2nd detection run: 2 faces
      vi.spyOn(aiClient, 'detectFacesInImage').mockResolvedValue({
        status: 'success',
        faceCount: 2,
        faces: [
          { faceIndex: 0, boxX: 0.2, boxY: 0.2, boxW: 0.2, boxH: 0.2, confidence: 0.90 },
          { faceIndex: 1, boxX: 0.5, boxY: 0.2, boxW: 0.2, boxH: 0.2, confidence: 0.85 },
        ],
      });
      await detectAndRecordFaces(photoA1, eventA);
      rows = db.public.many(`SELECT id FROM face_detections WHERE media_id = '${photoA1}'`);
      expect(rows).toHaveLength(2); // Safely replaced, not 3
    });
  });

  describe('Event Boundary Isolation & Cascade Guarantees', () => {
    beforeEach(async () => {
      vi.spyOn(aiClient, 'detectFacesInImage').mockResolvedValue({
        status: 'success',
        faceCount: 1,
        faces: [{ faceIndex: 0, boxX: 0.3, boxY: 0.3, boxW: 0.2, boxH: 0.2, confidence: 0.92 }],
      });
      await detectAndRecordFaces(photoA1, eventA);
      await detectAndRecordFaces(photoB1, eventB);
    });

    it('strictly isolates face detections by event_id in database queries', async () => {
      const detectionsA = await getMediaFaceDetections(photoA1, eventA);
      expect(detectionsA).toHaveLength(1);
      const first = detectionsA[0]!;
      expect(first.mediaId).toBe(photoA1);
      expect(first.eventId).toBe(eventA);

      // Attempting to query photoA1 through eventB must return 0 results
      const crossDetections = await getMediaFaceDetections(photoA1, eventB);
      expect(crossDetections).toHaveLength(0);
    });

    it('cascades deletion: deleting media deletes its face detections automatically', () => {
      db.public.none(`DELETE FROM media WHERE id = '${photoA1}'`);

      const remainingA = db.public.many(`SELECT id FROM face_detections WHERE media_id = '${photoA1}'`);
      expect(remainingA).toHaveLength(0);

      // Event B detections remain intact
      const remainingB = db.public.many(`SELECT id FROM face_detections WHERE media_id = '${photoB1}'`);
      expect(remainingB).toHaveLength(1);
    });

    it('cascades deletion: deleting event deletes all its face detections', () => {
      db.public.none(`DELETE FROM events WHERE id = '${eventA}'`);

      const remainingA = db.public.many(`SELECT id FROM face_detections WHERE event_id = '${eventA}'`);
      expect(remainingA).toHaveLength(0);

      const remainingB = db.public.many(`SELECT id FROM face_detections WHERE event_id = '${eventB}'`);
      expect(remainingB).toHaveLength(1);
    });
  });
});
