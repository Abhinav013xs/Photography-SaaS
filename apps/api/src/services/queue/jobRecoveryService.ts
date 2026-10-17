import {
  getPhotoQueue,
  getVideoQueue,
  getExpiryQueue,
  getZipQueue,
  enqueuePhotoJob,
  enqueueVideoJob,
} from './queueManager.js';
import { getWorkersStatus } from './workerManager.js';
import { checkRedisHealth } from '../../infrastructure/redis.js';
import { query } from '../../infrastructure/database.js';
import { QUEUE_CONFIG } from './queueConfig.js';
import { log } from '../../middleware/logger.js';
import { MediaNotFoundError, ValidationError } from '@photography-saas/errors';
import { isValidUuid } from '@photography-saas/types';
import type {
  QueueMetrics,
  BackgroundInfrastructureHealth,
} from '@photography-saas/types';

let reconcilerTimer: NodeJS.Timeout | null = null;
let totalStuckJobsReclaimedCount = 0;

/**
 * Retrieves real-time queue depth and execution metrics from BullMQ.
 */
export async function getQueueMetrics(queueName: string): Promise<QueueMetrics> {
  const queue =
    queueName === QUEUE_CONFIG.names.VIDEO
      ? getVideoQueue()
      : queueName === QUEUE_CONFIG.names.GALLERY_EXPIRY
      ? getExpiryQueue()
      : queueName === QUEUE_CONFIG.names.ZIP_GENERATION
      ? getZipQueue()
      : getPhotoQueue();

  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return {
      queue: queueName,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      paused: counts.paused ?? 0,
    };
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Failed to retrieve metrics for queue ${queueName}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      queue: queueName,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    };
  }
}

/**
 * Retrieves aggregate metrics across all active background job queues.
 */
export async function getAllQueueMetrics(): Promise<QueueMetrics[]> {
  const [photoMetrics, videoMetrics, expiryMetrics, zipMetrics] = await Promise.all([
    getQueueMetrics(QUEUE_CONFIG.names.PHOTO),
    getQueueMetrics(QUEUE_CONFIG.names.VIDEO),
    getQueueMetrics(QUEUE_CONFIG.names.GALLERY_EXPIRY),
    getQueueMetrics(QUEUE_CONFIG.names.ZIP_GENERATION),
  ]);
  return [photoMetrics, videoMetrics, expiryMetrics, zipMetrics];
}

/**
 * Assesses complete background job infrastructure health: Redis connectivity, queue depths, worker status,
 * and cumulative stuck job recovery metrics.
 */
export async function getBackgroundInfrastructureHealth(): Promise<BackgroundInfrastructureHealth> {
  const redisHealth = await checkRedisHealth();
  const queues = await getAllQueueMetrics();
  const workers = getWorkersStatus();

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  let message: string | undefined;

  if (redisHealth.status === 'unhealthy') {
    status = 'unhealthy';
    message = `Redis connection failed: ${redisHealth.message || 'unreachable'}`;
  } else if (redisHealth.status === 'degraded') {
    status = 'degraded';
    message = redisHealth.message;
  }

  return {
    status,
    redis: redisHealth,
    queues,
    workers,
    message,
    stuckJobsReclaimed: totalStuckJobsReclaimedCount,
  };
}

/**
 * Manually retries a failed processing job for a specific media item.
 * Resets database states cleanly, clears error codes/messages, preserves original media,
 * and re-enqueues into the appropriate queue.
 */
export async function retryFailedJob(
  jobOrMediaId: string
): Promise<{ success: boolean; jobId: string; mediaType: string; status: string }> {
  if (!jobOrMediaId || !isValidUuid(jobOrMediaId)) {
    throw new ValidationError(`Invalid ID format: "${jobOrMediaId}"`);
  }

  // 1. Resolve mediaId (check if jobOrMediaId is a processing_jobs record ID)
  let resolvedMediaId = jobOrMediaId;
  const jobLookup = await query<{ id: string; media_id: string | null }>(
    `SELECT id, media_id FROM processing_jobs WHERE id = $1`,
    [jobOrMediaId]
  );
  if (jobLookup.rows.length > 0 && jobLookup.rows[0].media_id) {
    resolvedMediaId = jobLookup.rows[0].media_id;
  }

  // 2. Fetch media item from database
  const mediaRes = await query<{
    id: string;
    event_id: string;
    type: string;
    status: string;
    storage_key_original: string;
    event_status: string;
  }>(
    `SELECT m.id, m.event_id, m.type, m.status, m.storage_key_original, e.status as event_status
     FROM media m
     JOIN events e ON e.id = m.event_id
     WHERE m.id = $1`,
    [resolvedMediaId]
  );

  if (mediaRes.rows.length === 0) {
    throw new MediaNotFoundError(`Media item "${resolvedMediaId}" not found for retry`);
  }

  const media = mediaRes.rows[0];

  if (['deleting', 'trashed', 'deleted'].includes(media.event_status)) {
    throw new ValidationError(`Cannot retry job for media in ${media.event_status} event`);
  }

  // 3. Reset media status to 'uploaded' so processor picks it up cleanly
  await query(
    `UPDATE media
     SET status = 'uploaded',
         processing_error = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [resolvedMediaId]
  );

  // 4. Reset processing_jobs audit row
  await query(
    `UPDATE processing_jobs
     SET status = 'pending',
         progress = 0,
         error_message = NULL,
         error_code = NULL,
         lease_expires_at = NULL,
         worker_id = NULL,
         next_retry_at = NULL,
         updated_at = NOW()
     WHERE id = $1 OR media_id = $2`,
    [jobOrMediaId, resolvedMediaId]
  );

  // 5. Re-enqueue job into BullMQ
  let enqueueResult: { jobId: string };
  if (media.type === 'video') {
    enqueueResult = await enqueueVideoJob({
      mediaId: media.id,
      eventId: media.event_id,
      timestamp: Date.now(),
    });
  } else {
    enqueueResult = await enqueuePhotoJob({
      mediaId: media.id,
      eventId: media.event_id,
      timestamp: Date.now(),
    });
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Retried failed job for media ${resolvedMediaId} (${media.type})`,
    details: {
      mediaId: resolvedMediaId,
      eventId: media.event_id,
      type: media.type,
      jobId: enqueueResult.jobId,
    },
  });

  return {
    success: true,
    jobId: enqueueResult.jobId,
    mediaType: media.type,
    status: 'pending',
  };
}

/**
 * Reclaims abandoned or crashed jobs whose processing lease has expired.
 * Detects jobs in 'processing' where lease_expires_at < NOW().
 * - If attempts < max_attempts: safely reschedules for retry and increments attempts.
 * - If attempts >= max_attempts: marks as 'failed' (dead-letter) with error_code 'LEASE_EXPIRED_MAX_ATTEMPTS'.
 * - If parent event is trashed/deleting: marks as 'cancelled'.
 */
export async function reclaimStuckJobs(): Promise<{
  reclaimed: number;
  deadLettered: number;
  cancelled: number;
}> {
  let reclaimed = 0;
  let deadLettered = 0;
  let cancelled = 0;

  try {
    const stuckJobsRes = await query<{
      id: string;
      event_id: string;
      media_id: string;
      type: string;
      attempts: number;
      max_attempts: number;
      worker_id: string | null;
      event_status: string;
    }>(
      `SELECT pj.id, pj.event_id, pj.media_id, pj.type, pj.attempts,
              COALESCE(pj.max_attempts, 3) as max_attempts,
              pj.worker_id, e.status as event_status
       FROM processing_jobs pj
       JOIN events e ON e.id = pj.event_id
       WHERE pj.status = 'processing'
         AND pj.lease_expires_at IS NOT NULL
         AND pj.lease_expires_at < NOW()
       LIMIT 50`
    );

    for (const job of stuckJobsRes.rows) {
      if (['deleting', 'trashed', 'deleted'].includes(job.event_status)) {
        await query(
          `UPDATE processing_jobs
           SET status = 'cancelled',
               error_code = 'EVENT_CANCELLED',
               error_message = $1,
               lease_expires_at = NULL,
               updated_at = NOW()
           WHERE id = $2`,
          [`Parent event is ${job.event_status}`, job.id]
        );
        cancelled++;
        continue;
      }

      if (job.attempts >= job.max_attempts) {
        // Dead-letter: exhausted retry limits while leased
        await query(
          `UPDATE processing_jobs
           SET status = 'failed',
               error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
               error_message = 'Job lease expired and maximum attempts were exhausted without worker completion',
               completed_at = NOW(),
               lease_expires_at = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [job.id]
        );

        // Also mark media as failed if applicable
        if (job.media_id) {
          await query(
            `UPDATE media
             SET status = 'failed',
                 processing_error = 'Processing timeout: worker lease expired without completion',
                 updated_at = NOW()
             WHERE id = $1 AND status = 'processing'`,
            [job.media_id]
          );
        }

        deadLettered++;
        log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'photography-api',
          message: `Stuck job ${job.id} exceeded max attempts (${job.attempts}/${job.max_attempts}) and was moved to dead-letter`,
          details: { jobId: job.id, mediaId: job.media_id, workerId: job.worker_id },
        });
      } else {
        // Reclaim: schedule retry with backoff
        await query(
          `UPDATE processing_jobs
           SET status = 'retry_wait',
               error_code = 'LEASE_RECLAIMED',
               error_message = 'Worker lease expired; reclaimed by reliability reconciler',
               next_retry_at = NOW() + INTERVAL '5 seconds',
               lease_expires_at = NULL,
               worker_id = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [job.id]
        );

        // Re-enqueue into BullMQ
        try {
          if (job.type === 'video_processing') {
            await enqueueVideoJob({
              mediaId: job.media_id,
              eventId: job.event_id,
            });
          } else {
            await enqueuePhotoJob({
              mediaId: job.media_id,
              eventId: job.event_id,
            });
          }
        } catch (enqueueErr) {
          log({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: 'photography-api',
            message: `Failed re-enqueuing reclaimed job ${job.id}: ${enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr)}`,
          });
        }

        reclaimed++;
        totalStuckJobsReclaimedCount++;
        log({
          timestamp: new Date().toISOString(),
          level: 'info',
          service: 'photography-api',
          message: `Reclaimed stuck job ${job.id} for media ${job.media_id} (attempt ${job.attempts}/${job.max_attempts})`,
          details: { jobId: job.id, mediaId: job.media_id, previousWorkerId: job.worker_id },
        });
      }
    }
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Error executing reclaimStuckJobs: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return { reclaimed, deadLettered, cancelled };
}

/**
 * Outbox Dispatcher & Recovery:
 * Scans PostgreSQL processing_jobs for pending or retry_wait jobs that missed queue dispatch
 * (e.g., during Redis restart or network partition) and dispatches them safely.
 */
export async function dispatchPendingOutboxJobs(): Promise<{
  dispatched: number;
  failed: number;
}> {
  let dispatched = 0;
  let failed = 0;

  try {
    const pendingRes = await query<{
      id: string;
      event_id: string;
      media_id: string;
      type: string;
      status: string;
    }>(
      `SELECT pj.id, pj.event_id, pj.media_id, pj.type, pj.status
       FROM processing_jobs pj
       JOIN media m ON m.id = pj.media_id
       JOIN events e ON e.id = pj.event_id
       WHERE (
         (pj.status = 'pending' AND pj.created_at < NOW() - INTERVAL '30 seconds')
         OR (pj.status = 'retry_wait' AND pj.next_retry_at IS NOT NULL AND pj.next_retry_at <= NOW())
       )
       AND e.status NOT IN ('deleting', 'trashed', 'deleted')
       LIMIT 50`
    );

    for (const row of pendingRes.rows) {
      try {
        if (row.type === 'video_processing') {
          await enqueueVideoJob({
            mediaId: row.media_id,
            eventId: row.event_id,
          });
        } else if (row.type === 'photo_processing') {
          await enqueuePhotoJob({
            mediaId: row.media_id,
            eventId: row.event_id,
          });
        }

        // Mark status as queued
        await query(
          `UPDATE processing_jobs
           SET status = 'queued',
               updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        );

        dispatched++;
      } catch (err) {
        failed++;
        log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'photography-api',
          message: `Outbox dispatch failed for job ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Failed scanning outbox for pending jobs: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return { dispatched, failed };
}

/**
 * Starts periodic background reliability reconciler:
 * Runs reclaimStuckJobs() and dispatchPendingOutboxJobs() on configured interval.
 */
export function startJobReliabilityReconciler(intervalMs = 60000): void {
  if (reconcilerTimer) {
    return;
  }

  reconcilerTimer = setInterval(async () => {
    try {
      await reclaimStuckJobs();
      await dispatchPendingOutboxJobs();
    } catch (err) {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Job reliability reconciler tick error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, intervalMs);

  // Unref timer so it does not block Node process exit during shutdown
  reconcilerTimer.unref();

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Job reliability reconciler started (interval: ${intervalMs}ms)`,
  });
}

/**
 * Stops periodic background reliability reconciler cleanly.
 */
export function stopJobReliabilityReconciler(): void {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: 'Job reliability reconciler stopped',
    });
  }
}
