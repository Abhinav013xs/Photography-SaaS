import { Router, type Request, type Response, type NextFunction } from 'express';
import { query } from '../infrastructure/database.js';
import {
  getIndividualMediaDownload,
  createBulkDownloadJob,
  getDownloadJobStatus,
  getDownloadJobArchive,
} from '../services/downloadService.js';
import { bulkDownloadRateLimiter } from '../middleware/rateLimiter.js';
import { NotFoundError, DownloadJobNotFoundError, ValidationError } from '@photography-saas/errors';
import { isValidUuid } from '@photography-saas/types';
import type { ApiResponse } from '@photography-saas/types';

export const downloadsRouter = Router();

/**
 * GET /api/media/download/:mediaId
 * Direct media download route by media ID. Resolves event and checks authorization.
 */
downloadsRouter.get(
  '/media/download/:mediaId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mediaId } = req.params;

      if (!isValidUuid(mediaId)) {
        throw new ValidationError(`Invalid media ID format: "${mediaId}"`);
      }

      const representation = (req.query.type as 'original' | 'preview') || 'original';

      // Look up event_id for this media item
      const mediaRes = await query(`SELECT event_id FROM media WHERE id = $1`, [mediaId]);
      if (mediaRes.rows.length === 0) {
        throw new NotFoundError(`Media item "${mediaId}" not found`);
      }
      const eventId = mediaRes.rows[0].event_id;

      const result = await getIndividualMediaDownload(eventId, mediaId, representation, req);

      // If requested via browser direct link or redirect flag, 302 redirect to presigned R2 URL
      if (req.query.redirect === 'true' || req.headers.accept?.includes('text/html')) {
        res.redirect(302, result.downloadUrl);
        return;
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
 * POST /api/media/download-zip/:eventId
 * Direct bulk ZIP download job trigger by event ID.
 */
downloadsRouter.post(
  '/media/download-zip/:eventId',
  bulkDownloadRateLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { eventId } = req.params;
      const mediaIds = req.body?.mediaIds;
      const result = await createBulkDownloadJob(eventId, mediaIds, req);

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: { requestId: req.requestId },
      };

      res.status(202).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/download-jobs/:jobId
 * Polls status of a download job by job ID.
 */
downloadsRouter.get(
  '/download-jobs/:jobId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.params;

      const jobRes = await query(`SELECT event_id FROM download_jobs WHERE id = $1`, [jobId]);
      if (jobRes.rows.length === 0) {
        throw new DownloadJobNotFoundError(`Download job "${jobId}" not found`);
      }
      const eventId = jobRes.rows[0].event_id;

      const result = await getDownloadJobStatus(eventId, jobId, req);

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
 * GET /api/download-jobs/:jobId/download
 * Retrieves archive download URL or 302 redirects to presigned R2 URL.
 */
downloadsRouter.get(
  '/download-jobs/:jobId/download',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.params;

      const jobRes = await query(`SELECT event_id FROM download_jobs WHERE id = $1`, [jobId]);
      if (jobRes.rows.length === 0) {
        throw new DownloadJobNotFoundError(`Download job "${jobId}" not found`);
      }
      const eventId = jobRes.rows[0].event_id;

      const result = await getDownloadJobArchive(eventId, jobId, req);

      if (req.query.redirect === 'false') {
        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
          meta: { requestId: req.requestId },
        };
        res.status(200).json(response);
        return;
      }

      res.redirect(302, result.downloadUrl);
    } catch (error) {
      next(error);
    }
  }
);
