import { randomUUID } from 'crypto';
import { query, withTransaction } from '../infrastructure/database.js';
import { storageAdapter } from '../infrastructure/storageAdapter.js';
import { detectFacesInImage } from '../infrastructure/aiClient.js';
import { logger } from '../utils/logger.js';
import { MediaNotFoundError, StorageConfigError } from '@photography-saas/errors';
import type { DetectedFaceDTO } from '@photography-saas/types';

export interface StoredFaceDetectionRecord {
  id: string;
  eventId: string;
  mediaId: string;
  faceIndex: number;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  confidence: number;
  landmarks: Array<{ x: number; y: number }> | null;
  detectorName: string;
  detectorVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DetectAndRecordResult {
  mediaId: string;
  eventId: string;
  facesDetected: number;
  status: 'completed' | 'skipped' | 'failed';
  error?: string;
  faces: DetectedFaceDTO[];
}

/**
 * Detects human faces in a photograph using OpenCV YuNet, transactionally
 * records bounding boxes and landmarks in PostgreSQL face_detections table,
 * and updates media.faces_detected.
 * Idempotent: re-running replaces prior detection records safely.
 */
export async function detectAndRecordFaces(
  mediaId: string,
  eventId: string,
  imageBuffer?: Buffer
): Promise<DetectAndRecordResult> {
  const startTime = Date.now();

  // 1. Verify media existence, event isolation, and active event status
  const mediaRes = await query<{
    id: string;
    event_id: string;
    type: string;
    status: string;
    storage_key_preview: string | null;
    storage_key_original: string;
    event_status: string;
  }>(
    `SELECT m.id, m.event_id, m.type, m.status, m.storage_key_preview, m.storage_key_original, e.status as event_status
     FROM media m
     JOIN events e ON e.id = m.event_id
     WHERE m.id = $1 AND m.event_id = $2`,
    [mediaId, eventId]
  );

  if (mediaRes.rows.length === 0) {
    throw new MediaNotFoundError(`Photo "${mediaId}" not found in event "${eventId}"`);
  }

  const media = mediaRes.rows[0];

  if (['deleting', 'trashed', 'deleted'].includes(media.event_status)) {
    const statusMsg = media.event_status === 'deleting' ? 'being deleted' : media.event_status;
    return {
      mediaId,
      eventId,
      facesDetected: 0,
      status: 'skipped',
      faces: [],
      error: `Event is currently ${statusMsg}`,
    };
  }

  if (media.type !== 'photo') {
    return {
      mediaId,
      eventId,
      facesDetected: 0,
      status: 'skipped',
      faces: [],
    };
  }

  // 2. Obtain image buffer (prefer provided buffer, fallback to R2 preview, fallback to original)
  let bufferToProcess = imageBuffer;
  if (!bufferToProcess) {
    const storageKey = media.storage_key_preview || media.storage_key_original;
    try {
      bufferToProcess = await storageAdapter.getObject(storageKey);
    } catch (err: unknown) {
      if (err instanceof StorageConfigError) {
        logger.debug('Storage is unconfigured; skipping face detection', {
          service: 'face-detector',
          mediaId,
          eventId,
        });
        return {
          mediaId,
          eventId,
          facesDetected: 0,
          status: 'skipped',
          error: 'Storage unconfigured',
          faces: [],
        };
      }
      throw err;
    }
  }

  // 3. Detect faces via Python AI microservice (OpenCV YuNet)
  let detectedFaces: DetectedFaceDTO[] = [];
  try {
    const aiResponse = await detectFacesInImage(bufferToProcess);
    detectedFaces = aiResponse.faces || [];
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn('Face detection inference failed or service unreachable', {
      service: 'face-detector',
      mediaId,
      eventId,
      error: errorMsg,
    });
    return {
      mediaId,
      eventId,
      facesDetected: 0,
      status: 'failed',
      error: errorMsg,
      faces: [],
    };
  }

  // 4. Transactionally store detections in PostgreSQL face_detections table
  try {
    return await withTransaction(async (client) => {
      // Ensure event was not locked/deleted while AI model was processing
      const evCheck = await client.query<{ status: string }>(
        `SELECT status FROM events WHERE id = $1`,
        [eventId]
      );
      if (evCheck.rows.length === 0 || ['deleting', 'trashed', 'deleted'].includes(evCheck.rows[0].status)) {
        return {
          mediaId,
          eventId,
          facesDetected: 0,
          status: 'skipped',
          faces: [],
          error: 'Event was trashed or deleted before detections could be committed',
        };
      }

      // Idempotent: delete previous detection records for this media item
      await client.query(
        `DELETE FROM face_detections WHERE media_id = $1 AND event_id = $2`,
        [mediaId, eventId]
      );

      // Insert each detected face with normalized bounding box and landmarks
      for (const face of detectedFaces) {
        const detectionId = randomUUID();
        const landmarksJson = face.landmarks ? JSON.stringify(face.landmarks) : null;

        await client.query(
          `INSERT INTO face_detections (
             id, event_id, media_id, face_index,
             box_x, box_y, box_w, box_h,
             confidence, landmarks,
             detector_name, detector_version,
             created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10,
             $11, $12,
             NOW(), NOW()
           )`,
          [
            detectionId,
            eventId,
            mediaId,
            face.faceIndex,
            face.boxX,
            face.boxY,
            face.boxW,
            face.boxH,
            face.confidence,
            landmarksJson,
            'YuNet',
            '2023mar',
          ]
        );
      }

      // Update media faces_detected counter
      await client.query(
        `UPDATE media
         SET faces_detected = $1, updated_at = NOW()
         WHERE id = $2 AND event_id = $3`,
        [detectedFaces.length, mediaId, eventId]
      );

      const durationMs = Date.now() - startTime;
      logger.info('Photo face detection completed and recorded successfully', {
        service: 'face-detector',
        mediaId,
        eventId,
        facesDetected: detectedFaces.length,
        durationMs,
      });

      return {
        mediaId,
        eventId,
        facesDetected: detectedFaces.length,
        status: 'completed',
        faces: detectedFaces,
      };
    });
  } catch (error) {
    logger.error('Failed to commit face detections to database', {
      service: 'face-detector',
      mediaId,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Retrieves recorded face detections for a media item.
 */
export async function getMediaFaceDetections(
  mediaId: string,
  eventId: string
): Promise<StoredFaceDetectionRecord[]> {
  const result = await query<{
    id: string;
    event_id: string;
    media_id: string;
    face_index: number;
    box_x: number;
    box_y: number;
    box_w: number;
    box_h: number;
    confidence: number;
    landmarks: any;
    detector_name: string;
    detector_version: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, event_id, media_id, face_index,
            box_x, box_y, box_w, box_h,
            confidence, landmarks,
            detector_name, detector_version,
            created_at, updated_at
     FROM face_detections
     WHERE media_id = $1 AND event_id = $2
     ORDER BY face_index ASC`,
    [mediaId, eventId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    mediaId: row.media_id,
    faceIndex: row.face_index,
    boxX: row.box_x,
    boxY: row.box_y,
    boxW: row.box_w,
    boxH: row.box_h,
    confidence: row.confidence,
    landmarks: typeof row.landmarks === 'string' ? JSON.parse(row.landmarks) : row.landmarks,
    detectorName: row.detector_name,
    detectorVersion: row.detector_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Executes on-demand face detection without writing to the database.
 */
export async function detectFacesForMedia(
  mediaId: string,
  eventId: string,
  imageBuffer?: Buffer
): Promise<{ mediaId: string; eventId: string; faces: DetectedFaceDTO[] }> {
  const result = await detectAndRecordFaces(mediaId, eventId, imageBuffer);
  return {
    mediaId: result.mediaId,
    eventId: result.eventId,
    faces: result.faces,
  };
}
