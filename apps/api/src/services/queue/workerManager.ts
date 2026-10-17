import { Worker, type Job, UnrecoverableError } from 'bullmq';
import {
  QUEUE_CONFIG,
  RETRY_POLICIES,
  DEFAULT_JOB_LEASE_SECONDS,
  calculateBackoffDelay,
  isNonRetryableError,
  sanitizeErrorMessage,
} from './queueConfig.js';
import { getBullMQConnectionOptions } from './queueConnection.js';
import { processPhoto } from '../imageProcessingService.js';
import { processVideo } from '../videoProcessingService.js';
import { indexPhotoFaces } from '../faceIndexingService.js';
import { detectAndRecordFaces } from '../faceDetectionService.js';
import { query } from '../../infrastructure/database.js';
import { log } from '../../middleware/logger.js';
import {
  expireEventIfDue,
  startExpiryPeriodicReconciler,
  stopExpiryPeriodicReconciler,
} from '../galleryExpiryService.js';
import {
  processZipGenerationJob,
  startDownloadCleanupTimer,
  stopDownloadCleanupTimer,
} from '../downloadService.js';
import { reconcilePendingDeletions } from '../eventDeletionService.js';
import {
  startRecycleBinPurgeReconciler,
  stopRecycleBinPurgeReconciler,
} from '../recycleBinService.js';
import {
  startJobReliabilityReconciler,
  stopJobReliabilityReconciler,
} from './jobRecoveryService.js';
import type {
  PhotoProcessingJobPayload,
  VideoProcessingJobPayload,
  GalleryExpiryJobPayload,
  ZipGenerationJobPayload,
  WorkerStatus,
  JobStatus,
} from '@photography-saas/types';

let photoWorker: Worker<PhotoProcessingJobPayload> | null = null;
let videoWorker: Worker<VideoProcessingJobPayload> | null = null;
let expiryWorker: Worker<GalleryExpiryJobPayload> | null = null;
let zipWorker: Worker<ZipGenerationJobPayload> | null = null;
let workersStarted = false;

/**
 * Updates processing_jobs audit mirror in PostgreSQL with full lifecycle states,
 * sanitized error messages, and lease/retry timestamps.
 */
async function updateJobAudit(
  mediaId: string,
  type: 'photo_processing' | 'video_processing',
  status: JobStatus,
  options?: {
    errorMessage?: string | null;
    errorCode?: string | null;
    progress?: number;
    nextRetryAt?: Date | null;
  }
): Promise<void> {
  try {
    const isCompleted = status === 'completed' || status === 'succeeded';
    const progress = options?.progress ?? (isCompleted ? 100 : 0);
    const sanitizedMsg = options?.errorMessage ? sanitizeErrorMessage(options.errorMessage) : null;

    await query(
      `UPDATE processing_jobs
       SET status = $1,
           progress = $2,
           processed_items = CASE WHEN $1 IN ('completed', 'succeeded') THEN 1 ELSE processed_items END,
           completed_at = CASE WHEN $1 IN ('completed', 'succeeded', 'failed', 'cancelled') THEN NOW() ELSE completed_at END,
           error_message = $3,
           error_code = $4,
           next_retry_at = $5,
           lease_expires_at = CASE WHEN $1 IN ('completed', 'succeeded', 'failed', 'cancelled', 'retry_wait') THEN NULL ELSE lease_expires_at END,
           updated_at = NOW()
       WHERE media_id = $6 AND type = $7`,
      [
        status,
        progress,
        sanitizedMsg,
        options?.errorCode ?? null,
        options?.nextRetryAt ?? null,
        mediaId,
        type,
      ]
    );
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Failed to update processing_jobs audit table: ${err instanceof Error ? err.message : String(err)}`,
      details: { mediaId, type, status },
    });
  }
}

/**
 * Increments job attempt count, claims active worker lease, and sets idempotency key in PostgreSQL.
 */
async function recordJobAttempt(
  mediaId: string,
  type: 'photo_processing' | 'video_processing',
  options?: {
    workerId?: string;
    leaseDurationSeconds?: number;
    idempotencyKey?: string;
    correlationId?: string;
  }
): Promise<void> {
  try {
    const leaseSec = options?.leaseDurationSeconds ?? DEFAULT_JOB_LEASE_SECONDS;
    await query(
      `UPDATE processing_jobs
       SET attempts = attempts + 1,
           last_attempt_at = NOW(),
           started_at = COALESCE(started_at, NOW()),
           worker_id = COALESCE($1, worker_id, 'worker-pool'),
           lease_expires_at = NOW() + ($2 || ' seconds')::INTERVAL,
           idempotency_key = COALESCE($3, idempotency_key),
           correlation_id = COALESCE($4, correlation_id),
           status = 'processing',
           updated_at = NOW()
       WHERE media_id = $5 AND type = $6`,
      [
        options?.workerId ?? 'worker-pool',
        leaseSec,
        options?.idempotencyKey ?? null,
        options?.correlationId ?? null,
        mediaId,
        type,
      ]
    );
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Failed to record job attempt in processing_jobs: ${err instanceof Error ? err.message : String(err)}`,
      details: { mediaId, type },
    });
  }
}

/**
 * Processor for Photo Processing Jobs.
 * Verifies PostgreSQL media record idempotency, checks event lifecycle, claims worker lease,
 * delegates to processPhoto, and discriminates retryable vs non-retryable failures with jittered backoff.
 */
export async function photoJobProcessor(job: Job<PhotoProcessingJobPayload>): Promise<void> {
  const { mediaId, eventId } = job.data;
  const startTime = Date.now();
  const workerId = `photo-worker-${process.pid}-${job.id}`;
  const idempotencyKey = `photo_processing:${mediaId}:v${job.data.version || 1}`;

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Photo worker picked up job ${job.id} (attempt ${job.attemptsMade + 1}/${job.opts.attempts || QUEUE_CONFIG.photo.attempts})`,
    details: { jobId: job.id, mediaId, eventId, workerId, idempotencyKey },
  });

  await recordJobAttempt(mediaId, 'photo_processing', {
    workerId,
    idempotencyKey,
    correlationId: job.data.correlationId,
  });

  // Idempotency & Lifecycle check: verify current database state and watermark synchronization
  const mediaRes = await query<{
    status: string;
    storage_key_thumbnail: string | null;
    watermark_version: number | null;
    event_watermark_version: number | null;
    event_status: string;
  }>(
    `SELECT m.status, m.storage_key_thumbnail, m.watermark_version,
            COALESCE(e.watermark_version, 1) as event_watermark_version,
            e.status as event_status
     FROM media m
     JOIN events e ON e.id = m.event_id
     WHERE m.id = $1`,
    [mediaId]
  );

  if (mediaRes.rows.length === 0) {
    await updateJobAudit(mediaId, 'photo_processing', 'failed', {
      errorCode: 'MEDIA_NOT_FOUND',
      errorMessage: 'Media record not found in database',
    });
    throw new UnrecoverableError(`Media item "${mediaId}" not found for photo processing`);
  }

  const media = mediaRes.rows[0];

  // Lifecycle defense: abort if parent event is trashed, deleting, or deleted
  if (['deleting', 'trashed', 'deleted'].includes(media.event_status)) {
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Aborting photo processing for media ${mediaId}: parent event ${eventId} is ${media.event_status}`,
      details: { jobId: job.id, mediaId, eventId },
    });
    await updateJobAudit(mediaId, 'photo_processing', 'cancelled', {
      errorCode: 'EVENT_CANCELLED',
      errorMessage: `Parent event is currently ${media.event_status}`,
    });
    return;
  }

  const isWatermarkSynced = Number(media.watermark_version || 0) === Number(media.event_watermark_version || 1);

  if (media.status === 'ready' && media.storage_key_thumbnail && isWatermarkSynced) {
    // Media was already processed and is in sync with current event watermark version (idempotent no-op)
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Photo ${mediaId} already processed with current watermark v${media.event_watermark_version} (idempotent skip)`,
      details: { jobId: job.id, mediaId, watermarkVersion: media.event_watermark_version },
    });
    await updateJobAudit(mediaId, 'photo_processing', 'completed', { progress: 100 });
    return;
  }

  try {
    const result = await processPhoto(mediaId, eventId, {
      forceReprocess: !isWatermarkSynced,
    });

    if (result.status === 'ready') {
      try {
        await detectAndRecordFaces(mediaId, eventId);
      } catch (detectErr) {
        log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'photography-api',
          message: `Face detection after photo processing failed: ${detectErr instanceof Error ? detectErr.message : String(detectErr)}`,
          details: { mediaId, eventId },
        });
      }

      try {
        await indexPhotoFaces(mediaId, eventId);
      } catch (faceErr) {
        log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'photography-api',
          message: `Face indexing after photo processing failed: ${faceErr instanceof Error ? faceErr.message : String(faceErr)}`,
          details: { mediaId, eventId },
        });
      }

      await updateJobAudit(mediaId, 'photo_processing', 'completed', { progress: 100 });
      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'photography-api',
        message: `Photo job ${job.id} completed successfully in ${Date.now() - startTime}ms`,
        details: { jobId: job.id, mediaId, durationMs: Date.now() - startTime },
      });
    } else if (result.status === 'failed') {
      const isPermanent = isNonRetryableError(result.error);
      if (isPermanent) {
        await updateJobAudit(mediaId, 'photo_processing', 'failed', {
          errorCode: 'PERMANENT_PROCESSING_ERROR',
          errorMessage: result.error ?? null,
        });
        throw new UnrecoverableError(result.error || 'Permanent photo processing failure');
      }
      throw new Error(result.error || 'Photo processing failed');
    } else {
      // Process photo returned non-ready status (e.g. storage unconfigured)
      await updateJobAudit(mediaId, 'photo_processing', result.status as any, {
        errorMessage: result.error ?? null,
      });
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const maxAttempts = job.opts.attempts || QUEUE_CONFIG.photo.attempts;
    const isExhausted = job.attemptsMade + 1 >= maxAttempts;
    const isPermanent = isNonRetryableError(err);

    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Photo processing error for job ${job.id}: ${errorMsg}`,
      details: {
        jobId: job.id,
        mediaId,
        attempt: job.attemptsMade + 1,
        maxAttempts,
        isPermanent,
      },
    });

    if (isPermanent) {
      await updateJobAudit(mediaId, 'photo_processing', 'failed', {
        errorCode: 'NON_RETRYABLE_ERROR',
        errorMessage: errorMsg,
      });
      throw new UnrecoverableError(errorMsg);
    }

    if (isExhausted) {
      await updateJobAudit(mediaId, 'photo_processing', 'failed', {
        errorCode: 'MAX_RETRIES_EXCEEDED',
        errorMessage: errorMsg,
      });
    } else {
      const delay = calculateBackoffDelay(
        job.attemptsMade + 1,
        RETRY_POLICIES.photo_processing.baseDelayMs,
        RETRY_POLICIES.photo_processing.maxDelayMs,
        RETRY_POLICIES.photo_processing.jitterRatio
      );
      const nextRetryAt = new Date(Date.now() + delay);
      await updateJobAudit(mediaId, 'photo_processing', 'retry_wait', {
        errorCode: 'TRANSIENT_FAILURE',
        errorMessage: `Retry scheduled in ${delay}ms: ${errorMsg}`,
        nextRetryAt,
      });
    }

    throw err;
  }
}

/**
 * Processor for Video Processing Jobs.
 * Verifies PostgreSQL media record idempotency, checks event lifecycle, enforces worker lease,
 * delegates to processVideo, and handles retry backoff with jitter.
 */
export async function videoJobProcessor(job: Job<VideoProcessingJobPayload>): Promise<void> {
  const { mediaId, eventId } = job.data;
  const startTime = Date.now();
  const workerId = `video-worker-${process.pid}-${job.id}`;
  const idempotencyKey = `video_processing:${mediaId}:v${job.data.version || 1}`;

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Video worker picked up job ${job.id} (attempt ${job.attemptsMade + 1}/${job.opts.attempts || QUEUE_CONFIG.video.attempts})`,
    details: { jobId: job.id, mediaId, eventId, workerId, idempotencyKey },
  });

  await recordJobAttempt(mediaId, 'video_processing', {
    workerId,
    idempotencyKey,
    correlationId: job.data.correlationId,
  });

  // Idempotency & Lifecycle check: verify current database state
  const mediaRes = await query<{ status: string; storage_key_thumbnail: string | null; event_status: string }>(
    `SELECT m.status, m.storage_key_thumbnail, e.status as event_status
     FROM media m
     JOIN events e ON e.id = m.event_id
     WHERE m.id = $1`,
    [mediaId]
  );

  if (mediaRes.rows.length === 0) {
    await updateJobAudit(mediaId, 'video_processing', 'failed', {
      errorCode: 'MEDIA_NOT_FOUND',
      errorMessage: 'Media record not found in database',
    });
    throw new UnrecoverableError(`Media item "${mediaId}" not found for video processing`);
  }

  const media = mediaRes.rows[0];

  // Lifecycle defense: abort if parent event is trashed, deleting, or deleted
  if (['deleting', 'trashed', 'deleted'].includes(media.event_status)) {
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Aborting video processing for media ${mediaId}: parent event ${eventId} is ${media.event_status}`,
      details: { jobId: job.id, mediaId, eventId },
    });
    await updateJobAudit(mediaId, 'video_processing', 'cancelled', {
      errorCode: 'EVENT_CANCELLED',
      errorMessage: `Parent event is currently ${media.event_status}`,
    });
    return;
  }

  if (media.status === 'ready' && media.storage_key_thumbnail) {
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Video ${mediaId} already processed (idempotent skip)`,
      details: { jobId: job.id, mediaId },
    });
    await updateJobAudit(mediaId, 'video_processing', 'completed', { progress: 100 });
    return;
  }

  try {
    const result = await processVideo(mediaId, eventId);

    if (result.status === 'ready') {
      await updateJobAudit(mediaId, 'video_processing', 'completed', { progress: 100 });
      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'photography-api',
        message: `Video job ${job.id} completed successfully in ${Date.now() - startTime}ms`,
        details: { jobId: job.id, mediaId, durationMs: Date.now() - startTime },
      });
    } else if (result.status === 'failed') {
      const isPermanent = isNonRetryableError(result.error);
      if (isPermanent) {
        await updateJobAudit(mediaId, 'video_processing', 'failed', {
          errorCode: 'PERMANENT_PROCESSING_ERROR',
          errorMessage: result.error ?? null,
        });
        throw new UnrecoverableError(result.error || 'Permanent video processing failure');
      }
      throw new Error(result.error || 'Video processing failed');
    } else {
      await updateJobAudit(mediaId, 'video_processing', result.status as any, {
        errorMessage: result.error ?? null,
      });
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const maxAttempts = job.opts.attempts || QUEUE_CONFIG.video.attempts;
    const isExhausted = job.attemptsMade + 1 >= maxAttempts;
    const isPermanent = isNonRetryableError(err);

    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Video processing error for job ${job.id}: ${errorMsg}`,
      details: {
        jobId: job.id,
        mediaId,
        attempt: job.attemptsMade + 1,
        maxAttempts,
        isPermanent,
      },
    });

    if (isPermanent) {
      await updateJobAudit(mediaId, 'video_processing', 'failed', {
        errorCode: 'NON_RETRYABLE_ERROR',
        errorMessage: errorMsg,
      });
      throw new UnrecoverableError(errorMsg);
    }

    if (isExhausted) {
      await updateJobAudit(mediaId, 'video_processing', 'failed', {
        errorCode: 'MAX_RETRIES_EXCEEDED',
        errorMessage: errorMsg,
      });
    } else {
      const delay = calculateBackoffDelay(
        job.attemptsMade + 1,
        RETRY_POLICIES.video_processing.baseDelayMs,
        RETRY_POLICIES.video_processing.maxDelayMs,
        RETRY_POLICIES.video_processing.jitterRatio
      );
      const nextRetryAt = new Date(Date.now() + delay);
      await updateJobAudit(mediaId, 'video_processing', 'retry_wait', {
        errorCode: 'TRANSIENT_FAILURE',
        errorMessage: `Retry scheduled in ${delay}ms: ${errorMsg}`,
        nextRetryAt,
      });
    }

    throw err;
  }
}

/**
 * Processes gallery expiry jobs.
 * Enforces atomic state transition to private and revokes guest sessions when due.
 */
async function expiryJobProcessor(job: Job<GalleryExpiryJobPayload>): Promise<void> {
  const { eventId } = job.data;
  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Running gallery expiry worker job for event ${eventId}`,
    details: { eventId, jobId: job.id },
  });

  await expireEventIfDue(eventId);
}

/**
 * Initializes and starts background workers for photo, video, expiry, and zip processing.
 * Also starts scheduled background reconcilers for stuck jobs, gallery expiry, and temporary downloads.
 * Idempotent: calling multiple times will not duplicate worker listeners.
 */
export function startWorkers(): void {
  if (workersStarted) {
    return;
  }

  const connectionOptions = getBullMQConnectionOptions();

  // Photo Worker: bounded concurrency = 4
  photoWorker = new Worker<PhotoProcessingJobPayload>(
    QUEUE_CONFIG.names.PHOTO,
    photoJobProcessor,
    {
      connection: connectionOptions as any,
      concurrency: QUEUE_CONFIG.photo.concurrency,
    }
  );

  photoWorker.on('error', (err) => {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Photo Worker internal error: ${err.message}`,
    });
  });

  // Video Worker: strictly bounded concurrency = 1 to prevent resource exhaustion
  videoWorker = new Worker<VideoProcessingJobPayload>(
    QUEUE_CONFIG.names.VIDEO,
    videoJobProcessor,
    {
      connection: connectionOptions as any,
      concurrency: QUEUE_CONFIG.video.concurrency,
    }
  );

  videoWorker.on('error', (err) => {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Video Worker internal error: ${err.message}`,
    });
  });

  // Gallery Expiry Worker: bounded concurrency = 2
  expiryWorker = new Worker<GalleryExpiryJobPayload>(
    QUEUE_CONFIG.names.GALLERY_EXPIRY,
    expiryJobProcessor,
    {
      connection: connectionOptions as any,
      concurrency: QUEUE_CONFIG.expiry.concurrency,
    }
  );

  expiryWorker.on('error', (err) => {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Expiry Worker internal error: ${err.message}`,
    });
  });

  // ZIP Generation Worker: bounded concurrency = 2
  zipWorker = new Worker<ZipGenerationJobPayload>(
    QUEUE_CONFIG.names.ZIP_GENERATION,
    async (job: Job<ZipGenerationJobPayload>) => {
      await processZipGenerationJob(job.data);
    },
    {
      connection: connectionOptions as any,
      concurrency: QUEUE_CONFIG.zip.concurrency,
    }
  );

  zipWorker.on('error', (err) => {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Zip Worker internal error: ${err.message}`,
    });
  });

  // Start periodic job reliability reconciler (every 60s) for stuck job leases and missed outbox dispatches
  startJobReliabilityReconciler(60000);

  // Start periodic reconciliation sweeper (every 60s) for missed/delayed gallery expiries
  startExpiryPeriodicReconciler(60000);

  // Start periodic temporary download archive cleanup (every hour)
  startDownloadCleanupTimer(3600000);

  // Start periodic Recycle Bin automated purge reconciler (every 60s)
  startRecycleBinPurgeReconciler(60000);

  // Reconcile any interrupted or failed event deletion workflows on worker startup
  reconcilePendingDeletions().catch((err) => {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Failed to reconcile pending event deletions on worker startup: ${err instanceof Error ? err.message : String(err)}`,
    });
  });

  workersStarted = true;

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Background job workers started [photo concurrency=${QUEUE_CONFIG.photo.concurrency}, video concurrency=${QUEUE_CONFIG.video.concurrency}, expiry concurrency=${QUEUE_CONFIG.expiry.concurrency}, zip concurrency=${QUEUE_CONFIG.zip.concurrency}]`,
  });
}

/**
 * Gracefully shuts down active workers and scheduled background reconcilers.
 * Pauses new job ingestion and waits for active jobs to finish within the grace period.
 */
export async function stopWorkers(gracePeriodMs = QUEUE_CONFIG.shutdown.gracePeriodMs): Promise<void> {
  if (!workersStarted) {
    return;
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: 'Gracefully stopping background job workers...',
  });

  // Stop job reliability reconciler
  stopJobReliabilityReconciler();

  // Stop periodic reconciler interval
  stopExpiryPeriodicReconciler();

  // Stop download cleanup timer
  stopDownloadCleanupTimer();

  // Stop recycle bin purge reconciler
  stopRecycleBinPurgeReconciler();

  const closeWorker = async (worker: Worker | null, name: string): Promise<void> => {
    if (!worker) return;
    try {
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(`${name} shutdown grace period exceeded (${gracePeriodMs}ms)`)), gracePeriodMs).unref();
      });

      await Promise.race([worker.close(), timeoutPromise]);
      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'photography-api',
        message: `${name} closed cleanly`,
      });
    } catch (err) {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `${name} shutdown warning: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  await Promise.all([
    closeWorker(photoWorker, 'PhotoWorker'),
    closeWorker(videoWorker, 'VideoWorker'),
    closeWorker(expiryWorker, 'ExpiryWorker'),
    closeWorker(zipWorker, 'ZipWorker'),
  ]);

  photoWorker = null;
  videoWorker = null;
  expiryWorker = null;
  zipWorker = null;
  workersStarted = false;
}

/**
 * Returns current status of worker processes.
 */
export function getWorkersStatus(): WorkerStatus[] {
  return [
    {
      name: 'photo-worker',
      queue: QUEUE_CONFIG.names.PHOTO,
      queueName: QUEUE_CONFIG.names.PHOTO,
      concurrency: QUEUE_CONFIG.photo.concurrency,
      isRunning: !!photoWorker && workersStarted,
      activeJobs: 0,
    },
    {
      name: 'video-worker',
      queue: QUEUE_CONFIG.names.VIDEO,
      queueName: QUEUE_CONFIG.names.VIDEO,
      concurrency: QUEUE_CONFIG.video.concurrency,
      isRunning: !!videoWorker && workersStarted,
      activeJobs: 0,
    },
    {
      name: 'expiry-worker',
      queue: QUEUE_CONFIG.names.GALLERY_EXPIRY,
      queueName: QUEUE_CONFIG.names.GALLERY_EXPIRY,
      concurrency: QUEUE_CONFIG.expiry.concurrency,
      isRunning: !!expiryWorker && workersStarted,
      activeJobs: 0,
    },
    {
      name: 'zip-worker',
      queue: QUEUE_CONFIG.names.ZIP_GENERATION,
      queueName: QUEUE_CONFIG.names.ZIP_GENERATION,
      concurrency: QUEUE_CONFIG.zip.concurrency,
      isRunning: !!zipWorker && workersStarted,
      activeJobs: 0,
    },
  ];
}
