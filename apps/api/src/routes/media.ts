import { Router, type Request, type Response, type NextFunction } from 'express';
import { requirePhotographer } from '../middleware/auth.js';
import { validateOrigin } from '../middleware/csrf.js';
import { uploadPresignRateLimiter } from '../middleware/rateLimiter.js';
import {
  validateBody,
  validateQuery,
  validateParams,
} from '../middleware/validate.js';
import {
  eventParamsSchema,
  presignBatchBodySchema,
  confirmBatchBodySchema,
  listMediaQuerySchema,
  processMediaParamsSchema,
  processBatchBodySchema,
} from './mediaSchemas.js';
import {
  moveMediaParamsSchema,
  moveMediaBodySchema,
  batchMoveMediaBodySchema,
} from './foldersSchemas.js';
import {
  presignUploadBatch,
  confirmUploadBatch,
  listEventMedia,
  verifyEventOwnership,
} from '../services/mediaUploadService.js';
import {
  moveMediaToFolder,
  batchMoveMedia,
} from '../services/folderService.js';
import { query } from '../infrastructure/database.js';
import {
  processPhoto,
  processPhotoBatch,
} from '../services/imageProcessingService.js';
import { processVideo } from '../services/videoProcessingService.js';
import {
  getPhotoFaceDetections,
  indexPhotoFaces,
} from '../services/faceIndexingService.js';
import {
  getMediaFaceDetections,
  detectAndRecordFaces,
} from '../services/faceDetectionService.js';
import type { ApiResponse } from '@photography-saas/types';

export const mediaRouter = Router({ mergeParams: true });

// All media operations require authenticated photographer
mediaRouter.use(requirePhotographer);

/**
 * POST /api/events/:eventId/media/presign-batch
 * Authorizes and generates short-lived presigned PUT URLs for direct browser-to-R2 photo upload.
 */
mediaRouter.post(
  '/presign-batch',
  validateOrigin,
  uploadPresignRateLimiter,
  validateParams(eventParamsSchema),
  validateBody(presignBatchBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId } = req.params;

      const result = await presignUploadBatch(ownerId, eventId, req.body);

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
 * POST /api/events/:eventId/media/confirm-upload
 * Verifies uploaded binaries exist in Cloudflare R2 and persists original media metadata in PostgreSQL.
 * Idempotent: safe against retries.
 */
mediaRouter.post(
  '/confirm-upload',
  validateOrigin,
  validateParams(eventParamsSchema),
  validateBody(confirmBatchBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId } = req.params;

      const result = await confirmUploadBatch(ownerId, eventId, req.body);

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
 * GET /api/events/:eventId/media
 * Lists media assets for an event with folder, status, and pagination filters.
 */
mediaRouter.get(
  '/',
  validateParams(eventParamsSchema),
  validateQuery(listMediaQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId } = req.params;

      const { media, total, page, limit } = await listEventMedia(
        ownerId,
        eventId,
        req.query as any
      );

      const response: ApiResponse<{ media: typeof media }> = {
        success: true,
        data: { media },
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
 * PATCH /api/events/:eventId/media/:mediaId/folder
 * Moves a single media item to a target folder or to the event root (null).
 */
mediaRouter.patch(
  '/:mediaId/folder',
  validateOrigin,
  validateParams(moveMediaParamsSchema),
  validateBody(moveMediaBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, mediaId } = req.params;
      const targetFolderId =
        req.body.folderId !== undefined ? req.body.folderId : req.body.folder_id ?? null;

      const media = await moveMediaToFolder(ownerId, eventId, mediaId, targetFolderId);

      const response: ApiResponse<{ media: typeof media }> = {
        success: true,
        data: { media },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/events/:eventId/media/move-batch
 * Moves a batch of media items to a target folder or to the event root (null).
 */
mediaRouter.post(
  '/move-batch',
  validateOrigin,
  validateParams(eventParamsSchema),
  validateBody(batchMoveMediaBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId } = req.params;
      const mediaIds: string[] = req.body.mediaIds ?? req.body.media_ids;
      const targetFolderId =
        req.body.targetFolderId !== undefined
          ? req.body.targetFolderId
          : req.body.target_folder_id ?? null;

      const result = await batchMoveMedia(ownerId, eventId, mediaIds, targetFolderId);

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
 * POST /api/events/:eventId/media/:mediaId/process
 * Triggers or retries background derivative generation for a single photo or video.
 */
mediaRouter.post(
  '/:mediaId/process',
  validateOrigin,
  validateParams(processMediaParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, mediaId } = req.params;

      await verifyEventOwnership(ownerId, eventId);

      // Check media type from database
      const checkRes = await query<{ type: string }>(
        'SELECT type FROM media WHERE id = $1 AND event_id = $2',
        [mediaId, eventId]
      );

      let result;
      if (checkRes.rows.length > 0 && checkRes.rows[0].type === 'video') {
        result = await processVideo(mediaId, eventId);
      } else {
        result = await processPhoto(mediaId, eventId);
      }

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
 * POST /api/events/:eventId/media/:mediaId/process-video
 * Explicitly triggers or retries video probing, poster extraction, and transcoding.
 */
mediaRouter.post(
  '/:mediaId/process-video',
  validateOrigin,
  validateParams(processMediaParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, mediaId } = req.params;

      await verifyEventOwnership(ownerId, eventId);

      const result = await processVideo(mediaId, eventId);

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
 * POST /api/events/:eventId/media/process-batch
 * Retries or triggers image processing for a batch of photos in an event.
 */
mediaRouter.post(
  '/process-batch',
  validateOrigin,
  validateParams(eventParamsSchema),
  validateBody(processBatchBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId } = req.params;
      const { mediaIds } = req.body;

      await verifyEventOwnership(ownerId, eventId);

      const result = await processPhotoBatch(mediaIds, eventId);

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
 * GET /api/events/:eventId/media/:mediaId/faces
 * Retrieves detected faces and bounding boxes for a photo.
 * Raw 128-D embedding vectors are never exposed to the client.
 */
mediaRouter.get(
  '/:mediaId/faces',
  validateParams(processMediaParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, mediaId } = req.params;

      await verifyEventOwnership(ownerId, eventId);

      const detections = await getMediaFaceDetections(mediaId, eventId);
      const fallbackDetections = detections.length === 0
        ? await getPhotoFaceDetections(mediaId, eventId)
        : detections;

      const response: ApiResponse<typeof fallbackDetections> = {
        success: true,
        data: fallbackDetections,
        meta: { requestId: req.requestId, total: fallbackDetections.length },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/events/:eventId/media/:mediaId/detect-faces
 * Triggers manual face detection for a photo using OpenCV YuNet.
 */
mediaRouter.post(
  '/:mediaId/detect-faces',
  validateOrigin,
  validateParams(processMediaParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, mediaId } = req.params;

      await verifyEventOwnership(ownerId, eventId);

      const result = await detectAndRecordFaces(mediaId, eventId);

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
 * POST /api/events/:eventId/media/:mediaId/index-faces
 * Triggers manual facial indexing for a photo using OpenCV YuNet + SFace.
 */
mediaRouter.post(
  '/:mediaId/index-faces',
  validateOrigin,
  validateParams(processMediaParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, mediaId } = req.params;

      await verifyEventOwnership(ownerId, eventId);

      const result = await indexPhotoFaces(mediaId, eventId);

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

export default mediaRouter;


