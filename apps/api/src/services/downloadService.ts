import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import * as archiverModule from 'archiver';
import type { Request } from 'express';
import { query } from '../infrastructure/database.js';
import { storageAdapter } from '../infrastructure/storageAdapter.js';
import { log } from '../middleware/logger.js';
import { isEventExpired } from './galleryExpiryService.js';
import { verifyEventAccess } from '../middleware/eventAccess.js';
import { enqueueZipJob } from './queue/queueManager.js';
import { buildStorageKey, isValidUuid } from '@photography-saas/types';
import {
  NotFoundError,
  AuthorizationError,
  GalleryExpiredError,
  DownloadsDisabledError,
  DownloadJobNotFoundError,
  DownloadLimitExceededError,
  NoMediaSelectedError,
  MediaNotReadyForDownloadError,
  ValidationError,
} from '@photography-saas/errors';
import type {
  DownloadJobResponseDTO,
  IndividualDownloadResponseDTO,
  ZipGenerationJobPayload,
} from '@photography-saas/types';

export const MAX_BULK_DOWNLOAD_ITEMS = 500;
export const ZIP_RETENTION_HOURS = 24;
export const PRESIGNED_DOWNLOAD_TTL_SECONDS = 900; // 15 minutes

let periodicDownloadCleanupTimer: NodeJS.Timeout | null = null;

/**
 * Creates a Zip archive stream compatible with archiver v8 (ZipArchive) and legacy factory.
 */
function createZipArchive(options?: any) {
  const mod = archiverModule as any;
  if (typeof mod.ZipArchive === 'function') {
    return new mod.ZipArchive(options);
  }
  if (typeof mod.default === 'function') {
    return mod.default('zip', options);
  }
  if (typeof mod === 'function') {
    return mod('zip', options);
  }
  throw new Error('Could not instantiate archiver ZipArchive');
}

/**
 * Sanitizes a filename for secure HTTP Content-Disposition headers and ZIP archive entries.
 * - Strips CRLF (\r, \n) and header-breaking characters (", ;)
 * - Strips path traversal sequences (../, ..\, /)
 * - Normalizes characters to safe set [a-zA-Z0-9._- ]
 * - Preserves valid media extension (.jpg, .png, .webp, .mp4, etc.)
 * - Falls back to safe default if empty or invalid
 */
export function sanitizeDownloadFilename(
  originalName: string | null | undefined,
  fallbackBase = 'media',
  defaultExt = 'jpg'
): string {
  const safeDefaultExt = defaultExt.replace(/^\./, '').trim() || 'jpg';

  if (!originalName || typeof originalName !== 'string') {
    return `${fallbackBase}.${safeDefaultExt}`;
  }

  // 1. Strip CRLF, null bytes, tabs, quotes, semicolons
  let cleaned = originalName.replace(/[\0\r\n\t";]/g, '').trim();

  // 2. Normalize backslashes to slashes and extract basename (stripping all directory path segments)
  cleaned = cleaned.replace(/\\/g, '/');
  const lastSlash = cleaned.lastIndexOf('/');
  if (lastSlash >= 0) {
    cleaned = cleaned.slice(lastSlash + 1);
  }

  // 3. Strip leading dots / traversal sequences (e.g. .env, ..passwd -> env, passwd)
  cleaned = cleaned.replace(/^\.+/, '');

  // 4. Extract base name and extension
  const lastDot = cleaned.lastIndexOf('.');
  let baseName = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
  let ext = lastDot > 0 ? cleaned.slice(lastDot + 1).toLowerCase() : safeDefaultExt;

  // 5. Sanitize baseName (keep alphanumeric, space, hyphens, underscores)
  baseName = baseName.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
  baseName = baseName.replace(/^[_\- ]+/, '');

  // 6. Sanitize ext (alphanumeric only)
  ext = ext.replace(/[^a-zA-Z0-9]/g, '').trim() || safeDefaultExt;

  if (!baseName) {
    baseName = fallbackBase;
  }

  // 7. Cap total length at 120 characters (including dot and extension)
  const maxBaseLen = Math.max(1, 120 - 1 - ext.length);
  if (baseName.length > maxBaseLen) {
    baseName = baseName.slice(0, maxBaseLen);
  }

  return `${baseName}.${ext}`;
}

/**
 * Resolves event metadata and enforces authoritative download permission rules.
 * Throws appropriate domain errors if event is missing, inactive, private, expired, or downloads are disabled.
 */
export async function assertEventDownloadAllowed(
  eventIdOrSlug: string,
  req?: Request,
  downloadType: 'photo' | 'bulk' | 'video' | 'any' = 'any'
): Promise<{
  id: string;
  name: string;
  slug: string;
  visibility: string;
  status: string;
  public_until: Date | null;
  allow_downloads: boolean;
  allow_photo_downloads?: boolean;
  allow_bulk_downloads?: boolean;
  allow_video_downloads?: boolean;
  pin_enabled: boolean;
}> {
  const isUuid = isValidUuid(eventIdOrSlug);
  const sql = isUuid
    ? `SELECT id, name, slug, visibility, status, public_until, allow_downloads,
              allow_photo_downloads, allow_bulk_downloads, allow_video_downloads, pin_enabled
       FROM events WHERE id = $1`
    : `SELECT id, name, slug, visibility, status, public_until, allow_downloads,
              allow_photo_downloads, allow_bulk_downloads, allow_video_downloads, pin_enabled
       FROM events WHERE slug = $1`;

  const res = await query(sql, [eventIdOrSlug]);
  if (res.rows.length === 0) {
    throw new NotFoundError(`Gallery "${eventIdOrSlug}" not found`);
  }

  const event = res.rows[0];

  // 1. Operational status
  if (event.status !== 'active') {
    throw new NotFoundError('This gallery is currently unavailable');
  }

  // 2. Phase 19 Public/Private Visibility
  if (event.visibility !== 'public') {
    throw new AuthorizationError('This gallery is currently private.');
  }

  // 3. Phase 20 Automatic Gallery Expiry
  if (isEventExpired(event.public_until)) {
    throw new GalleryExpiredError('The public viewing window for this gallery has expired.');
  }

  // 4. Phase 18 PIN Session Authorization
  if (event.pin_enabled && req) {
    await verifyEventAccess(req, event.id);
  }

  // 5. Phase 21 & Phase 24 Download Permission Toggles
  if (!event.allow_downloads) {
    throw new DownloadsDisabledError('Downloads are disabled for this gallery.');
  }

  if (downloadType === 'bulk' && event.allow_bulk_downloads === false) {
    throw new DownloadsDisabledError('Bulk ZIP downloads are disabled for this gallery.');
  }

  if (downloadType === 'photo' && event.allow_photo_downloads === false) {
    throw new DownloadsDisabledError('Individual photo downloads are disabled for this gallery.');
  }

  if (downloadType === 'video' && event.allow_video_downloads === false) {
    throw new DownloadsDisabledError('Video downloads are disabled for this gallery.');
  }

  return event;
}

/**
 * Generates an authorized download response for an individual photograph or video.
 */
export async function getIndividualMediaDownload(
  eventIdOrSlug: string,
  mediaId: string,
  requestedRepresentation: 'original' | 'preview' = 'original',
  req?: Request
): Promise<IndividualDownloadResponseDTO> {
  if (!isValidUuid(mediaId)) {
    throw new ValidationError(`Invalid media ID: "${mediaId}"`);
  }

  const event = await assertEventDownloadAllowed(eventIdOrSlug, req, 'any');

  // Retrieve media with strict event scoping
  const mediaRes = await query(
    `SELECT id, event_id, original_name, mime_type, file_size, type, status,
            storage_key_original, storage_key_preview
     FROM media
     WHERE id = $1 AND event_id = $2`,
    [mediaId, event.id]
  );

  if (mediaRes.rows.length === 0) {
    throw new NotFoundError(`Media item "${mediaId}" not found in this gallery`);
  }

  const media = mediaRes.rows[0];

  // Enforce granular media type permissions
  if (media.type === 'photo' && event.allow_photo_downloads === false) {
    throw new DownloadsDisabledError('Individual photo downloads are disabled for this gallery.');
  }
  if (media.type === 'video' && event.allow_video_downloads === false) {
    throw new DownloadsDisabledError('Video downloads are disabled for this gallery.');
  }

  if (media.status !== 'ready') {
    throw new MediaNotReadyForDownloadError('Media item is still processing and not ready for download');
  }

  // Choose appropriate storage key
  const storageKey =
    requestedRepresentation === 'preview' && media.storage_key_preview
      ? media.storage_key_preview
      : media.storage_key_original;

  if (!storageKey) {
    throw new NotFoundError('Requested media file asset is unavailable in storage');
  }

  // Sanitize download filename for safe Content-Disposition
  const defaultExt = media.type === 'video' ? 'mp4' : 'jpg';
  const safeFilename = sanitizeDownloadFilename(media.original_name, `media_${media.id}`, defaultExt);

  // Generate short-lived presigned GET URL with safe attachment disposition
  const presigned = await storageAdapter.generatePresignedGetUrl({
    key: storageKey,
    expiresInSeconds: PRESIGNED_DOWNLOAD_TTL_SECONDS,
    responseContentDisposition: `attachment; filename="${safeFilename}"`,
  });

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Authorized individual media download issued: ${media.id} (${safeFilename})`,
    details: {
      mediaId: media.id,
      eventId: event.id,
      type: media.type,
      representation: requestedRepresentation,
    },
  });

  return {
    mediaId: media.id,
    eventId: event.id,
    filename: safeFilename,
    downloadUrl: presigned.url,
    expiresInSeconds: presigned.expiresInSeconds,
    expiresAt: presigned.expiresAt,
    fileSize: Number(media.file_size) || 0,
    mimeType: media.mime_type,
  };
}

/**
 * Initiates an asynchronous bulk ZIP download job.
 * Validates selection, creates a durable download_jobs record, and enqueues BullMQ worker job.
 */
export async function createBulkDownloadJob(
  eventIdOrSlug: string,
  mediaIds?: string[],
  req?: Request
): Promise<DownloadJobResponseDTO> {
  const event = await assertEventDownloadAllowed(eventIdOrSlug, req, 'bulk');

  let targetIds: string[] | undefined;

  if (mediaIds && Array.isArray(mediaIds)) {
    if (mediaIds.length === 0) {
      throw new NoMediaSelectedError('No media items selected for download');
    }

    if (mediaIds.length > MAX_BULK_DOWNLOAD_ITEMS) {
      throw new DownloadLimitExceededError(
        `Selection exceeds maximum limit of ${MAX_BULK_DOWNLOAD_ITEMS} items (requested ${mediaIds.length})`
      );
    }

    // Validate UUID format
    for (const id of mediaIds) {
      if (typeof id !== 'string' || !isValidUuid(id)) {
        throw new ValidationError(`Invalid media ID in selection: "${id}"`);
      }
    }

    // Deduplicate IDs
    const uniqueIds = Array.from(new Set(mediaIds));

    // Verify all requested media items belong to event and are ready
    const placeholders = uniqueIds.map((_, i) => `$${i + 2}`).join(', ');
    const verifyRes = await query(
      `SELECT id FROM media WHERE event_id = $1 AND id IN (${placeholders}) AND status = 'ready'`,
      [event.id, ...uniqueIds]
    );

    if (verifyRes.rows.length === 0) {
      throw new NoMediaSelectedError('None of the selected media items are available for download in this gallery');
    }

    targetIds = verifyRes.rows.map((r) => r.id);
  } else {
    // All ready media in event (bounded)
    const allRes = await query(
      `SELECT id FROM media WHERE event_id = $1 AND status = 'ready' ORDER BY created_at ASC LIMIT $2`,
      [event.id, MAX_BULK_DOWNLOAD_ITEMS]
    );

    if (allRes.rows.length === 0) {
      throw new NoMediaSelectedError('No ready media items found in this gallery for download');
    }

    targetIds = allRes.rows.map((r) => r.id);
  }

  const requestedCount = targetIds.length;
  const expiresAt = new Date(Date.now() + ZIP_RETENTION_HOURS * 3600 * 1000);
  const jobId = randomUUID();

  // Insert download_jobs record
  const jobRes = await query(
    `INSERT INTO download_jobs (
       id, event_id, status, requested_count, progress, expires_at, created_at
     ) VALUES (
       $1, $2, 'pending', $3, 0, $4, NOW()
     ) RETURNING *`,
    [jobId, event.id, requestedCount, expiresAt]
  );

  const job = jobRes.rows[0];

  // Enqueue BullMQ background job
  try {
    await enqueueZipJob({
      jobId: job.id,
      eventId: event.id,
      mediaIds: targetIds,
      timestamp: Date.now(),
    });
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Failed to enqueue zip job immediately, job remains in pending state: ${err instanceof Error ? err.message : String(err)}`,
      details: { jobId: job.id, eventId: event.id },
    });
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Bulk download job created: ${job.id} for event ${event.id} (${requestedCount} items)`,
    details: {
      jobId: job.id,
      eventId: event.id,
      requestedCount,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return {
    jobId: job.id,
    eventId: event.id,
    status: job.status,
    progress: job.progress || 0,
    requestedCount,
    processedCount: 0,
    fileSize: null,
    storageKey: null,
    downloadUrl: null,
    expiresAt: expiresAt.toISOString(),
    completedAt: null,
    error: null,
  };
}

/**
 * Retrieves the current status of a bulk download job.
 * Re-validates event access and generates a presigned download URL when completed.
 */
export async function getDownloadJobStatus(
  eventIdOrSlug: string,
  jobId: string,
  req?: Request
): Promise<DownloadJobResponseDTO> {
  if (!isValidUuid(jobId)) {
    throw new ValidationError(`Invalid job ID: "${jobId}"`);
  }

  const event = await assertEventDownloadAllowed(eventIdOrSlug, req);

  const jobRes = await query(
    `SELECT * FROM download_jobs WHERE id = $1 AND event_id = $2`,
    [jobId, event.id]
  );

  if (jobRes.rows.length === 0) {
    throw new DownloadJobNotFoundError(`Download job "${jobId}" not found`);
  }

  const job = jobRes.rows[0];

  // Check if archive has expired past retention window
  if (new Date(job.expires_at).getTime() < Date.now()) {
    throw new DownloadJobNotFoundError('This download archive has expired');
  }

  let downloadUrl: string | null = null;

  if (job.status === 'completed' && job.storage_key) {
    const safeZipName = `${sanitizeDownloadFilename(event.name, 'gallery')}_photos.zip`;
    const presigned = await storageAdapter.generatePresignedGetUrl({
      key: job.storage_key,
      expiresInSeconds: PRESIGNED_DOWNLOAD_TTL_SECONDS,
      responseContentDisposition: `attachment; filename="${safeZipName}"`,
    });
    downloadUrl = presigned.url;
  }

  return {
    jobId: job.id,
    eventId: event.id,
    status: job.status,
    progress: job.progress ?? (job.status === 'completed' ? 100 : 0),
    requestedCount: job.requested_count ?? (job.media_ids?.length || 0),
    processedCount: job.processed_count ?? 0,
    fileSize: job.file_size ? Number(job.file_size) : null,
    storageKey: job.storage_key,
    downloadUrl,
    expiresAt: new Date(job.expires_at).toISOString(),
    completedAt: job.completed_at ? new Date(job.completed_at).toISOString() : null,
    error: job.error_message,
  };
}

/**
 * Directly returns presigned download URL for a completed bulk download job.
 */
export async function getDownloadJobArchive(
  eventIdOrSlug: string,
  jobId: string,
  req?: Request
): Promise<{ downloadUrl: string; filename: string }> {
  const status = await getDownloadJobStatus(eventIdOrSlug, jobId, req);

  if (status.status !== 'completed' || !status.downloadUrl) {
    throw new DownloadJobNotFoundError('Download archive is not ready yet or has failed');
  }

  const safeZipName = `${sanitizeDownloadFilename(status.eventId, 'gallery')}_photos.zip`;

  return {
    downloadUrl: status.downloadUrl,
    filename: safeZipName,
  };
}

/**
 * Background worker processor: Generates a streaming ZIP archive from Cloudflare R2 media files.
 */
export async function processZipGenerationJob(payload: ZipGenerationJobPayload): Promise<void> {
  const { jobId, eventId, mediaIds } = payload;
  const startTime = Date.now();

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Starting background ZIP compilation for job ${jobId} (event ${eventId})`,
    details: { jobId, eventId },
  });

  // Mark job processing
  await query(
    `UPDATE download_jobs SET status = 'processing', progress = 10 WHERE id = $1`,
    [jobId]
  );

  // Retrieve media items to archive
  const mediaSql = mediaIds && mediaIds.length > 0
    ? `SELECT id, original_name, mime_type, file_size, type, storage_key_original
       FROM media
       WHERE event_id = $1 AND id IN (${mediaIds.map((_, i) => `$${i + 2}`).join(', ')}) AND status = 'ready'
       ORDER BY created_at ASC`
    : `SELECT id, original_name, mime_type, file_size, type, storage_key_original
       FROM media
       WHERE event_id = $1 AND status = 'ready'
       ORDER BY created_at ASC
       LIMIT $2`;

  const mediaParams = mediaIds && mediaIds.length > 0
    ? [eventId, ...mediaIds]
    : [eventId, MAX_BULK_DOWNLOAD_ITEMS];

  const mediaRes = await query(mediaSql, mediaParams);
  const items = mediaRes.rows;

  if (items.length === 0) {
    await query(
      `UPDATE download_jobs
       SET status = 'failed', error_message = 'No ready media items found to pack', completed_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
    return;
  }

  // Create temporary scratch file for streaming archive assembly
  const tempZipPath = path.join(os.tmpdir(), `studio_lumina_zip_${jobId}.zip`);
  const output = fs.createWriteStream(tempZipPath);
  const archive = createZipArchive({ zlib: { level: 6 } });

  archive.pipe(output);

  const seenNames = new Map<string, number>();
  let processedCount = 0;

  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const defaultExt = item.type === 'video' ? 'mp4' : 'jpg';
      let entryName = sanitizeDownloadFilename(item.original_name, `file_${i + 1}`, defaultExt);

      // Deterministically handle duplicate filenames inside archive
      const existingCount = seenNames.get(entryName) || 0;
      seenNames.set(entryName, existingCount + 1);

      if (existingCount > 0) {
        const dotIdx = entryName.lastIndexOf('.');
        const base = dotIdx > 0 ? entryName.slice(0, dotIdx) : entryName;
        const ext = dotIdx > 0 ? entryName.slice(dotIdx) : '';
        entryName = `${base} (${existingCount})${ext}`;
      }

      try {
        const fileBuffer = await storageAdapter.getObject(item.storage_key_original);
        archive.append(fileBuffer, { name: entryName });
        processedCount++;
      } catch (err) {
        log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'photography-api',
          message: `Failed to read media ${item.id} for ZIP job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
          details: { mediaId: item.id, jobId },
        });
      }

      // Update progress periodically
      const progress = Math.min(90, Math.round(10 + ((i + 1) / items.length) * 80));
      if (i % 10 === 0 || i === items.length - 1) {
        await query(
          `UPDATE download_jobs SET progress = $1, processed_count = $2 WHERE id = $3`,
          [progress, processedCount, jobId]
        );
      }
    }

    await archive.finalize();

    // Wait for write stream to close
    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
    });

    const fileStat = await fs.promises.stat(tempZipPath);
    const zipSize = fileStat.size;

    // Upload ZIP archive to Cloudflare R2
    const storageKey = buildStorageKey(eventId, 'exports', `${jobId}.zip`);
    const fileStream = fs.createReadStream(tempZipPath);
    const chunks: Buffer[] = [];
    for await (const chunk of fileStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const fullBuffer = Buffer.concat(chunks);

    await storageAdapter.putObject(storageKey, fullBuffer, 'application/zip');

    // Mark job completed in database
    await query(
      `UPDATE download_jobs
       SET status = 'completed',
           storage_key = $1,
           file_size = $2,
           progress = 100,
           processed_count = $3,
           completed_at = NOW()
       WHERE id = $4`,
      [storageKey, zipSize, processedCount, jobId]
    );

    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `ZIP archive completed and uploaded for job ${jobId} (${processedCount} items, ${zipSize} bytes in ${Date.now() - startTime}ms)`,
      details: { jobId, eventId, storageKey, zipSize, processedCount, durationMs: Date.now() - startTime },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Failed to compile ZIP archive for job ${jobId}: ${errorMsg}`,
      details: { jobId, eventId, error: errorMsg },
    });

    await query(
      `UPDATE download_jobs
       SET status = 'failed', error_message = $1, completed_at = NOW()
       WHERE id = $2`,
      [errorMsg, jobId]
    );
    throw err;
  } finally {
    // Clean up temporary scratch file
    await fs.promises.unlink(tempZipPath).catch(() => {});
  }
}

/**
 * Periodic bounded sweeper: Cleans up expired temporary ZIP archives from Cloudflare R2.
 * Never touches originals, previews, thumbnails, or videos.
 */
export async function cleanupExpiredDownloadJobs(
  limit = 50
): Promise<{ processed: number; deleted: number; errors: number }> {
  const expiredRes = await query(
    `SELECT id, event_id, storage_key
     FROM download_jobs
     WHERE expires_at < NOW() AND storage_key IS NOT NULL
     ORDER BY expires_at ASC
     LIMIT $1`,
    [limit]
  );

  let deleted = 0;
  let errors = 0;

  for (const row of expiredRes.rows) {
    try {
      if (row.storage_key) {
        await storageAdapter.deleteObject(row.storage_key);
        deleted++;
      }
      await query(
        `UPDATE download_jobs
         SET storage_key = NULL,
             status = 'failed',
             error_message = 'Archive expired and cleaned up'
         WHERE id = $1`,
        [row.id]
      );
    } catch (err) {
      errors++;
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Failed to delete expired archive for job ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        details: { jobId: row.id, storageKey: row.storage_key },
      });
    }
  }

  if (expiredRes.rows.length > 0) {
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Cleaned up ${deleted} expired download archives (${errors} errors)`,
      details: { processed: expiredRes.rows.length, deleted, errors },
    });
  }

  return { processed: expiredRes.rows.length, deleted, errors };
}

/**
 * Starts periodic background cleanup of expired download archives.
 */
export function startDownloadCleanupTimer(intervalMs = 3600000): void {
  if (periodicDownloadCleanupTimer) return;
  periodicDownloadCleanupTimer = setInterval(() => {
    cleanupExpiredDownloadJobs().catch((err) => {
      log({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'photography-api',
        message: `Download cleanup periodic sweeper failed: ${err.message}`,
      });
    });
  }, intervalMs);
}

/**
 * Stops periodic download cleanup sweeper.
 */
export function stopDownloadCleanupTimer(): void {
  if (periodicDownloadCleanupTimer) {
    clearInterval(periodicDownloadCleanupTimer);
    periodicDownloadCleanupTimer = null;
  }
}
