import { Router, type Request, type Response, type NextFunction } from 'express';
import { requirePhotographer } from '../middleware/auth.js';
import { validateOrigin } from '../middleware/csrf.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
  eventIdParamSchema,
  deleteEventBodySchema,
  publishEventBodySchema,
  updateVisibilitySchema,
  emptyBinBodySchema,
} from './eventsSchemas.js';
import {
  createEvent,
  getEventById,
  listEvents,
  updateEvent,
  publishEvent,
  unpublishEvent,
  updateEventVisibility,
  archiveEvent,
  restoreEvent,
  deleteEvent,
  getEventDeletionStatus,
  trashEvent,
  restoreEventFromBin,
  listBinEvents,
  emptyBin,
  reprocessEventWatermarks,
  getEventWatermarkStatus,
  getEventQrSharing,
} from '../services/eventService.js';
import { foldersRouter } from './folders.js';
import { mediaRouter } from './media.js';
import { reprocessRateLimiter } from '../middleware/rateLimiter.js';
import type {
  ApiResponse,
  EventQrShareDTO,
  TrashedEventListItem,
  EmptyBinResultDTO,
} from '@photography-saas/types';

const router = Router();

// All event operations require authenticated single photographer
router.use(requirePhotographer);

/**
 * GET /api/events/trash and GET /api/events/bin
 * Lists all events currently in the Recycle Bin for the authenticated photographer.
 */
const getBinHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ownerId = req.auth!.id;
    const binEvents = await listBinEvents(ownerId);

    const response: ApiResponse<{ events: TrashedEventListItem[] }> = {
      success: true,
      data: { events: binEvents },
      meta: { requestId: req.requestId, total: binEvents.length },
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

router.get('/trash', getBinHandler);
router.get('/bin', getBinHandler);

/**
 * POST /api/events/trash/empty and POST /api/events/bin/empty
 * Permanently purges all trashed events belonging to the authenticated photographer.
 */
const emptyBinHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ownerId = req.auth!.id;
    const result = await emptyBin(ownerId);

    const response: ApiResponse<EmptyBinResultDTO> = {
      success: true,
      data: result,
      meta: { requestId: req.requestId },
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

router.post('/trash/empty', validateOrigin, validateBody(emptyBinBodySchema), emptyBinHandler);
router.post('/bin/empty', validateOrigin, validateBody(emptyBinBodySchema), emptyBinHandler);

/**
 * DELETE /api/events/trash and DELETE /api/events/bin
 * Alias for emptying the Recycle Bin.
 */
router.delete('/trash', validateOrigin, validateBody(emptyBinBodySchema), emptyBinHandler);
router.delete('/bin', validateOrigin, validateBody(emptyBinBodySchema), emptyBinHandler);

// Mount Phase 7 Folders and Media Movement domains
router.use('/:eventId/folders', foldersRouter);
router.use('/:eventId/media', mediaRouter);

/**
 * GET /api/events
 * Lists events for the authenticated photographer with filters and pagination.
 */
router.get(
  '/',
  validateQuery(listEventsQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { events, total, page, limit } = await listEvents(ownerId, req.query as any);

      const response: ApiResponse<{ events: typeof events }> = {
        success: true,
        data: { events },
        meta: {
          requestId: req.requestId,
          total,
          page,
          limit,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/events
 * Creates a new event container with explicit safe defaults.
 */
router.post(
  '/',
  validateOrigin,
  validateBody(createEventSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const event = await createEvent(ownerId, req.body);

      const response: ApiResponse<{ event: typeof event }> = {
        success: true,
        data: { event },
        meta: { requestId: req.requestId },
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/events/:id
 * Retrieves event details, strictly enforcing owner authorization (IDOR protection).
 */
router.get(
  '/:id',
  validateParams(eventIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const event = await getEventById(req.params.id, ownerId);

      const response: ApiResponse<{ event: typeof event }> = {
        success: true,
        data: { event },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/events/:id
 * Partially updates event metadata, preserving untouched configuration.
 */
router.patch(
  '/:id',
  validateOrigin,
  validateParams(eventIdParamSchema),
  validateBody(updateEventSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const event = await updateEvent(req.params.id, ownerId, req.body);

      const response: ApiResponse<{ event: typeof event }> = {
        success: true,
        data: { event },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/:id',
  validateOrigin,
  validateParams(eventIdParamSchema),
  validateBody(updateEventSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const event = await updateEvent(req.params.id, ownerId, req.body);

      const response: ApiResponse<{ event: typeof event }> = {
        success: true,
        data: { event },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/events/:id/publish
 * Deliberately transitions an event to public visibility.
 */
router.post(
  '/:id/publish',
  validateOrigin,
  validateParams(eventIdParamSchema),
  validateBody(publishEventBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { public_start, public_until, public_duration_days } = req.body;
      const event = await publishEvent(
        req.params.id,
        ownerId,
        public_start,
        public_until,
        public_duration_days
      );

      const response: ApiResponse<{ event: typeof event }> = {
        success: true,
        data: { event },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/events/:id/unpublish
 * Reverts an event to private visibility.
 */
router.post(
  '/:id/unpublish',
  validateOrigin,
  validateParams(eventIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const event = await unpublishEvent(req.params.id, ownerId);

      const response: ApiResponse<{ event: typeof event }> = {
        success: true,
        data: { event },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/events/:id/visibility
 * Explicitly updates event visibility ('public' or 'private').
 */
router.patch(
  '/:id/visibility',
  validateOrigin,
  validateParams(eventIdParamSchema),
  validateBody(updateVisibilitySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { visibility, public_duration_days } = req.body;
      const event = await updateEventVisibility(
        req.params.id,
        ownerId,
        visibility,
        public_duration_days
      );

      const response: ApiResponse<{ event: typeof event }> = {
        success: true,
        data: { event },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/events/:id/archive
 * Transitions an event to archived lifecycle state.
 */
router.post(
  '/:id/archive',
  validateOrigin,
  validateParams(eventIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const event = await archiveEvent(req.params.id, ownerId);

      const response: ApiResponse<{ event: typeof event }> = {
        success: true,
        data: { event },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/events/:id/restore
 * Restores an archived or trashed event back to active status.
 */
router.post(
  '/:id/restore',
  validateOrigin,
  validateParams(eventIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const event = await restoreEvent(req.params.id, ownerId);

      const response: ApiResponse<{
        event: typeof event;
        restored: boolean;
        id: string;
        name: string;
        status: string;
      }> = {
        success: true,
        data: {
          event,
          restored: true,
          id: event.id,
          name: event.name,
          status: event.status,
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
 * POST /api/events/:id/trash
 * Moves an active or archived event to the Recycle Bin (Soft Delete).
 */
router.post(
  '/:id/trash',
  validateOrigin,
  validateParams(eventIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const result = await trashEvent(req.params.id, ownerId);

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/events/:id/permanent
 * Permanently deletes an event record from the Recycle Bin with explicit confirmation.
 */
router.delete(
  '/:id/permanent',
  validateOrigin,
  validateParams(eventIdParamSchema),
  validateBody(deleteEventBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const confirmName = req.body?.confirmEventName || req.body?.confirmName;
      const result = await deleteEvent(req.params.id, ownerId, confirmName);

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/events/:id
 * Deletes an event:
 * - If permanent=true or confirmEventName provided: permanently purges event.
 * - Otherwise: moves event to Recycle Bin (Soft Delete).
 */
router.delete(
  '/:id',
  validateOrigin,
  validateParams(eventIdParamSchema),
  validateBody(deleteEventBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const isTrash = req.query.trash === 'true' || req.body?.trash === true;
      const confirmName = req.body?.confirmEventName || req.body?.confirmName;

      if (isTrash) {
        // Move to Recycle Bin (Soft Delete)
        const result = await trashEvent(req.params.id, ownerId);
        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
          meta: { requestId: req.requestId },
        };
        res.status(200).json(response);
      } else {
        // Permanent deletion requested (requires typed confirmation matching)
        const result = await deleteEvent(req.params.id, ownerId, confirmName);
        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
          meta: { requestId: req.requestId },
        };
        res.status(200).json(response);
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/events/:id/deletion-status
 * Inspects real-time deletion job progress.
 */
router.get(
  '/:id/deletion-status',
  validateParams(eventIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const status = await getEventDeletionStatus(req.params.id, ownerId);

      const response: ApiResponse<typeof status> = {
        success: true,
        data: status,
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/events/:id/watermark/reprocess
 * Triggers background reprocessing of all photos in an event to apply current watermark configuration.
 */
router.post(
  '/:id/watermark/reprocess',
  reprocessRateLimiter,
  validateOrigin,
  validateParams(eventIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const result = await reprocessEventWatermarks(req.params.id, ownerId);

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/events/:id/watermark/status
 * Retrieves watermark synchronization and reprocessing status for an event.
 */
router.get(
  '/:id/watermark/status',
  validateParams(eventIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const status = await getEventWatermarkStatus(req.params.id, ownerId);

      const response: ApiResponse<typeof status> = {
        success: true,
        data: status,
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/events/:id/qr
 * Retrieves canonical guest URL, high-resolution PNG data URL, and SVG vector for QR sharing.
 */
router.get(
  '/:id/qr',
  validateParams(eventIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const qrShare = await getEventQrSharing(req.params.id, ownerId);

      const response: ApiResponse<EventQrShareDTO> = {
        success: true,
        data: qrShare,
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
