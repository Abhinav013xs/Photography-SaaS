import { randomUUID } from 'crypto';
import { query, withTransaction } from '../infrastructure/database.js';
import { storageAdapter } from '../infrastructure/storageAdapter.js';
import { extractFaceEmbeddings } from '../infrastructure/aiClient.js';
import { logger } from '../utils/logger.js';
import {
  MediaNotFoundError,
  ValidationError,
  StorageConfigError,
} from '@photography-saas/errors';
import type {
  IndexPhotoFacesResult,
  ExtractedFaceEmbeddingDTO,
} from '@photography-saas/types';

export interface StoredFaceDetection {
  id: string;
  eventId: string;
  photoId: string;
  faceIndex: number;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  confidence: number;
  modelName: string;
  modelVersion: string;
  createdAt: Date;
}

/**
 * Extracts neural face embeddings using OpenCV YuNet + SFace and stores
 * 128-D vectors in PostgreSQL face_embeddings table.
 * Strictly enforces event isolation and ensures idempotency.
 */
export async function indexPhotoFaces(
  mediaId: string,
  eventId: string,
  imageBuffer?: Buffer
): Promise<IndexPhotoFacesResult> {
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
      embeddingsCount: 0,
      status: 'skipped',
      error: `Event is currently ${statusMsg}`,
    };
  }

  // Face indexing is only valid for photo assets
  if (media.type !== 'photo') {
    return {
      mediaId,
      eventId,
      facesDetected: 0,
      embeddingsCount: 0,
      status: 'skipped',
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
        logger.debug('Storage is unconfigured; skipping face indexing for photo', {
          service: 'face-indexer',
          mediaId,
          eventId,
        });
        return {
          mediaId,
          eventId,
          facesDetected: 0,
          embeddingsCount: 0,
          status: 'skipped',
          error: 'Storage unconfigured',
        };
      }
      throw err;
    }
  }

  // 3. Extract 128-D embeddings from AI microservice
  let detectedFaces: ExtractedFaceEmbeddingDTO[] = [];
  try {
    const aiResponse = await extractFaceEmbeddings(bufferToProcess);
    detectedFaces = aiResponse.faces || [];
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn('AI microservice face embedding extraction failed or unreachable', {
      service: 'face-indexer',
      mediaId,
      eventId,
      error: errorMsg,
    });
    return {
      mediaId,
      eventId,
      facesDetected: 0,
      embeddingsCount: 0,
      status: 'failed',
      error: errorMsg,
    };
  }

  // 4. Transactionally store embeddings in PostgreSQL with pgvector
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
          embeddingsCount: 0,
          status: 'skipped',
          error: 'Event was trashed or deleted before embeddings could be committed',
        };
      }

      // Idempotent: delete any prior face embeddings for this photo
      await client.query(
        `DELETE FROM face_embeddings WHERE photo_id = $1 AND event_id = $2`,
        [mediaId, eventId]
      );

      // Insert newly extracted face embeddings
      for (const face of detectedFaces) {
        // Validate vector dimension
        if (!Array.isArray(face.embedding) || face.embedding.length !== 128) {
          throw new ValidationError(`Invalid face embedding vector dimension: expected 128 elements`);
        }

        // Format vector as string for pgvector: '[v1,v2,...,v128]'
        const vectorStr = `[${face.embedding.join(',')}]`;
        const embeddingId = randomUUID();

        await client.query(
          `INSERT INTO face_embeddings (
             id, event_id, photo_id, face_index,
             box_x, box_y, box_w, box_h,
             confidence, model_name, model_version,
             embedding, created_at
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10, $11,
             $12::vector, NOW()
           )`,
          [
            embeddingId,
            eventId,
            mediaId,
            face.faceIndex,
            face.boxX,
            face.boxY,
            face.boxW,
            face.boxH,
            face.confidence,
            face.modelName || 'SFace',
            face.modelVersion || 'v1',
            vectorStr,
          ]
        );
      }

      // Update media faces_detected count
      await client.query(
        `UPDATE media
         SET faces_detected = $1, updated_at = NOW()
         WHERE id = $2 AND event_id = $3`,
        [detectedFaces.length, mediaId, eventId]
      );

      const durationMs = Date.now() - startTime;
      logger.info('Photo face indexing completed successfully', {
        service: 'face-indexer',
        mediaId,
        eventId,
        facesDetected: detectedFaces.length,
        durationMs,
      });

      return {
        mediaId,
        eventId,
        facesDetected: detectedFaces.length,
        embeddingsCount: detectedFaces.length,
        status: 'completed',
      };
    });
  } catch (error) {
    logger.error('Failed to commit photo face embeddings to database', {
      service: 'face-indexer',
      mediaId,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Retrieves face detections for a photo without exposing raw embedding vectors.
 */
export async function getPhotoFaceDetections(
  mediaId: string,
  eventId: string
): Promise<StoredFaceDetection[]> {
  const result = await query<{
    id: string;
    event_id: string;
    photo_id: string;
    face_index: number;
    box_x: number;
    box_y: number;
    box_w: number;
    box_h: number;
    confidence: number;
    model_name: string;
    model_version: string;
    created_at: Date;
  }>(
    `SELECT id, event_id, photo_id, face_index,
            box_x, box_y, box_w, box_h,
            confidence, model_name, model_version, created_at
     FROM face_embeddings
     WHERE photo_id = $1 AND event_id = $2
     ORDER BY face_index ASC`,
    [mediaId, eventId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    photoId: row.photo_id,
    faceIndex: row.face_index,
    boxX: row.box_x,
    boxY: row.box_y,
    boxW: row.box_w,
    boxH: row.box_h,
    confidence: row.confidence,
    modelName: row.model_name,
    modelVersion: row.model_version,
    createdAt: row.created_at,
  }));
}
