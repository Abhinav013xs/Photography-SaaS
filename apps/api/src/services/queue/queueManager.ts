import { Queue } from 'bullmq';
import {
  QUEUE_CONFIG,
  validatePhotoJobPayload,
  validateVideoJobPayload,
  validateGalleryExpiryJobPayload,
  validateZipJobPayload,
} from './queueConfig.js';
import { getBullMQConnectionOptions } from './queueConnection.js';
import {
  type PhotoProcessingJobPayload,
  type VideoProcessingJobPayload,
  type GalleryExpiryJobPayload,
  type ZipGenerationJobPayload,
} from '@photography-saas/types';
import { log } from '../../middleware/logger.js';

let photoQueue: Queue<PhotoProcessingJobPayload> | null = null;
let videoQueue: Queue<VideoProcessingJobPayload> | null = null;
let expiryQueue: Queue<GalleryExpiryJobPayload> | null = null;
let zipQueue: Queue<ZipGenerationJobPayload> | null = null;

/**
 * Returns the singleton BullMQ Queue for photo processing.
 */
export function getPhotoQueue(): Queue<PhotoProcessingJobPayload> {
  if (!photoQueue) {
    const queue = new Queue<PhotoProcessingJobPayload>(QUEUE_CONFIG.names.PHOTO, {
      connection: getBullMQConnectionOptions() as any,
      defaultJobOptions: {
        attempts: QUEUE_CONFIG.photo.attempts,
        backoff: QUEUE_CONFIG.photo.backoff,
        removeOnComplete: QUEUE_CONFIG.photo.removeOnComplete,
        removeOnFail: QUEUE_CONFIG.photo.removeOnFail,
      },
    });

    queue.on('error', (err) => {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Photo Queue error: ${err.message}`,
      });
    });

    photoQueue = queue;
  }
  return photoQueue;
}

/**
 * Returns the singleton BullMQ Queue for video processing.
 */
export function getVideoQueue(): Queue<VideoProcessingJobPayload> {
  if (!videoQueue) {
    const queue = new Queue<VideoProcessingJobPayload>(QUEUE_CONFIG.names.VIDEO, {
      connection: getBullMQConnectionOptions() as any,
      defaultJobOptions: {
        attempts: QUEUE_CONFIG.video.attempts,
        backoff: QUEUE_CONFIG.video.backoff,
        removeOnComplete: QUEUE_CONFIG.video.removeOnComplete,
        removeOnFail: QUEUE_CONFIG.video.removeOnFail,
      },
    });

    queue.on('error', (err) => {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Video Queue error: ${err.message}`,
      });
    });

    videoQueue = queue;
  }
  return videoQueue;
}

/**
 * Enqueues a photo processing job with payload validation and stable jobId deduplication.
 */
export async function enqueuePhotoJob(payload: PhotoProcessingJobPayload): Promise<{ jobId: string }> {
  const validated = validatePhotoJobPayload(payload);
  const queue = getPhotoQueue();

  try {
    const job = await queue.add(QUEUE_CONFIG.jobNames.PHOTO, validated, {
      jobId: validated.mediaId, // Deterministic jobId for queue-level duplicate protection
    });

    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Enqueued photo processing job: ${job.id}`,
      details: {
        jobId: job.id,
        mediaId: validated.mediaId,
        eventId: validated.eventId,
        queue: QUEUE_CONFIG.names.PHOTO,
      },
    });

    return { jobId: job.id || validated.mediaId };
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Failed to enqueue photo processing job: ${err instanceof Error ? err.message : String(err)}`,
      details: {
        mediaId: validated.mediaId,
        eventId: validated.eventId,
      },
    });
    throw err;
  }
}

/**
 * Enqueues a video processing job with payload validation and stable jobId deduplication.
 */
export async function enqueueVideoJob(payload: VideoProcessingJobPayload): Promise<{ jobId: string }> {
  const validated = validateVideoJobPayload(payload);
  const queue = getVideoQueue();

  try {
    const job = await queue.add(QUEUE_CONFIG.jobNames.VIDEO, validated, {
      jobId: validated.mediaId, // Deterministic jobId for queue-level duplicate protection
    });

    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Enqueued video processing job: ${job.id}`,
      details: {
        jobId: job.id,
        mediaId: validated.mediaId,
        eventId: validated.eventId,
        queue: QUEUE_CONFIG.names.VIDEO,
      },
    });

    return { jobId: job.id || validated.mediaId };
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Failed to enqueue video processing job: ${err instanceof Error ? err.message : String(err)}`,
      details: {
        mediaId: validated.mediaId,
        eventId: validated.eventId,
      },
    });
    throw err;
  }
}

/**
 * Returns the singleton BullMQ Queue for gallery expiry processing.
 */
export function getExpiryQueue(): Queue<GalleryExpiryJobPayload> {
  if (!expiryQueue) {
    const queue = new Queue<GalleryExpiryJobPayload>(QUEUE_CONFIG.names.GALLERY_EXPIRY, {
      connection: getBullMQConnectionOptions() as any,
      defaultJobOptions: {
        attempts: QUEUE_CONFIG.expiry.attempts,
        backoff: QUEUE_CONFIG.expiry.backoff,
        removeOnComplete: QUEUE_CONFIG.expiry.removeOnComplete,
        removeOnFail: QUEUE_CONFIG.expiry.removeOnFail,
      },
    });

    queue.on('error', (err) => {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Expiry Queue error: ${err.message}`,
      });
    });

    expiryQueue = queue;
  }
  return expiryQueue;
}

/**
 * Enqueues a gallery expiry job with payload validation and delayed scheduling.
 */
export async function enqueueExpiryJob(
  payload: GalleryExpiryJobPayload,
  delayMs = 0
): Promise<{ jobId: string }> {
  const validated = validateGalleryExpiryJobPayload(payload);
  const queue = getExpiryQueue();

  try {
    const job = await queue.add(QUEUE_CONFIG.jobNames.EXPIRY, validated, {
      jobId: `expiry-${validated.eventId}`,
      delay: Math.max(0, delayMs),
    });

    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Enqueued gallery expiry job: ${job.id}`,
      details: {
        jobId: job.id,
        eventId: validated.eventId,
        delayMs,
        queue: QUEUE_CONFIG.names.GALLERY_EXPIRY,
      },
    });

    return { jobId: job.id || `expiry-${validated.eventId}` };
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Failed to enqueue gallery expiry job: ${err instanceof Error ? err.message : String(err)}`,
      details: { eventId: validated.eventId },
    });
    // Do not throw here so database transaction is not compromised; periodic reconciler will catch it!
    return { jobId: `expiry-${validated.eventId}` };
  }
}

/**
 * Returns the singleton BullMQ Queue for background ZIP generation.
 */
export function getZipQueue(): Queue<ZipGenerationJobPayload> {
  if (!zipQueue) {
    const queue = new Queue<ZipGenerationJobPayload>(QUEUE_CONFIG.names.ZIP_GENERATION, {
      connection: getBullMQConnectionOptions() as any,
      defaultJobOptions: {
        attempts: QUEUE_CONFIG.zip.attempts,
        backoff: QUEUE_CONFIG.zip.backoff,
        removeOnComplete: QUEUE_CONFIG.zip.removeOnComplete,
        removeOnFail: QUEUE_CONFIG.zip.removeOnFail,
      },
    });

    queue.on('error', (err) => {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Zip Queue error: ${err.message}`,
      });
    });

    zipQueue = queue;
  }
  return zipQueue;
}

/**
 * Enqueues a background ZIP generation job with payload validation.
 */
export async function enqueueZipJob(payload: ZipGenerationJobPayload): Promise<{ jobId: string }> {
  const validated = validateZipJobPayload(payload);
  const queue = getZipQueue();

  try {
    const job = await queue.add(QUEUE_CONFIG.jobNames.ZIP, validated, {
      jobId: `zip-${validated.jobId}`,
    });

    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Enqueued zip generation job: ${job.id}`,
      details: {
        jobId: job.id,
        downloadJobId: validated.jobId,
        eventId: validated.eventId,
        itemCount: validated.mediaIds?.length ?? 'all',
        queue: QUEUE_CONFIG.names.ZIP_GENERATION,
      },
    });

    return { jobId: job.id || `zip-${validated.jobId}` };
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Failed to enqueue zip generation job: ${err instanceof Error ? err.message : String(err)}`,
      details: { jobId: validated.jobId, eventId: validated.eventId },
    });
    throw err;
  }
}

/**
 * Closes all queue connections cleanly.
 */
export async function closeQueues(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  if (photoQueue) {
    closePromises.push(photoQueue.close());
    photoQueue = null;
  }
  if (videoQueue) {
    closePromises.push(videoQueue.close());
    videoQueue = null;
  }
  if (expiryQueue) {
    closePromises.push(expiryQueue.close());
    expiryQueue = null;
  }
  if (zipQueue) {
    closePromises.push(zipQueue.close());
    zipQueue = null;
  }
  await Promise.all(closePromises);
}
