import { Router, type Request, type Response, type NextFunction } from 'express';
import { requirePhotographer } from '../middleware/auth.js';
import { getStorageUsageSummary } from '../services/storageService.js';
import type { ApiResponse, StorageUsageSummary } from '@photography-saas/types';

const router = Router();

// Storage usage is strictly restricted to the authenticated photographer
router.use(requirePhotographer);

/**
 * GET /api/storage/usage
 * Returns measured application-tracked storage usage and Cloudflare management status.
 */
router.get(
  '/usage',
  async (req: Request, res: Response<ApiResponse<StorageUsageSummary>>, next: NextFunction) => {
    try {
      const summary = await getStorageUsageSummary(req.photographer!.id);
      res.json({
        success: true,
        data: summary,
        meta: {
          requestId: req.requestId || '',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/storage
 * Alias for /api/storage/usage
 */
router.get(
  '/',
  async (req: Request, res: Response<ApiResponse<StorageUsageSummary>>, next: NextFunction) => {
    try {
      const summary = await getStorageUsageSummary(req.photographer!.id);
      res.json({
        success: true,
        data: summary,
        meta: {
          requestId: req.requestId || '',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
