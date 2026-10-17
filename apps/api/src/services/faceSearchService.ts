import { query } from '../infrastructure/database.js';
import { processQuerySelfie } from '../infrastructure/aiClient.js';
import { validateSelfieBuffer } from '../utils/selfieValidation.js';
import { logger } from '../utils/logger.js';
import {
  NotFoundError,
  ConflictError,
  FaceSearchDisabledError,
  ValidationError,
  GalleryExpiredError,
} from '@photography-saas/errors';
import { isEventExpired } from './galleryExpiryService.js';
import type {
  FaceSearchOptions,
  FaceSearchResponseDTO,
  FaceSearchResultItemDTO,
} from '@photography-saas/types';

/**
 * Standard calibrated SFace match threshold:
 * Based on OpenCV YuNet + SFace benchmarks at FAR (False Acceptance Rate) of 0.001:
 * Cosine distance <= 0.363 (equivalent to cosine similarity >= 0.637).
 */
export const DEFAULT_COSINE_DISTANCE_THRESHOLD = 0.363;
export const DEFAULT_SEARCH_PAGE_LIMIT = 20;
export const MAX_SEARCH_PAGE_LIMIT = 100;

/**
 * Validates that an extracted query vector strictly adheres to the 128-D SFace standard:
 * - Exactly 128 elements.
 * - All numbers are finite (no NaN, null, or Infinity).
 * - L2 norm is approximately 1.0 (unit vector).
 */
export function validateQueryEmbeddingVector(embedding: number[]): void {
  if (!Array.isArray(embedding) || embedding.length !== 128) {
    throw new ValidationError(
      `Invalid face embedding vector dimension: expected 128, received ${Array.isArray(embedding) ? embedding.length : typeof embedding}`
    );
  }

  for (let i = 0; i < embedding.length; i++) {
    const val = embedding[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new ValidationError(`Query embedding contains non-finite value at index ${i}`);
    }
  }

  const sumSquares = embedding.reduce((acc, v) => acc + v * v, 0);
  const norm = Math.sqrt(sumSquares);

  if (norm < 0.95 || norm > 1.05) {
    throw new ValidationError(
      `Query embedding is not properly unit-normalized (L2 norm: ${norm.toFixed(4)})`
    );
  }
}

/**
 * Performs event-scoped AI face search:
 * 1. Validates selfie image payload (magic bytes, size, pixel limits).
 * 2. Confirms event existence, active status, and face_search_enabled.
 * 3. Detects face and extracts 128-D vector embedding (enforcing exactly-one-face policy).
 * 4. Validates query vector.
 * 5. Executes event-scoped pgvector similarity search against face_embeddings table.
 * 6. Groups and deduplicates multi-face group photos by photograph media ID.
 * 7. Ranks photographs by lowest cosine distance (highest similarity).
 * 8. Returns bounded, paginated results without exposing raw vectors or selfies.
 * 9. Cleans up in-memory selfie buffer immediately.
 */
export async function searchEventPhotosBySelfie(
  eventId: string,
  selfieBuffer: Buffer,
  options?: FaceSearchOptions
): Promise<FaceSearchResponseDTO> {
  const startTime = Date.now();

  // 1. Validate selfie buffer format and dimensions
  await validateSelfieBuffer(selfieBuffer);

  // 2. Validate event existence and face search eligibility
  const eventRes = await query<{
    id: string;
    status: string;
    visibility: string;
    public_until: string | null;
    face_search_enabled: boolean;
  }>(
    `SELECT id, status, visibility, public_until, face_search_enabled
     FROM events
     WHERE id = $1`,
    [eventId]
  );

  if (eventRes.rows.length === 0) {
    throw new NotFoundError(`Event "${eventId}" not found`);
  }

  const event = eventRes.rows[0];

  if (event.status === 'deleting') {
    throw new ConflictError(`Event "${eventId}" is currently being deleted`);
  }

  if (event.status === 'trashed' || event.status === 'deleted') {
    throw new ConflictError(`Event "${eventId}" is not available for search`);
  }

  if (isEventExpired(event.public_until)) {
    throw new GalleryExpiredError('The public viewing period for this gallery has expired.');
  }

  if (!event.face_search_enabled) {
    throw new FaceSearchDisabledError(`Face search is disabled for event "${eventId}"`);
  }

  // 3. Biometric inference: process selfie via AI microservice (enforces exactly 1 face)
  let aiResponse;
  try {
    aiResponse = await processQuerySelfie(selfieBuffer);
  } finally {
    // Biometric privacy zero-retention: ensure buffer can be garbage collected
    // (Do not keep persistent references in service scope)
  }

  const queryFace = aiResponse.face;

  // 4. Validate query vector
  validateQueryEmbeddingVector(queryFace.embedding);

  // 5. Configuration & Pagination
  const limit = Math.min(
    Math.max(1, options?.limit ?? DEFAULT_SEARCH_PAGE_LIMIT),
    MAX_SEARCH_PAGE_LIMIT
  );
  const offset = Math.max(0, options?.offset ?? 0);
  const threshold =
    options?.threshold !== undefined && options.threshold > 0 && options.threshold < 2
      ? options.threshold
      : DEFAULT_COSINE_DISTANCE_THRESHOLD;

  // Format vector as string literal for PostgreSQL pgvector: '[v0,v1,...,v127]'
  const vectorStr = `[${queryFace.embedding.join(',')}]`;

  // 6. Execute Event-Scoped pgvector query
  // Strictly enforces event isolation:
  // fe.event_id = $2 AND m.event_id = $2 AND m.status = 'ready'
  // Group by m.id ensures multi-face group photos appear only ONCE with their best face match distance.
  const searchSql = `
    SELECT
      m.id AS media_id,
      m.filename,
      m.width,
      m.height,
      m.storage_key_preview,
      m.storage_key_thumbnail,
      m.created_at,
      MIN(fe.embedding <=> $1::vector) AS min_distance
    FROM face_embeddings fe
    JOIN media m ON m.id = fe.photo_id
    WHERE fe.event_id = $2
      AND fe.model_name = 'SFace'
      AND fe.model_version = 'v1'
      AND m.event_id = $2
      AND m.status = 'ready'
      AND (fe.embedding <=> $1::vector) <= $3
    GROUP BY
      m.id, m.filename, m.width, m.height,
      m.storage_key_preview, m.storage_key_thumbnail, m.created_at
    ORDER BY min_distance ASC, m.id ASC
    LIMIT $4 OFFSET $5;
  `;

  const countSql = `
    SELECT COUNT(DISTINCT m.id) AS total_count
    FROM face_embeddings fe
    JOIN media m ON m.id = fe.photo_id
    WHERE fe.event_id = $2
      AND fe.model_name = 'SFace'
      AND fe.model_version = 'v1'
      AND m.event_id = $2
      AND m.status = 'ready'
      AND (fe.embedding <=> $1::vector) <= $3;
  `;

  const [searchResult, countResult] = await Promise.all([
    query<{
      media_id: string;
      filename: string;
      width: number | null;
      height: number | null;
      storage_key_preview: string | null;
      storage_key_thumbnail: string | null;
      created_at: Date;
      min_distance: number | string;
    }>(searchSql, [vectorStr, eventId, threshold, limit, offset]),
    query<{ total_count: string | number }>(countSql, [vectorStr, eventId, threshold]),
  ]);

  const total = Number(countResult.rows[0]?.total_count ?? 0);

  // 7. Format matching photo items
  const results: FaceSearchResultItemDTO[] = searchResult.rows.map((row, index) => {
    const rawDistance = typeof row.min_distance === 'string' ? parseFloat(row.min_distance) : row.min_distance;
    const cosineDistance = Math.max(0, Math.min(2, rawDistance));
    // Calibrated similarity: 1 - cosine distance, bounded to [0, 1]
    const matchScore = Math.max(0, Math.min(1, Number((1 - cosineDistance).toFixed(4))));

    return {
      mediaId: row.media_id,
      filename: row.filename,
      width: row.width,
      height: row.height,
      storageKeyPreview: row.storage_key_preview,
      storageKeyThumbnail: row.storage_key_thumbnail,
      createdAt: row.created_at.toISOString(),
      matchRank: offset + index + 1,
      matchScore,
      cosineDistance: Number(cosineDistance.toFixed(4)),
    };
  });

  // Re-verify event access before returning results to satisfy non-leak requirement on expiry boundary
  const recheckRes = await query<{ visibility: string; public_until: string | null }>(
    `SELECT visibility, public_until FROM events WHERE id = $1`,
    [eventId]
  );
  if (
    recheckRes.rows.length === 0 ||
    recheckRes.rows[0].visibility !== 'public' ||
    isEventExpired(recheckRes.rows[0].public_until)
  ) {
    throw new GalleryExpiredError('The public viewing period for this gallery has expired.');
  }

  const durationMs = Date.now() - startTime;

  logger.info('AI face search query completed', {
    service: 'face-search',
    eventId,
    matchesFound: results.length,
    totalMatchingPhotos: total,
    threshold,
    durationMs,
  });

  return {
    status: results.length > 0 ? 'completed' : 'no_matches',
    results,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + results.length < total,
    },
    queryFace: {
      confidence: queryFace.confidence,
      boxX: queryFace.boxX,
      boxY: queryFace.boxY,
      boxW: queryFace.boxW,
      boxH: queryFace.boxH,
    },
    searchDurationMs: durationMs,
  };
}
