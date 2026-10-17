import { Router, type Request, type Response, type NextFunction } from 'express';
import { requirePhotographer } from '../middleware/auth.js';
import { validateOrigin } from '../middleware/csrf.js';
import {
  validateBody,
  validateParams,
} from '../middleware/validate.js';
import {
  createFolderSchema,
  updateFolderSchema,
  eventParamsSchema,
  eventFolderParamsSchema,
} from './foldersSchemas.js';
import {
  createFolder,
  listFolders,
  getFolderById,
  updateFolder,
  deleteFolder,
} from '../services/folderService.js';
import type { ApiResponse } from '@photography-saas/types';

export const foldersRouter = Router({ mergeParams: true });

// All folder operations require authenticated single photographer
foldersRouter.use(requirePhotographer);

/**
 * GET /api/events/:eventId/folders
 * Lists all ceremony folders for the specified event with real media counts.
 */
foldersRouter.get(
  '/',
  validateParams(eventParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId } = req.params;

      const result = await listFolders(ownerId, eventId);

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: {
          requestId: req.requestId,
          total: result.folders.length,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/events/:eventId/folders
 * Creates a new ceremony folder within an event container.
 */
foldersRouter.post(
  '/',
  validateOrigin,
  validateParams(eventParamsSchema),
  validateBody(createFolderSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId } = req.params;

      const folder = await createFolder(ownerId, eventId, req.body);

      const response: ApiResponse<{ folder: typeof folder }> = {
        success: true,
        data: { folder },
        meta: { requestId: req.requestId },
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/events/:eventId/folders/:folderId
 * Retrieves metadata and media count for a specific folder.
 */
foldersRouter.get(
  '/:folderId',
  validateParams(eventFolderParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, folderId } = req.params;

      const folder = await getFolderById(ownerId, eventId, folderId);

      const response: ApiResponse<{ folder: typeof folder }> = {
        success: true,
        data: { folder },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/events/:eventId/folders/:folderId
 * Renames or updates the sort order of a folder.
 */
foldersRouter.patch(
  '/:folderId',
  validateOrigin,
  validateParams(eventFolderParamsSchema),
  validateBody(updateFolderSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, folderId } = req.params;

      const folder = await updateFolder(ownerId, eventId, folderId, req.body);

      const response: ApiResponse<{ folder: typeof folder }> = {
        success: true,
        data: { folder },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/events/:eventId/folders/:folderId
 * Idempotent alias for updating a folder.
 */
foldersRouter.put(
  '/:folderId',
  validateOrigin,
  validateParams(eventFolderParamsSchema),
  validateBody(updateFolderSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, folderId } = req.params;

      const folder = await updateFolder(ownerId, eventId, folderId, req.body);

      const response: ApiResponse<{ folder: typeof folder }> = {
        success: true,
        data: { folder },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/events/:eventId/folders/:folderId
 * Safely deletes a folder inside a transaction without destroying media.
 * Reassigns all media to event root (folder_id = NULL).
 */
foldersRouter.delete(
  '/:folderId',
  validateOrigin,
  validateParams(eventFolderParamsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = req.auth!.id;
      const { eventId, folderId } = req.params;

      const result = await deleteFolder(ownerId, eventId, folderId);

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

export { mediaRouter } from './media.js';

