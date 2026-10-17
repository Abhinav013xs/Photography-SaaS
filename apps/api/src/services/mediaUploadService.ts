import { randomUUID } from 'crypto';
import path from 'path';
import { query } from '../infrastructure/database.js';
import { storageAdapter } from '../infrastructure/storageAdapter.js';
import {
  EventNotFoundError,
  FolderNotFoundError,
  InvalidTargetFolderError,
  ValidationError,
  UnsupportedMediaTypeError,
  FileTooLargeError,
  BatchLimitExceededError,
  UploadVerificationFailedError,
  ConflictError,
  StorageQuotaExceededError,
} from '@photography-saas/errors';
import { assertCanUpload } from './billingService.js';
import {
  buildStorageKey,
  parseStorageKey,
  isValidUuid,
  ALLOWED_PHOTO_MIME_TYPES,
  ALLOWED_PHOTO_EXTENSIONS,
  ALLOWED_VIDEO_MIME_TYPES,
  ALLOWED_VIDEO_EXTENSIONS,
  MAX_PHOTO_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_UPLOAD_BATCH_SIZE,
  type AllowedPhotoMimeType,
  type AllowedPhotoExtension,
  type AllowedVideoMimeType,
  type AllowedVideoExtension,
  type PresignPhotoItemDTO,
  type PresignBatchRequestDTO,
  type PresignedUploadItem,
  type PresignBatchResponseDTO,
  type ConfirmPhotoItemDTO,
  type ConfirmBatchRequestDTO,
  type ConfirmedMediaItem,
  type ConfirmBatchResponseDTO,
  type MediaListItem,
  type MediaListQueryDTO,
} from '@photography-saas/types';
import { log } from '../middleware/logger.js';
import { imageProcessingQueue } from './imageProcessingService.js';
import { videoProcessingQueue } from './videoProcessingService.js';
import { enqueuePhotoJob, enqueueVideoJob } from './queue/index.js';

const DANGEROUS_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'phtml', 'phar',
  'exe', 'dll', 'so', 'dylib',
  'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'psm1',
  'cgi', 'pl', 'py', 'rb',
  'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx',
  'vbs', 'vbe', 'wsf', 'wsh',
  'jsp', 'jspx', 'asp', 'aspx', 'ashx', 'asmx',
  'cer', 'csr', 'war', 'jar', 'com', 'scr', 'msi', 'bin', 'htm', 'html', 'xhtml'
]);

function assertSafeFilename(filename: string): void {
  // Reject null bytes, path traversal and ASCII control characters
  if (/[\x00-\x1f\x7f]/.test(filename) || filename.includes('/') || filename.includes('\\')) {
    throw new ValidationError('Filename contains invalid or dangerous control characters');
  }

  // Extract parts and check for dangerous double extensions (e.g., photo.php.jpg, evil.exe.png)
  const nameParts = filename.toLowerCase().split('.');
  if (nameParts.length > 2) {
    for (let i = 1; i < nameParts.length - 1; i++) {
      const part = nameParts[i];
      if (DANGEROUS_EXTENSIONS.has(part)) {
        throw new ValidationError(
          `Dangerous double extension detected in filename "${filename}". Executable or script extensions are strictly prohibited.`
        );
      }
    }
  }
}

/**
 * Validates and normalizes photo or video upload item properties.
 * Checks extension, declared MIME type, size limits, and sanitizes filenames.
 */
export function validateMediaUploadItem(item: PresignPhotoItemDTO): {
  normalizedExt: string;
  cleanOriginalName: string;
  mediaType: 'photo' | 'video';
} {
  if (!item.filename || typeof item.filename !== 'string') {
    throw new ValidationError('Filename is required and must be a string');
  }

  const cleanOriginalName = path.basename(item.filename.trim());
  if (cleanOriginalName.length === 0 || cleanOriginalName === '.' || cleanOriginalName === '..') {
    throw new ValidationError('Invalid filename specified');
  }

  assertSafeFilename(cleanOriginalName);

  // Extract raw extension (without dot)
  const dotIndex = cleanOriginalName.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === cleanOriginalName.length - 1) {
    throw new UnsupportedMediaTypeError(
      `File "${cleanOriginalName}" has no file extension. Supported formats: JPEG, PNG, WebP photos; MP4, MOV, WebM videos.`
    );
  }

  const rawExt = cleanOriginalName.slice(dotIndex + 1).toLowerCase();

  // Explicit check for prohibited SVG format
  if (rawExt === 'svg' || item.mimeType?.toLowerCase().includes('svg')) {
    throw new UnsupportedMediaTypeError('Vector SVG files are not supported as photography assets');
  }

  // Explicit check for HEIC/HEIF format with clear message
  if (rawExt === 'heic' || rawExt === 'heif' || item.mimeType?.toLowerCase().includes('heic') || item.mimeType?.toLowerCase().includes('heif')) {
    throw new UnsupportedMediaTypeError(
      'HEIC/HEIF is not currently supported in browser processing. Please convert to JPEG or WebP'
    );
  }

  const isPhotoExt = (ALLOWED_PHOTO_EXTENSIONS as readonly string[]).includes(rawExt);
  const isVideoExt = (ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(rawExt);

  if (!isPhotoExt && !isVideoExt) {
    throw new UnsupportedMediaTypeError(
      `Unsupported file extension ".${rawExt}". Supported formats: JPEG, PNG, WebP photos; MP4, MOV, WebM videos.`
    );
  }

  const normalizedMime = item.mimeType?.toLowerCase()?.trim() || '';

  // Determine media type based on extension and validate MIME type alignment
  let mediaType: 'photo' | 'video';
  if (isPhotoExt) {
    if (!normalizedMime || !(ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(normalizedMime)) {
      throw new UnsupportedMediaTypeError(
        `Unsupported MIME type "${item.mimeType}". Supported photo MIME types: image/jpeg, image/png, image/webp.`
      );
    }
    mediaType = 'photo';
  } else {
    if (!normalizedMime || !(ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(normalizedMime)) {
      throw new UnsupportedMediaTypeError(
        `Unsupported MIME type "${item.mimeType}". Supported video MIME types: video/mp4, video/quicktime, video/webm.`
      );
    }
    mediaType = 'video';
  }

  // Size limit validation
  if (typeof item.sizeBytes !== 'number' || item.sizeBytes <= 0) {
    throw new ValidationError(`File "${cleanOriginalName}" has invalid size (${item.sizeBytes} bytes). File size must be greater than 0.`);
  }

  const maxSize = mediaType === 'video' ? MAX_VIDEO_SIZE_BYTES : MAX_PHOTO_SIZE_BYTES;
  if (item.sizeBytes > maxSize) {
    const maxMb = Math.round(maxSize / (1024 * 1024));
    const fileMb = (item.sizeBytes / (1024 * 1024)).toFixed(1);
    throw new FileTooLargeError(
      `File "${cleanOriginalName}" (${fileMb} MB) exceeds maximum allowed size of ${maxMb} MB for ${mediaType}s.`
    );
  }

  const normalizedExt = rawExt === 'jpeg' ? 'jpg' : rawExt;

  return {
    normalizedExt,
    cleanOriginalName,
    mediaType,
  };
}

/**
 * Validates and normalizes photo upload item properties.
 * Checks extension, declared MIME type, size limits, and sanitizes filenames.
 */
export function validatePhotoUploadItem(item: PresignPhotoItemDTO): {
  normalizedExt: string;
  cleanOriginalName: string;
} {
  if (!item.filename || typeof item.filename !== 'string') {
    throw new ValidationError('Filename is required and must be a string');
  }

  const cleanOriginalName = path.basename(item.filename.trim());
  if (cleanOriginalName.length === 0 || cleanOriginalName === '.' || cleanOriginalName === '..') {
    throw new ValidationError('Invalid filename specified');
  }

  assertSafeFilename(cleanOriginalName);

  // Extract raw extension (without dot)
  const dotIndex = cleanOriginalName.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === cleanOriginalName.length - 1) {
    throw new UnsupportedMediaTypeError(
      `File "${cleanOriginalName}" has no file extension. Only JPEG, PNG, and WebP photos are supported.`
    );
  }

  const rawExt = cleanOriginalName.slice(dotIndex + 1).toLowerCase();

  // Explicit check for prohibited SVG format
  if (rawExt === 'svg' || item.mimeType?.toLowerCase().includes('svg')) {
    throw new UnsupportedMediaTypeError('Vector SVG files are not supported as photography assets');
  }

  // Explicit check for HEIC/HEIF format with clear message
  if (rawExt === 'heic' || rawExt === 'heif' || item.mimeType?.toLowerCase().includes('heic') || item.mimeType?.toLowerCase().includes('heif')) {
    throw new UnsupportedMediaTypeError(
      'HEIC/HEIF is not currently supported in browser processing. Please convert to JPEG or WebP'
    );
  }

  // Verify against allowed extensions
  if (!ALLOWED_PHOTO_EXTENSIONS.includes(rawExt as AllowedPhotoExtension)) {
    throw new UnsupportedMediaTypeError(
      `Unsupported file extension ".${rawExt}". Only JPEG, PNG, and WebP photos are supported.`
    );
  }

  // Verify against allowed MIME types
  const normalizedMime = item.mimeType?.toLowerCase()?.trim();
  if (!normalizedMime || !ALLOWED_PHOTO_MIME_TYPES.includes(normalizedMime as AllowedPhotoMimeType)) {
    throw new UnsupportedMediaTypeError(
      `Unsupported MIME type "${item.mimeType}". Only JPEG, PNG, and WebP photos are supported.`
    );
  }

  // Size limit validation
  if (typeof item.sizeBytes !== 'number' || item.sizeBytes <= 0) {
    throw new ValidationError(`File "${cleanOriginalName}" has invalid size (${item.sizeBytes} bytes). File size must be greater than 0.`);
  }

  if (item.sizeBytes > MAX_PHOTO_SIZE_BYTES) {
    const maxMb = Math.round(MAX_PHOTO_SIZE_BYTES / (1024 * 1024));
    const fileMb = (item.sizeBytes / (1024 * 1024)).toFixed(1);
    throw new FileTooLargeError(
      `File "${cleanOriginalName}" (${fileMb} MB) exceeds maximum allowed size of ${maxMb} MB.`
    );
  }

  // Normalize extension ('jpeg' -> 'jpg')
  const normalizedExt = rawExt === 'jpeg' ? 'jpg' : rawExt;

  return {
    normalizedExt,
    cleanOriginalName,
  };
}

/**
 * Verifies that the event exists and is owned by the authenticated photographer.
 */
export async function verifyEventOwnership(ownerId: number, eventId: string): Promise<void> {
  if (!isValidUuid(eventId)) {
    throw new ValidationError(`Invalid event ID: "${eventId}" must be a valid UUID`);
  }

  const res = await query<{ id: string; status: string }>(
    'SELECT id, status FROM events WHERE id = $1 AND owner_id = $2',
    [eventId, ownerId]
  );

  if (res.rows.length === 0) {
    throw new EventNotFoundError('Event not found or access denied');
  }

  if (res.rows[0].status === 'deleting') {
    throw new ConflictError(`Event "${eventId}" is currently being deleted and cannot accept new uploads`);
  }

  if (res.rows[0].status === 'trashed') {
    throw new ConflictError(`Event "${eventId}" is in the Recycle Bin and cannot accept new uploads`);
  }
}

/**
 * Verifies that a folder belongs to the specified event.
 */
export async function verifyFolderBelongsToEvent(folderId: string, eventId: string): Promise<void> {
  if (!isValidUuid(folderId)) {
    throw new ValidationError(`Invalid folder ID: "${folderId}" must be a valid UUID`);
  }

  const res = await query<{ id: string }>(
    'SELECT id FROM folders WHERE id = $1 AND event_id = $2',
    [folderId, eventId]
  );

  if (res.rows.length === 0) {
    throw new InvalidTargetFolderError('Target folder does not exist or belongs to another event');
  }
}

/**
 * Generates presigned PUT URLs for a batch of photo or video uploads.
 * Enforces ownership, batch limits, file constraints, and deterministic storage keys.
 */
export async function presignUploadBatch(
  ownerId: number,
  eventId: string,
  dto: PresignBatchRequestDTO
): Promise<PresignBatchResponseDTO> {
  await verifyEventOwnership(ownerId, eventId);

  if (!dto || !Array.isArray(dto.items) || dto.items.length === 0) {
    throw new ValidationError('Upload batch must contain at least one media item');
  }

  if (dto.items.length > MAX_UPLOAD_BATCH_SIZE) {
    throw new BatchLimitExceededError(
      `Upload batch size (${dto.items.length}) exceeds the maximum limit of ${MAX_UPLOAD_BATCH_SIZE} items`
    );
  }

  // Enforce server-authoritative storage quota before generating presigned URLs
  const totalBatchBytes = dto.items.reduce(
    (sum, item) => sum + (typeof item.sizeBytes === 'number' && item.sizeBytes > 0 ? item.sizeBytes : 0),
    0
  );
  await assertCanUpload(ownerId, totalBatchBytes);

  // Cache verified folders to avoid redundant database round-trips
  const verifiedFolderIds = new Set<string>();

  // If a batch-level default folder is specified, verify it
  if (dto.folderId) {
    await verifyFolderBelongsToEvent(dto.folderId, eventId);
    verifiedFolderIds.add(dto.folderId);
  }

  const presignedItems: PresignedUploadItem[] = [];

  for (const item of dto.items) {
    const { normalizedExt, cleanOriginalName } = validateMediaUploadItem(item);

    // Resolve target folder ID (item-level overrides batch-level)
    const targetFolderId = item.folderId !== undefined ? item.folderId : dto.folderId ?? null;

    if (targetFolderId !== null) {
      if (!verifiedFolderIds.has(targetFolderId)) {
        await verifyFolderBelongsToEvent(targetFolderId, eventId);
        verifiedFolderIds.add(targetFolderId);
      }
    }

    // Generate unique media UUID and deterministic storage key
    const mediaId = randomUUID();
    const filename = `${mediaId}.${normalizedExt}`;
    const storageKey = buildStorageKey(eventId, 'originals', filename);

    // Generate presigned PUT URL (30-minute expiration)
    const presigned = await storageAdapter.generatePresignedPutUrl({
      key: storageKey,
      contentType: item.mimeType,
      contentLength: item.sizeBytes,
      expiresInSeconds: 1800, // 30 minutes
      customMetadata: {
        eventId,
        originalName: encodeURIComponent(cleanOriginalName),
      },
    });

    presignedItems.push({
      mediaId,
      originalName: cleanOriginalName,
      filename,
      storageKey,
      uploadUrl: presigned.url,
      expiresAt: presigned.expiresAt,
      folderId: targetFolderId,
    });
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Generated ${presignedItems.length} presigned upload URLs for event ${eventId}`,
    details: {
      eventId,
      itemCount: presignedItems.length,
    },
  });

  return { items: presignedItems };
}

/**
 * Confirms uploaded photos after direct browser-to-R2 transfer.
 * Probes Cloudflare R2 via headObject to verify binary existence before creating database records.
 * Idempotent: repeated calls for the same mediaId return the confirmed record without duplicate entries.
 */
export async function confirmUploadBatch(
  ownerId: number,
  eventId: string,
  dto: ConfirmBatchRequestDTO
): Promise<ConfirmBatchResponseDTO> {
  await verifyEventOwnership(ownerId, eventId);

  if (!dto || !Array.isArray(dto.items) || dto.items.length === 0) {
    throw new ValidationError('Confirm batch must contain at least one photo item');
  }

  if (dto.items.length > MAX_UPLOAD_BATCH_SIZE) {
    throw new BatchLimitExceededError(
      `Confirm batch size (${dto.items.length}) exceeds maximum limit of ${MAX_UPLOAD_BATCH_SIZE} items`
    );
  }

  const confirmed: ConfirmedMediaItem[] = [];
  const failed: Array<{ mediaId: string; error: string }> = [];
  const verifiedFolders = new Set<string>();

  for (const item of dto.items) {
    if (!item.mediaId || !isValidUuid(item.mediaId)) {
      failed.push({ mediaId: item.mediaId || 'unknown', error: 'Invalid media UUID' });
      continue;
    }

    // Verify storage key structure conforms to deterministic pattern
    const parsedKey = parseStorageKey(item.storageKey);
    if (
      !parsedKey ||
      parsedKey.eventId !== eventId ||
      parsedKey.category !== 'originals' ||
      !parsedKey.filename.startsWith(item.mediaId)
    ) {
      failed.push({
        mediaId: item.mediaId,
        error: `Storage key "${item.storageKey}" does not match expected originals pattern for this event and media ID`,
      });
      continue;
    }

    const folderId = item.folderId ?? null;
    if (folderId !== null) {
      if (!verifiedFolders.has(folderId)) {
        try {
          await verifyFolderBelongsToEvent(folderId, eventId);
          verifiedFolders.add(folderId);
        } catch (err) {
          failed.push({
            mediaId: item.mediaId,
            error: err instanceof Error ? err.message : 'Invalid destination folder',
          });
          continue;
        }
      }
    }

    // Check if media record already exists in database (Idempotency)
    const existingRes = await query<{
      id: string;
      event_id: string;
      folder_id: string | null;
      type: string;
      filename: string;
      original_name: string;
      mime_type: string;
      file_size: string;
      storage_key_original: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      'SELECT id, event_id, folder_id, type, filename, original_name, mime_type, file_size, storage_key_original, status, created_at, updated_at FROM media WHERE id = $1 AND event_id = $2',
      [item.mediaId, eventId]
    );

    if (existingRes.rows.length > 0) {
      const row = existingRes.rows[0];
      confirmed.push({
        id: row.id,
        eventId: row.event_id,
        folderId: row.folder_id,
        type: row.type as any,
        filename: row.filename,
        originalName: row.original_name,
        mimeType: row.mime_type,
        fileSize: Number(row.file_size),
        storageKeyOriginal: row.storage_key_original,
        status: row.status as any,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      });
      continue;
    }

    // Verify actual binary existence in Cloudflare R2
    try {
      const storageMeta = await storageAdapter.headObject(item.storageKey);

      if (!storageMeta) {
        failed.push({
          mediaId: item.mediaId,
          error: `Storage object does not exist in R2 bucket (${item.storageKey})`,
        });
        continue;
      }

      const verifiedSize = storageMeta.sizeBytes > 0 ? storageMeta.sizeBytes : item.sizeBytes;

      // Determine asset media type based on filename extension or declared MIME type
      const dotIdx = parsedKey.filename.lastIndexOf('.');
      const fileExt = dotIdx !== -1 ? parsedKey.filename.slice(dotIdx + 1).toLowerCase() : '';
      const isVideo =
        (ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(fileExt) ||
        (item.mimeType && item.mimeType.toLowerCase().startsWith('video/'));
      const mediaType = isVideo ? 'video' : 'photo';

      // Insert media record with status = 'uploaded'
      const insertRes = await query<{
        id: string;
        event_id: string;
        folder_id: string | null;
        type: string;
        filename: string;
        original_name: string;
        mime_type: string;
        file_size: string;
        storage_key_original: string;
        status: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO media (
          id, event_id, folder_id, type, filename, original_name,
          mime_type, file_size, storage_key_original, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, 'uploaded', NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          updated_at = NOW()
        RETURNING id, event_id, folder_id, type, filename, original_name,
                  mime_type, file_size, storage_key_original, status, created_at, updated_at`,
        [
          item.mediaId,
          eventId,
          folderId,
          mediaType,
          parsedKey.filename,
          item.originalName || parsedKey.filename,
          item.mimeType || storageMeta.contentType || (isVideo ? 'video/mp4' : 'image/jpeg'),
          verifiedSize,
          item.storageKey,
        ]
      );

      const row = insertRes.rows[0];
      confirmed.push({
        id: row.id,
        eventId: row.event_id,
        folderId: row.folder_id,
        type: row.type as any,
        filename: row.filename,
        originalName: row.original_name,
        mimeType: row.mime_type,
        fileSize: Number(row.file_size),
        storageKeyOriginal: row.storage_key_original,
        status: row.status as any,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      });
    } catch (storageErr) {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Failed to verify R2 storage object during confirmation: ${storageErr instanceof Error ? storageErr.message : String(storageErr)}`,
      });
      failed.push({
        mediaId: item.mediaId,
        error: storageErr instanceof Error ? storageErr.message : 'Storage verification error',
      });
    }
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Confirmed media upload batch: ${confirmed.length} succeeded, ${failed.length} failed in event ${eventId}`,
    details: {
      eventId,
      confirmedCount: confirmed.length,
      failedCount: failed.length,
    },
  });

  // Automatically schedule background processing:
  // 1. Record in processing_jobs (Durable Outbox)
  // 2. Schedule via BullMQ background queue (falls back to in-memory queue if Redis is unconfigured)
  const confirmedPhotos = confirmed.filter((item) => item.type === 'photo');
  const confirmedVideos = confirmed.filter((item) => item.type === 'video');

  // Record outbox entries for photos
  for (const photo of confirmedPhotos) {
    try {
      await query(
        `INSERT INTO processing_jobs (
          id, event_id, media_id, type, status, progress, total_items, processed_items, job_id, max_attempts, idempotency_key, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, 'photo_processing', 'pending', 0, 1, 0, $2, 3, 'photo_processing:' || $2 || ':v1', NOW(), NOW()
        ) ON CONFLICT DO NOTHING`,
        [photo.eventId, photo.id]
      );
    } catch (auditErr) {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Failed inserting photo outbox record: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
      });
    }
  }

  // Record outbox entries for videos
  for (const video of confirmedVideos) {
    try {
      await query(
        `INSERT INTO processing_jobs (
          id, event_id, media_id, type, status, progress, total_items, processed_items, job_id, max_attempts, idempotency_key, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, 'video_processing', 'pending', 0, 1, 0, $2, 2, 'video_processing:' || $2 || ':v1', NOW(), NOW()
        ) ON CONFLICT DO NOTHING`,
        [video.eventId, video.id]
      );
    } catch (auditErr) {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Failed inserting video outbox record: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
      });
    }
  }

  // Dispatch photo jobs
  for (const photo of confirmedPhotos) {
    try {
      await enqueuePhotoJob({ mediaId: photo.id, eventId: photo.eventId });
    } catch (queueErr) {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Photo BullMQ dispatch warning (falling back to in-process queue): ${queueErr instanceof Error ? queueErr.message : String(queueErr)}`,
      });
      imageProcessingQueue.enqueue(photo.id, photo.eventId);
    }
  }

  // Dispatch video jobs
  for (const video of confirmedVideos) {
    try {
      await enqueueVideoJob({ mediaId: video.id, eventId: video.eventId });
    } catch (queueErr) {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Video BullMQ dispatch warning (falling back to in-process queue): ${queueErr instanceof Error ? queueErr.message : String(queueErr)}`,
      });
      videoProcessingQueue.enqueue(video.id, video.eventId);
    }
  }

  return { confirmed, failed };
}

/**
 * Lists media items within an event with folder, status, and pagination filters.
 */
export async function listEventMedia(
  ownerId: number,
  eventId: string,
  queryOptions: MediaListQueryDTO = {}
): Promise<{ media: MediaListItem[]; total: number; page: number; limit: number }> {
  await verifyEventOwnership(ownerId, eventId);

  const page = Math.max(1, queryOptions.page ?? 1);
  const limit = Math.min(200, Math.max(1, queryOptions.limit ?? 50));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['m.event_id = $1'];
  const params: any[] = [eventId];
  let paramIndex = 2;

  // Folder filter
  if (queryOptions.folderId !== undefined && queryOptions.folderId !== 'all') {
    if (queryOptions.folderId === 'root' || queryOptions.folderId === null) {
      conditions.push('m.folder_id IS NULL');
    } else {
      if (!isValidUuid(queryOptions.folderId)) {
        throw new ValidationError('Invalid folderId format');
      }
      conditions.push(`m.folder_id = $${paramIndex}`);
      params.push(queryOptions.folderId);
      paramIndex++;
    }
  }

  // Type filter
  if (queryOptions.type && queryOptions.type !== 'all') {
    conditions.push(`m.type = $${paramIndex}`);
    params.push(queryOptions.type);
    paramIndex++;
  }

  // Status filter
  if (queryOptions.status && queryOptions.status !== 'all') {
    conditions.push(`m.status = $${paramIndex}`);
    params.push(queryOptions.status);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Count query
  const countSql = `SELECT COUNT(*)::INT as total FROM media m WHERE ${whereClause}`;
  const countRes = await query<{ total: number }>(countSql, params);
  const total = countRes.rows[0]?.total ?? 0;

  // Data query
  const dataSql = `
    SELECT 
      m.id,
      m.event_id,
      m.folder_id,
      f.name AS folder_name,
      m.type,
      m.filename,
      m.original_name,
      m.mime_type,
      m.file_size,
      m.storage_key_original,
      m.storage_key_preview,
      m.storage_key_thumbnail,
      m.thumbnail_size,
      m.preview_size,
      m.video_duration,
      m.video_codec,
      m.audio_codec,
      m.processing_error,
      m.processed_at,
      m.status,
      m.created_at,
      m.updated_at
    FROM media m
    LEFT JOIN folders f ON f.id = m.folder_id
    WHERE ${whereClause}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  params.push(limit, offset);

  const dataRes = await query<{
    id: string;
    event_id: string;
    folder_id: string | null;
    folder_name: string | null;
    type: string;
    filename: string;
    original_name: string;
    mime_type: string;
    file_size: string;
    storage_key_original: string;
    storage_key_preview: string | null;
    storage_key_thumbnail: string | null;
    thumbnail_size: string | number | null;
    preview_size: string | number | null;
    video_duration: number | null;
    video_codec: string | null;
    audio_codec: string | null;
    processing_error: string | null;
    processed_at: Date | null;
    status: string;
    created_at: Date;
    updated_at: Date;
  }>(dataSql, params);

  const media: MediaListItem[] = dataRes.rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    folderId: row.folder_id,
    folderName: row.folder_name,
    type: row.type as any,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    storageKeyOriginal: row.storage_key_original,
    storageKeyPreview: row.storage_key_preview,
    storageKeyThumbnail: row.storage_key_thumbnail,
    thumbnailSize: row.thumbnail_size !== null ? Number(row.thumbnail_size) : null,
    previewSize: row.preview_size !== null ? Number(row.preview_size) : null,
    videoDuration: row.video_duration !== null ? Number(row.video_duration) : null,
    videoCodec: row.video_codec ?? null,
    audioCodec: row.audio_codec ?? null,
    processingError: row.processing_error ?? null,
    processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
    status: row.status as any,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));

  return { media, total, page, limit };
}
