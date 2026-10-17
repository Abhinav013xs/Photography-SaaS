import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import {
  getGuestEventBySlug,
  verifyGuestPin,
  getGuestGalleryMedia,
} from '../services/guestService.js';
import {
  getClientIp,
  pinRateLimiterMiddleware,
} from '../middleware/pinRateLimiter.js';
import {
  revokeGuestSession,
  GUEST_COOKIE_NAME_PREFIX,
  GUEST_SESSION_TTL_HOURS,
} from '../services/guestSessionService.js';
import { verifyEventAccess } from '../middleware/eventAccess.js';
import {
  getIndividualMediaDownload,
  createBulkDownloadJob,
  getDownloadJobStatus,
  getDownloadJobArchive,
} from '../services/downloadService.js';
import { searchRateLimiter } from '../middleware/searchRateLimiter.js';
import {
  publicGalleryRateLimiter,
  bulkDownloadRateLimiter,
} from '../middleware/rateLimiter.js';
import { searchEventPhotosBySelfie } from '../services/faceSearchService.js';
import { InvalidSelfieError, FaceSearchDisabledError } from '@photography-saas/errors';
import { getConfig } from '@photography-saas/config';
import type { ApiResponse, FaceSearchResponseDTO } from '@photography-saas/types';

export const guestRouter = Router();

const verifyPinSchema = z.object({
  pin: z.string().trim().min(1, 'PIN code is required'),
});

/**
 * GET /api/guest/event/:slug
 * Resolves safe public metadata for an event.
 */
guestRouter.get(
  '/event/:slug',
  publicGalleryRateLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = req.params.slug;
      const event = await getGuestEventBySlug(slug);

      // Public event metadata cache: safe public short-lived cache (60s)
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

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
 * POST /api/guest/verify-pin/:slug
 * Verifies guest event PIN with brute-force rate limiting and issues temporary session.
 */
guestRouter.post(
  '/verify-pin/:slug',
  validateBody(verifyPinSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = req.params.slug;
      const clientIp = getClientIp(req);
      const result = await verifyGuestPin(slug, req.body.pin, clientIp);

      const config = getConfig();
      const isProduction = config.nodeEnv === 'production';

      // Set HttpOnly, Secure session cookie bound to this event
      res.cookie(`${GUEST_COOKIE_NAME_PREFIX}${result.eventId}`, result.guestToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: GUEST_SESSION_TTL_HOURS * 3600 * 1000,
        path: '/',
      });

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
 * GET /api/guest/gallery/:slug
 * Retrieves folders and photos for an event (enforcing server-side PIN authorization).
 */
guestRouter.get(
  '/gallery/:slug',
  publicGalleryRateLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = req.params.slug;
      const eventMeta = await getGuestEventBySlug(slug);

      // Verify event access (enforces PIN session if pin_enabled)
      await verifyEventAccess(req, eventMeta.id);

      const folderId = req.query.folderId as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const cursor = req.query.cursor as string | undefined;

      const galleryData = await getGuestGalleryMedia(eventMeta.id, folderId, {
        page: isNaN(page as any) ? undefined : page,
        limit: isNaN(limit as any) ? undefined : limit,
        cursor,
      });

      // Private cache header to prevent CDN caching of event-specific content
      res.setHeader('Cache-Control', 'private, no-cache');

      const response: ApiResponse<typeof galleryData> = {
        success: true,
        data: galleryData,
        meta: {
          requestId: req.requestId,
          total: galleryData.totalCount,
          page: galleryData.page,
          limit: galleryData.limit,
          hasMore: galleryData.hasMore,
          nextCursor: galleryData.nextCursor,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/guest/session/clear/:eventId
 * Explicitly clears the guest session cookie and revokes the session in PostgreSQL.
 */
guestRouter.post(
  '/session/clear/:eventId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const eventId = req.params.eventId;
      const cookieName = `${GUEST_COOKIE_NAME_PREFIX}${eventId}`;
      const token = req.cookies?.[cookieName] || (req.headers['x-guest-token'] as string);

      if (token) {
        await revokeGuestSession(token);
      }

      res.clearCookie(cookieName, { path: '/' });

      const response: ApiResponse<{ message: string }> = {
        success: true,
        data: { message: 'Guest session cleared successfully' },
        meta: { requestId: req.requestId },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Phase 21: Photo & Video Download System Routes
// ---------------------------------------------------------------------------

const bulkDownloadBodySchema = z.object({
  mediaIds: z.array(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid media ID')).max(500, 'Maximum 500 items per bulk download').optional(),
});

/**
 * GET /api/guest/gallery/:slug/download/:mediaId
 * Authorized individual photo/video download.
 * Issues short-lived presigned GET URL with safe Content-Disposition.
 */
guestRouter.get(
  '/gallery/:slug/download/:mediaId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { slug, mediaId } = req.params;
      const representation = (req.query.type as 'original' | 'preview') || 'original';
      const result = await getIndividualMediaDownload(slug, mediaId, representation, req);

      if (req.query.redirect === 'true') {
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
 * POST /api/guest/gallery/:slug/download-zip
 * Initiates asynchronous bulk ZIP generation for selected media or entire gallery.
 */
guestRouter.post(
  '/gallery/:slug/download-zip',
  bulkDownloadRateLimiter,
  validateBody(bulkDownloadBodySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { slug } = req.params;
      const mediaIds = req.body?.mediaIds;
      const result = await createBulkDownloadJob(slug, mediaIds, req);

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
 * GET /api/guest/gallery/:slug/download-jobs/:jobId
 * Polls status of an asynchronous bulk ZIP download job.
 */
guestRouter.get(
  '/gallery/:slug/download-jobs/:jobId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { slug, jobId } = req.params;
      const result = await getDownloadJobStatus(slug, jobId, req);

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
 * GET /api/guest/gallery/:slug/download-jobs/:jobId/download
 * Retrieves completed bulk archive download URL or 302 redirects.
 */
guestRouter.get(
  '/gallery/:slug/download-jobs/:jobId/download',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { slug, jobId } = req.params;
      const result = await getDownloadJobArchive(slug, jobId, req);

      if (req.query.redirect === 'false') {
        const response: ApiResponse<typeof result> = {
          success: true,
          data: result,
          meta: { requestId: req.requestId },
        };
        res.status(200).json(response);
        return;
      }

      // Default: 302 redirect directly to signed R2 export archive
      res.redirect(302, result.downloadUrl);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/guest/face-search/:slug (and /guest/face-search/:slug)
 * AI Face Search ("Find My Photos") by event slug.
 * Scoped strictly to the event. Enforces rate limiting and PIN access guards.
 */
guestRouter.post(
  '/face-search/:slug',
  searchRateLimiter(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { slug } = req.params;
      const eventMeta = await getGuestEventBySlug(slug);

      // Verify event access (enforces PIN session if protected, allows public guest face search if PIN disabled)
      await verifyEventAccess(req, eventMeta.id, { allowPublicFaceSearch: true });

      // Check if face search is enabled for this event
      if (!eventMeta.face_search_enabled) {
        throw new FaceSearchDisabledError('AI face search is not enabled for this gallery.');
      }

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
          const base64Data = rawBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
          selfieBuffer = Buffer.from(base64Data, 'base64');
        }
      }

      if (!selfieBuffer || selfieBuffer.length === 0) {
        throw new InvalidSelfieError(
          'Missing selfie image data. Please provide base64 image data in request body (e.g. { "image": "data:image/jpeg;base64,..." }).'
        );
      }

      const limit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : undefined;
      const offset = req.query.offset !== undefined ? parseInt(String(req.query.offset), 10) : undefined;
      const threshold = req.query.threshold !== undefined ? parseFloat(String(req.query.threshold)) : undefined;

      const result = await searchEventPhotosBySelfie(eventMeta.id, selfieBuffer, {
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


