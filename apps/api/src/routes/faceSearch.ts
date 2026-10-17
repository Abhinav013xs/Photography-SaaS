import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireEventAccess } from '../middleware/eventAccess.js';
import { searchRateLimiter } from '../middleware/searchRateLimiter.js';
import { searchEventPhotosBySelfie } from '../services/faceSearchService.js';
import { InvalidSelfieError } from '@photography-saas/errors';
import type { ApiResponse, FaceSearchResponseDTO } from '@photography-saas/types';

export const faceSearchRouter = Router({ mergeParams: true });

// Apply rate limiting and verified event access guards
faceSearchRouter.use(searchRateLimiter());
faceSearchRouter.use(requireEventAccess());

/**
 * POST /api/events/:eventId/face-search
 * Guest-facing AI face search:
 * Accepts query selfie (base64 or binary), verifies event scope, extracts face embedding,
 * searches authorized event photos, and returns ranked photo references.
 */
faceSearchRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { eventId } = req.params;

      // Extract image buffer from JSON payload (base64) or raw body
      let selfieBuffer: Buffer | null = null;

      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        selfieBuffer = req.body;
      } else if (req.body && typeof req.body === 'object') {
        const rawBase64 =
          req.body.image ||
          req.body.imageBase64 ||
          req.body.selfie ||
          req.body.photo;

        if (typeof rawBase64 === 'string') {
          // Strip data URI prefix if present (e.g., 'data:image/jpeg;base64,...')
          const base64Data = rawBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
          selfieBuffer = Buffer.from(base64Data, 'base64');
        }
      }

      if (!selfieBuffer || selfieBuffer.length === 0) {
        throw new InvalidSelfieError(
          'Missing selfie image data. Please provide base64 image data in request body (e.g. { "image": "data:image/jpeg;base64,..." }).'
        );
      }

      // Parse query options
      const limit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : undefined;
      const offset = req.query.offset !== undefined ? parseInt(String(req.query.offset), 10) : undefined;
      const threshold = req.query.threshold !== undefined ? parseFloat(String(req.query.threshold)) : undefined;

      const result = await searchEventPhotosBySelfie(eventId, selfieBuffer, {
        limit: Number.isNaN(limit) ? undefined : limit,
        offset: Number.isNaN(offset) ? undefined : offset,
        threshold: Number.isNaN(threshold) ? undefined : threshold,
      });

      const page = Math.floor(result.pagination.offset / result.pagination.limit) + 1;

      const response: ApiResponse<FaceSearchResponseDTO> = {
        success: true,
        data: result,
        meta: {
          requestId: req.requestId,
          total: result.pagination.total,
          limit: result.pagination.limit,
          page,
        },
      };


      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

export default faceSearchRouter;
