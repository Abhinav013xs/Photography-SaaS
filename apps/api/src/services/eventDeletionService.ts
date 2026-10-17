import { randomUUID } from 'crypto';
import { query, withTransaction } from '../infrastructure/database.js';
import { storageAdapter } from '../infrastructure/storageAdapter.js';
import { log } from '../middleware/logger.js';
import {
  EventNotFoundError,
  ValidationError,
  ConflictError,
  InternalError,
} from '@photography-saas/errors';
import type {
  EventDeletionStage,
  EventDeletionJobDTO,
  DeleteEventResponseDTO,
} from '@photography-saas/types';

interface EventDeletionJobRow {
  id: string;
  event_id: string;
  owner_id: number;
  event_name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  stage: EventDeletionStage;
  attempts: number;
  r2_objects_deleted: number;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapRowToDTO(row: EventDeletionJobRow): EventDeletionJobDTO {
  return {
    id: row.id,
    eventId: row.event_id,
    ownerId: row.owner_id,
    eventName: row.event_name,
    status: row.status,
    stage: row.stage,
    attempts: row.attempts,
    r2ObjectsDeleted: row.r2_objects_deleted,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Initiates permanent event deletion:
 * 1. Verifies owner and explicit confirmation name.
 * 2. Soft-locks the event: atomically updates events.status = 'deleting'.
 * 3. Creates or retrieves a durable event_deletion_jobs record.
 * 4. Executes the durable deletion workflow through completion.
 */
export async function deleteEventPermanently(
  eventId: string,
  ownerId: number,
  confirmName?: string,
  options?: { skipNameCheck?: boolean }
): Promise<DeleteEventResponseDTO> {
  // 1. Fetch event and verify ownership
  const eventRes = await query<{
    id: string;
    owner_id: number;
    name: string;
    status: string;
  }>(
    'SELECT id, owner_id, name, status FROM events WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [eventId, ownerId]
  );

  if (eventRes.rows.length === 0) {
    throw new EventNotFoundError(`Event with ID "${eventId}" not found or unauthorized`);
  }

  const event = eventRes.rows[0];

  // 2. Validate confirmation name unless explicitly skipped (e.g., automated purge or empty bin)
  if (!options?.skipNameCheck) {
    if (!confirmName || confirmName.trim().toLowerCase() !== event.name.trim().toLowerCase()) {
      throw new ValidationError(
        `Confirmation name "${confirmName || ''}" does not match the actual event name "${event.name}".`
      );
    }
  }

  // 3. Atomically transition to 'deleting' state if not already deleting
  if (event.status !== 'deleting') {
    await query(
      `UPDATE events
       SET status = 'deleting',
           visibility = 'private',
           updated_at = NOW()
       WHERE id = $1 AND owner_id = $2`,
      [eventId, ownerId]
    );

    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'event-deletion',
      message: `Event transitioned to deleting soft-lock: ${event.name} (${eventId})`,
      details: { eventId, ownerId, eventName: event.name },
    });
  }

  // 4. Create or reuse durable deletion job record
  const existingJobRes = await query<EventDeletionJobRow>(
    `SELECT * FROM event_deletion_jobs
     WHERE event_id = $1 AND owner_id = $2 AND status IN ('pending', 'processing')
     ORDER BY created_at DESC LIMIT 1`,
    [eventId, ownerId]
  );

  let jobId: string;
  if (existingJobRes.rows.length > 0) {
    jobId = existingJobRes.rows[0].id;
  } else {
    jobId = randomUUID();
    await query(
      `INSERT INTO event_deletion_jobs (
         id, event_id, owner_id, event_name, status, stage, started_at, attempts
       ) VALUES ($1, $2, $3, $4, 'processing', 'access_blocked', NOW(), 1)`,
      [jobId, eventId, ownerId, event.name]
    );
  }

  // 5. Execute deletion workflow
  const completedJob = await executeDeletionWorkflow(jobId);

  return {
    deleted: true,
    id: eventId,
    name: event.name,
    jobId: completedJob.id,
    r2ObjectsDeleted: completedJob.r2ObjectsDeleted,
    stage: completedJob.stage,
  };
}

/**
 * Executes the idempotent multi-stage deletion workflow for an event deletion job.
 */
export async function executeDeletionWorkflow(jobId: string): Promise<EventDeletionJobDTO> {
  const jobRes = await query<EventDeletionJobRow>(
    'SELECT * FROM event_deletion_jobs WHERE id = $1 LIMIT 1',
    [jobId]
  );

  if (jobRes.rows.length === 0) {
    throw new InternalError(`Deletion job "${jobId}" not found`);
  }

  const job = jobRes.rows[0];
  const { event_id: eventId, owner_id: ownerId, event_name: eventName } = job;

  // Increment attempts
  await query(
    `UPDATE event_deletion_jobs
     SET attempts = attempts + 1,
         status = 'processing',
         updated_at = NOW()
     WHERE id = $1`,
    [jobId]
  );

  try {
    // STAGE 1: Access Blocked (verified by event.status = 'deleting')
    await query(
      `UPDATE event_deletion_jobs SET stage = 'access_blocked', updated_at = NOW() WHERE id = $1`,
      [jobId]
    );

    // STAGE 2: Jobs Cancelled (cancel running / pending background jobs)
    await query(
      `UPDATE processing_jobs
       SET status = 'failed',
           error_message = 'Cancelled: Parent event is being permanently deleted',
           updated_at = NOW()
       WHERE event_id = $1 AND status IN ('pending', 'processing')`,
      [eventId]
    );

    await query(
      `UPDATE event_deletion_jobs SET stage = 'jobs_cancelled', updated_at = NOW() WHERE id = $1`,
      [jobId]
    );

    // STAGE 3: Cloudflare R2 Object Purge
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'event-deletion',
      message: `Starting Cloudflare R2 object inventory and purge for event: ${eventId}`,
      details: { jobId, eventId },
    });

    const purgeResult = await storageAdapter.purgeEventPrefix(eventId, {
      maxRetries: 3,
    });

    const r2Deleted = purgeResult?.deletedCount ?? (purgeResult as any)?.totalDeleted ?? 0;

    await query(
      `UPDATE event_deletion_jobs
       SET stage = 'r2_purged',
           r2_objects_deleted = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [jobId, r2Deleted]
    );

    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'event-deletion',
      message: `Purged ${purgeResult.deletedCount} Cloudflare R2 objects for event: ${eventId}`,
      details: { jobId, eventId, deletedCount: purgeResult.deletedCount },
    });

    // STAGE 4: Database Purge (Cascading SQL Delete)
    await withTransaction(async (client) => {
      // Deleting events row cascades to:
      // folders, media, face_embeddings, processing_jobs, download_jobs, guest_sessions, storage_usage
      await client.query(
        'DELETE FROM events WHERE id = $1 AND owner_id = $2',
        [eventId, ownerId]
      );
    });

    await query(
      `UPDATE event_deletion_jobs SET stage = 'database_purged', updated_at = NOW() WHERE id = $1`,
      [jobId]
    );

    // STAGE 5: Post-Purge Verification
    const remainingEvents = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM events WHERE id = $1',
      [eventId]
    );
    const remainingMedia = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM media WHERE event_id = $1',
      [eventId]
    );
    const remainingFaces = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM face_embeddings WHERE event_id = $1',
      [eventId]
    );

    const hasRemainingDb =
      Number(remainingEvents.rows[0]?.count || 0) > 0 ||
      Number(remainingMedia.rows[0]?.count || 0) > 0 ||
      Number(remainingFaces.rows[0]?.count || 0) > 0;

    if (hasRemainingDb) {
      throw new InternalError(`Database verification failed: residual records remain for event ${eventId}`);
    }

    // Verify R2 is clear
    const r2Verification = await storageAdapter.listObjects({
      prefix: `events/${eventId}/`,
      maxKeys: 1,
    });

    if (r2Verification.keyCount > 0) {
      throw new InternalError(`R2 verification failed: residual storage objects remain for event ${eventId}`);
    }

    await query(
      `UPDATE event_deletion_jobs SET stage = 'verified', updated_at = NOW() WHERE id = $1`,
      [jobId]
    );

    // STAGE 6: Mark Completed
    const finalRes = await query<EventDeletionJobRow>(
      `UPDATE event_deletion_jobs
       SET status = 'completed',
           stage = 'completed',
           completed_at = NOW(),
           error_code = NULL,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [jobId]
    );

    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'event-deletion',
      message: `Event permanently deleted and verified: ${eventName} (${eventId})`,
      details: { jobId, eventId, r2ObjectsDeleted: purgeResult.deletedCount },
    });

    return mapRowToDTO(finalRes.rows[0]);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorCode = (err as { code?: string })?.code || 'DELETION_FAILED';

    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'event-deletion',
      message: `Event deletion job ${jobId} failed at current stage: ${errorMsg}`,
      details: { jobId, eventId, errorCode },
    });

    await query(
      `UPDATE event_deletion_jobs
       SET status = 'failed',
           error_code = $2,
           error_message = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [jobId, errorCode, errorMsg]
    );

    throw err;
  }
}

/**
 * Retrieves the latest deletion job status for an event.
 */
export async function getEventDeletionStatus(
  eventId: string,
  ownerId: number
): Promise<EventDeletionJobDTO | null> {
  const res = await query<EventDeletionJobRow>(
    `SELECT * FROM event_deletion_jobs
     WHERE event_id = $1 AND owner_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [eventId, ownerId]
  );

  if (res.rows.length === 0) {
    return null;
  }

  return mapRowToDTO(res.rows[0]);
}

/**
 * Reconciles any interrupted or failed deletion jobs across the system.
 * Designed to run during startup and as part of periodic maintenance sweeps.
 */
export async function reconcilePendingDeletions(): Promise<{
  resumedCount: number;
  errors: string[];
}> {
  // Find jobs stuck in pending, processing, or failed with < 5 attempts
  const pendingJobs = await query<EventDeletionJobRow>(
    `SELECT * FROM event_deletion_jobs
     WHERE status IN ('pending', 'processing')
        OR (status = 'failed' AND attempts < 5)
     ORDER BY created_at ASC`
  );

  let resumedCount = 0;
  const errors: string[] = [];

  for (const job of pendingJobs.rows) {
    try {
      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'event-deletion',
        message: `Resuming pending deletion job: ${job.id} for event ${job.event_id}`,
        details: { jobId: job.id, eventId: job.event_id, stage: job.stage },
      });

      await executeDeletionWorkflow(job.id);
      resumedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Job ${job.id}: ${msg}`);
    }
  }

  // Also check for any events with status = 'deleting' that have no completed deletion job
  const unlinkedDeletingEvents = await query<{ id: string; owner_id: number; name: string }>(
    `SELECT e.id, e.owner_id, e.name
     FROM events e
     LEFT JOIN event_deletion_jobs j ON j.event_id = e.id AND j.status = 'completed'
     WHERE e.status = 'deleting' AND j.id IS NULL`
  );

  for (const ev of unlinkedDeletingEvents.rows) {
    try {
      const newJobId = randomUUID();
      await query(
        `INSERT INTO event_deletion_jobs (
           id, event_id, owner_id, event_name, status, stage, started_at, attempts
         ) VALUES ($1, $2, $3, $4, 'processing', 'access_blocked', NOW(), 1)`,
        [newJobId, ev.id, ev.owner_id, ev.name]
      );
      await executeDeletionWorkflow(newJobId);
      resumedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Event ${ev.id}: ${msg}`);
    }
  }

  return { resumedCount, errors };
}
