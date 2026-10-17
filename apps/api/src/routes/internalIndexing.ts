import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../infrastructure/database.js';
import { enqueuePhotoJob } from '../services/queue/queueManager.js';
import {
  retryFailedJob,
  reclaimStuckJobs,
  dispatchPendingOutboxJobs,
} from '../services/queue/jobRecoveryService.js';
import { indexPhotoFaces } from '../services/faceIndexingService.js';
import { requirePhotographer } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { getConfig } from '@photography-saas/config';
import {
  NotFoundError,
  AuthorizationError,
  ValidationError,
  MediaNotFoundError,
  ConflictError,
} from '@photography-saas/errors';
import type { ApiResponse } from '@photography-saas/types';

export const internalIndexingRouter = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const indexPhotoSchema = z.object({
  mediaId: z.string().regex(UUID_REGEX, 'Invalid mediaId UUID format'),
  eventId: z.string().regex(UUID_REGEX, 'Invalid eventId UUID format'),
  sync: z.boolean().optional(),
});

/**
 * Authentication middleware for internal indexing operations.
 * Accepts:
 * 1. Authenticated photographer session (verifying event ownership downstream).
 * 2. Or valid internal service key via 'X-Internal-Service-Key' header.
 */
async function authenticateInternalOrPhotographer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const config = getConfig();
  const internalKey = req.headers['x-internal-service-key'];
  const validKey = config.internalServiceKey || config.authSecret;
  if (
    internalKey &&
    typeof internalKey === 'string' &&
    (internalKey === validKey || internalKey === config.authSecret)
  ) {
    // Verified internal microservice caller
    return next();
  }

  // Fallback to photographer session authentication
  requirePhotographer(req, res, next);
}

/**
 * Validates that the caller is authorized for the specified event:
 * - If internal service key was used: permitted.
 * - If photographer session was used: verifies photographer owns the event.
 */
async function verifyEventOwnershipIfPhotographer(req: Request, eventId: string): Promise<void> {
  const eventRes = await query<{ id: string; owner_id: number; status: string }>(
    `SELECT id, owner_id, status FROM events WHERE id = $1`,
    [eventId]
  );

  if (eventRes.rows.length === 0) {
    throw new NotFoundError(`Event "${eventId}" not found`);
  }

  if (eventRes.rows[0].status === 'deleting') {
    throw new ConflictError(`Event "${eventId}" is currently being deleted`);
  }

  const internalKey = req.headers['x-internal-service-key'];
  const config = getConfig();
  const validKey = config.internalServiceKey || config.authSecret;
  if (
    internalKey &&
    typeof internalKey === 'string' &&
    (internalKey === validKey || internalKey === config.authSecret)
  ) {
    return;
  }

  const photographerId = req.auth?.id ?? req.photographer?.id;
  if (!photographerId) {
    throw new AuthorizationError('Authentication required');
  }

  if (eventRes.rows[0].owner_id !== photographerId) {
    throw new AuthorizationError('You do not have permission to manage this event');
  }
}

/**
 * POST /internal/index-photo (and /api/internal/index-photo)
 * Enqueues authorized neural face indexing for an event photograph.
 * Optionally runs synchronously if sync: true is requested.
 */
internalIndexingRouter.post(
  '/index-photo',
  authenticateInternalOrPhotographer,
  validateBody(indexPhotoSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mediaId, eventId, sync } = req.body;

      // 1. Authorize caller against event
      await verifyEventOwnershipIfPhotographer(req, eventId);

      // 2. Verify media exists and belongs to event
      const mediaRes = await query<{
        id: string;
        event_id: string;
        type: string;
        status: string;
        filename: string;
      }>(
        `SELECT id, event_id, type, status, filename
         FROM media
         WHERE id = $1 AND event_id = $2`,
        [mediaId, eventId]
      );

      if (mediaRes.rows.length === 0) {
        throw new MediaNotFoundError(`Photo "${mediaId}" not found in event "${eventId}"`);
      }

      const media = mediaRes.rows[0];
      if (media.type !== 'photo') {
        throw new ValidationError(`Media "${mediaId}" is of type "${media.type}", not photo`);
      }

      // 3. Either run synchronously or enqueue into background worker
      if (sync === true) {
        const indexResult = await indexPhotoFaces(mediaId, eventId);
        const response: ApiResponse<typeof indexResult> = {
          success: true,
          data: indexResult,
          meta: { requestId: req.requestId },
        };
        res.status(200).json(response);
        return;
      }

      // Record job in processing_jobs audit table
      await query(
        `INSERT INTO processing_jobs (
           id, event_id, media_id, type, status, progress, total_items, processed_items, created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1, $2, 'face_indexing', 'pending', 0, 1, 0, NOW(), NOW()
         )
         ON CONFLICT DO NOTHING`,
        [eventId, mediaId]
      );

      // Enqueue job into BullMQ
      const { jobId } = await enqueuePhotoJob({ mediaId, eventId });

      const response: ApiResponse<{
        jobId: string;
        mediaId: string;
        eventId: string;
        status: string;
      }> = {
        success: true,
        data: {
          jobId,
          mediaId,
          eventId,
          status: 'pending',
        },
        meta: { requestId: req.requestId },
      };

      res.status(202).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /internal/index-jobs/:jobId (and /api/internal/index-jobs/:jobId)
 * Retrieves processing status for a photo indexing job.
 */
internalIndexingRouter.get(
  '/index-jobs/:jobId',
  authenticateInternalOrPhotographer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.params;

      if (!jobId || !UUID_REGEX.test(jobId)) {
        throw new ValidationError(`Invalid jobId UUID format: "${jobId}"`);
      }

      // Query processing_jobs by job id or media_id
      const jobRes = await query<{
        id: string;
        event_id: string;
        media_id: string | null;
        type: string;
        status: string;
        progress: number;
        total_items: number;
        processed_items: number;
        error_message: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, event_id, media_id, type, status, progress, total_items, processed_items,
                error_message, created_at, updated_at
         FROM processing_jobs
         WHERE id = $1 OR media_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [jobId]
      );

      if (jobRes.rows.length === 0) {
        throw new NotFoundError(`Processing job "${jobId}" not found`);
      }

      const job = jobRes.rows[0];

      // Verify event ownership
      await verifyEventOwnershipIfPhotographer(req, job.event_id);

      const response: ApiResponse<{
        id: string;
        eventId: string;
        mediaId: string | null;
        type: string;
        status: string;
        progress: number;
        totalItems: number;
        processedItems: number;
        errorMessage: string | null;
        createdAt: string;
        updatedAt: string;
      }> = {
        success: true,
        data: {
          id: job.id,
          eventId: job.event_id,
          mediaId: job.media_id,
          type: job.type,
          status: job.status,
          progress: job.progress,
          totalItems: job.total_items,
          processedItems: job.processed_items,
          errorMessage: job.error_message,
          createdAt: job.created_at.toISOString(),
          updatedAt: job.updated_at.toISOString(),
        },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /internal/index-jobs/:jobId/retry (and /api/internal/index-jobs/:jobId/retry)
 * Retries an authorized failed photo indexing / processing job.
 */
internalIndexingRouter.post(
  '/index-jobs/:jobId/retry',
  authenticateInternalOrPhotographer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.params;

      if (!jobId || !UUID_REGEX.test(jobId)) {
        throw new ValidationError(`Invalid jobId UUID format: "${jobId}"`);
      }

      // Query processing_jobs by job id or media_id
      const jobRes = await query<{
        id: string;
        event_id: string;
        media_id: string | null;
        type: string;
        status: string;
      }>(
        `SELECT id, event_id, media_id, type, status
         FROM processing_jobs
         WHERE id = $1 OR media_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [jobId]
      );

      if (jobRes.rows.length === 0) {
        throw new NotFoundError(`Processing job "${jobId}" not found`);
      }

      const job = jobRes.rows[0];

      if (!job.media_id) {
        throw new ValidationError(`Job "${jobId}" does not have an associated mediaId for retry`);
      }

      // Verify event ownership
      await verifyEventOwnershipIfPhotographer(req, job.event_id);

      // Execute retry
      const retryResult = await retryFailedJob(job.media_id);

      const response: ApiResponse<{
        jobId: string;
        mediaId: string;
        status: string;
        message: string;
      }> = {
        success: true,
        data: {
          jobId: retryResult.jobId,
          mediaId: job.media_id,
          status: 'pending',
          message: 'Job successfully re-enqueued for processing',
        },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /internal/jobs (and /api/internal/jobs)
 * Lists durable processing jobs with optional filtering by status, type, eventId, and pagination.
 */
internalIndexingRouter.get(
  '/jobs',
  authenticateInternalOrPhotographer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, type, eventId, limit: queryLimit, offset: queryOffset } = req.query;
      const limit = Math.min(Math.max(1, parseInt(String(queryLimit || '50'), 10)), 100);
      const offset = Math.max(0, parseInt(String(queryOffset || '0'), 10));

      const conditions: string[] = [];
      const params: any[] = [];

      if (eventId && typeof eventId === 'string' && UUID_REGEX.test(eventId)) {
        await verifyEventOwnershipIfPhotographer(req, eventId);
        params.push(eventId);
        conditions.push(`pj.event_id = $${params.length}`);
      }

      if (status && typeof status === 'string') {
        params.push(status);
        conditions.push(`pj.status = $${params.length}`);
      }

      if (type && typeof type === 'string') {
        params.push(type);
        conditions.push(`pj.type = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      params.push(limit);
      const limitParamIdx = params.length;
      params.push(offset);
      const offsetParamIdx = params.length;

      const jobsRes = await query<{
        id: string;
        event_id: string;
        media_id: string | null;
        type: string;
        status: string;
        progress: number;
        total_items: number;
        processed_items: number;
        attempts: number;
        max_attempts: number;
        started_at: Date | null;
        last_attempt_at: Date | null;
        next_retry_at: Date | null;
        completed_at: Date | null;
        error_code: string | null;
        error_message: string | null;
        worker_id: string | null;
        idempotency_key: string | null;
        correlation_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT pj.id, pj.event_id, pj.media_id, pj.type, pj.status, pj.progress,
                pj.total_items, pj.processed_items, pj.attempts,
                COALESCE(pj.max_attempts, 3) as max_attempts,
                pj.started_at, pj.last_attempt_at, pj.next_retry_at, pj.completed_at,
                pj.error_code, pj.error_message, pj.worker_id, pj.idempotency_key,
                pj.correlation_id, pj.created_at, pj.updated_at
         FROM processing_jobs pj
         ${whereClause}
         ORDER BY pj.updated_at DESC
         LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
        params
      );

      const countRes = await query<{ total: string }>(
        `SELECT COUNT(*) as total FROM processing_jobs pj ${whereClause}`,
        params.slice(0, limitParamIdx - 1)
      );

      const total = parseInt(countRes.rows[0]?.total || '0', 10);

      const formatted = jobsRes.rows.map((j) => ({
        id: j.id,
        eventId: j.event_id,
        mediaId: j.media_id,
        type: j.type,
        status: j.status,
        progress: j.progress,
        totalItems: j.total_items,
        processedItems: j.processed_items,
        attempts: j.attempts,
        maxAttempts: j.max_attempts,
        startedAt: j.started_at?.toISOString() || null,
        lastAttemptAt: j.last_attempt_at?.toISOString() || null,
        nextRetryAt: j.next_retry_at?.toISOString() || null,
        completedAt: j.completed_at?.toISOString() || null,
        errorCode: j.error_code,
        errorMessage: j.error_message,
        workerId: j.worker_id,
        idempotencyKey: j.idempotency_key,
        correlationId: j.correlation_id,
        createdAt: j.created_at.toISOString(),
        updatedAt: j.updated_at.toISOString(),
      }));

      const response: ApiResponse<typeof formatted> = {
        success: true,
        data: formatted,
        meta: {
          requestId: req.requestId,
          total,
          limit,
          page: Math.floor(offset / limit) + 1,
          hasMore: offset + limit < total,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /internal/jobs/reconcile (and /api/internal/jobs/reconcile)
 * Manually executes stuck job reclamation and pending outbox queue dispatch.
 */
internalIndexingRouter.post(
  '/jobs/reconcile',
  authenticateInternalOrPhotographer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [reclaimResult, outboxResult] = await Promise.all([
        reclaimStuckJobs(),
        dispatchPendingOutboxJobs(),
      ]);

      const response: ApiResponse<{
        reclaimed: number;
        deadLettered: number;
        cancelled: number;
        dispatched: number;
        failed: number;
      }> = {
        success: true,
        data: {
          reclaimed: reclaimResult.reclaimed,
          deadLettered: reclaimResult.deadLettered,
          cancelled: reclaimResult.cancelled,
          dispatched: outboxResult.dispatched,
          failed: outboxResult.failed,
        },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /internal/jobs/:jobId
 * Retrieves detailed metadata for a durable processing job.
 */
internalIndexingRouter.get(
  '/jobs/:jobId',
  authenticateInternalOrPhotographer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.params;

      if (!jobId || !UUID_REGEX.test(jobId)) {
        throw new ValidationError(`Invalid jobId UUID format: "${jobId}"`);
      }

      const jobRes = await query<{
        id: string;
        event_id: string;
        media_id: string | null;
        type: string;
        status: string;
        progress: number;
        total_items: number;
        processed_items: number;
        attempts: number;
        max_attempts: number;
        started_at: Date | null;
        last_attempt_at: Date | null;
        next_retry_at: Date | null;
        completed_at: Date | null;
        error_code: string | null;
        error_message: string | null;
        worker_id: string | null;
        idempotency_key: string | null;
        correlation_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT pj.id, pj.event_id, pj.media_id, pj.type, pj.status, pj.progress,
                pj.total_items, pj.processed_items, pj.attempts,
                COALESCE(pj.max_attempts, 3) as max_attempts,
                pj.started_at, pj.last_attempt_at, pj.next_retry_at, pj.completed_at,
                pj.error_code, pj.error_message, pj.worker_id, pj.idempotency_key,
                pj.correlation_id, pj.created_at, pj.updated_at
         FROM processing_jobs pj
         WHERE pj.id = $1 OR pj.media_id = $1
         ORDER BY pj.updated_at DESC
         LIMIT 1`,
        [jobId]
      );

      if (jobRes.rows.length === 0) {
        throw new NotFoundError(`Processing job "${jobId}" not found`);
      }

      const job = jobRes.rows[0];
      await verifyEventOwnershipIfPhotographer(req, job.event_id);

      const response: ApiResponse<{
        id: string;
        eventId: string;
        mediaId: string | null;
        type: string;
        status: string;
        progress: number;
        totalItems: number;
        processedItems: number;
        attempts: number;
        maxAttempts: number;
        startedAt: string | null;
        lastAttemptAt: string | null;
        nextRetryAt: string | null;
        completedAt: string | null;
        errorCode: string | null;
        errorMessage: string | null;
        workerId: string | null;
        idempotencyKey: string | null;
        correlationId: string | null;
        createdAt: string;
        updatedAt: string;
      }> = {
        success: true,
        data: {
          id: job.id,
          eventId: job.event_id,
          mediaId: job.media_id,
          type: job.type,
          status: job.status,
          progress: job.progress,
          totalItems: job.total_items,
          processedItems: job.processed_items,
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
          startedAt: job.started_at?.toISOString() || null,
          lastAttemptAt: job.last_attempt_at?.toISOString() || null,
          nextRetryAt: job.next_retry_at?.toISOString() || null,
          completedAt: job.completed_at?.toISOString() || null,
          errorCode: job.error_code,
          errorMessage: job.error_message,
          workerId: job.worker_id,
          idempotencyKey: job.idempotency_key,
          correlationId: job.correlation_id,
          createdAt: job.created_at.toISOString(),
          updatedAt: job.updated_at.toISOString(),
        },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /internal/jobs/:jobId/retry
 * Allows manual retry of an eligible failed or dead-lettered job.
 */
internalIndexingRouter.post(
  '/jobs/:jobId/retry',
  authenticateInternalOrPhotographer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.params;

      if (!jobId || !UUID_REGEX.test(jobId)) {
        throw new ValidationError(`Invalid jobId UUID format: "${jobId}"`);
      }

      const jobCheck = await query<{ id: string; event_id: string }>(
        `SELECT id, event_id FROM processing_jobs WHERE id = $1`,
        [jobId]
      );

      if (jobCheck.rows.length === 0) {
        throw new NotFoundError(`Processing job "${jobId}" not found`);
      }

      await verifyEventOwnershipIfPhotographer(req, jobCheck.rows[0].event_id);

      const retried = await retryFailedJob(jobId);
      if (!retried) {
        throw new ConflictError(`Job "${jobId}" is not eligible for retry`);
      }

      const response: ApiResponse<typeof retried> = {
        success: true,
        data: retried,
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

export default internalIndexingRouter;
