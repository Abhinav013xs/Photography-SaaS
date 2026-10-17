import { Router, type Request, type Response, type NextFunction } from 'express';
import { requirePhotographer } from '../middleware/auth.js';
import {
  getPlans,
  getStorageAddons,
  getPhotographerBillingOverview,
  getPhotographerInvoices,
  cancelSubscription,
} from '../services/billingService.js';
import {
  createCheckoutSession,
  verifyWebhookSignature,
  processPaymentWebhook,
} from '../services/paymentService.js';
import { runStorageReconciliation } from '../services/storageReconciliationService.js';
import {
  ValidationError,
  AuthorizationError,
} from '@photography-saas/errors';
import type { ApiResponse } from '@photography-saas/types';
import { log } from '../middleware/logger.js';

const router = Router();

// =========================================================================
// PUBLIC WEBHOOK ENDPOINT
// =========================================================================

/**
 * POST /api/billing/webhook
 * Receives commercial webhook events from payment provider.
 * Validates HMAC signature and processes events idempotently.
 */
router.post(
  '/webhook',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const signature = (req.headers['x-payment-signature'] ||
        req.headers['stripe-signature']) as string | undefined;

      // Allow payload verification (in test mode without signature if explicitly configured)
      const rawPayload = JSON.stringify(req.body);
      const isSignatureValid = verifyWebhookSignature(rawPayload, signature);

      if (!isSignatureValid && process.env.NODE_ENV === 'production') {
        throw new AuthorizationError('Invalid payment webhook signature');
      }

      const event = req.body;
      const eventId = event.id || `evt_${Date.now()}`;
      const eventType = event.type || event.event_type;

      if (!eventType) {
        throw new ValidationError('Webhook payload missing event type');
      }

      const result = await processPaymentWebhook(
        eventId,
        eventType,
        event.data?.object || event.data || event.payload || event
      );

      res.status(200).json({
        success: true,
        received: true,
        duplicate: result.duplicate,
      });
    } catch (error) {
      next(error);
    }
  }
);

// =========================================================================
// PUBLIC / SEMI-PUBLIC PLANS ENDPOINT
// =========================================================================

/**
 * GET /api/billing/plans
 * Returns all active commercial subscription tiers.
 */
router.get(
  '/plans',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const plans = await getPlans();
      res.json({
        success: true,
        data: plans,
        meta: { requestId: req.requestId || '' },
      });
    } catch (error) {
      next(error);
    }
  }
);

// =========================================================================
// AUTHENTICATED PHOTOGRAPHER ENDPOINTS
// =========================================================================

router.use(requirePhotographer);

/**
 * GET /api/billing/overview
 * Returns unified photographer commercial overview (plan, quota, addons, recent invoices).
 */
router.get(
  '/overview',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const overview = await getPhotographerBillingOverview(req.photographer!.id);
      res.json({
        success: true,
        data: overview,
        meta: { requestId: req.requestId || '' },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/billing/addons
 * Returns available modular storage add-on packages.
 */
router.get(
  '/addons',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const addons = await getStorageAddons();
      res.json({
        success: true,
        data: addons,
        meta: { requestId: req.requestId || '' },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/billing/checkout
 * Generates an authoritative checkout session for plan upgrade or storage expansion.
 */
router.post(
  '/checkout',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const session = await createCheckoutSession(req.photographer!.id, req.body);
      res.status(200).json({
        success: true,
        data: session,
        meta: { requestId: req.requestId || '' },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/billing/cancel
 * Cancels the current photographer subscription (at period end by default).
 */
router.post(
  '/cancel',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const immediately = Boolean(req.body?.immediately);
      const sub = await cancelSubscription(req.photographer!.id, immediately);
      res.json({
        success: true,
        data: sub,
        meta: { requestId: req.requestId || '' },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/billing/invoices
 * Returns invoice billing history for the photographer.
 */
router.get(
  '/invoices',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const invoices = await getPhotographerInvoices(req.photographer!.id);
      res.json({
        success: true,
        data: invoices,
        meta: { requestId: req.requestId || '' },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/billing/reconcile-storage
 * Runs authoritative storage reconciliation sweep and updates cached counts.
 */
router.post(
  '/reconcile-storage',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const report = await runStorageReconciliation({ repair: true });
      res.json({
        success: true,
        data: report,
        meta: { requestId: req.requestId || '' },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
