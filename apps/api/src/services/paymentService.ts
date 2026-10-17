import crypto from 'crypto';
import { query, withTransaction } from '../infrastructure/database.js';
import { log } from '../middleware/logger.js';
import {
  ValidationError,
  PlanNotFoundError,
  ConflictError,
} from '@photography-saas/errors';
import type {
  Plan,
  StorageAddon,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
} from '@photography-saas/types';
import { getPlanById, getStorageAddons, recordBillingAuditLog } from './billingService.js';

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'dev_secret_whsec_phase44_commercial_key_3847';

/**
 * Validates HMAC SHA-256 signature for incoming payment provider webhooks.
 * Prevents arbitrary, spoofed, or tampered webhook payloads.
 */
export function verifyWebhookSignature(
  rawPayload: string | Buffer,
  signatureHeader: string | undefined,
  secret: string = WEBHOOK_SECRET
): boolean {
  if (!signatureHeader || !rawPayload) {
    return false;
  }

  try {
    let timestamp = '';
    let signature = '';

    if (signatureHeader.includes('t=') && signatureHeader.includes('v1=')) {
      const parts = signatureHeader.split(',');
      for (const part of parts) {
        const [k, v] = part.trim().split('=');
        if (k === 't') timestamp = v;
        if (k === 'v1') signature = v;
      }

      const tsNum = parseInt(timestamp, 10);
      if (isNaN(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 600) {
        log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'payment-webhook',
          message: 'Webhook signature timestamp outside tolerance window',
        });
        return false;
      }

      const signedPayload = `${timestamp}.${typeof rawPayload === 'string' ? rawPayload : rawPayload.toString('utf8')}`;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } else {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawPayload)
        .digest('hex');

      if (signatureHeader.length !== expectedSignature.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(signatureHeader, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    }
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'payment-webhook',
      message: `Failed to verify webhook signature: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
}

/**
 * Creates an authoritative checkout session for a plan upgrade or storage add-on purchase.
 * NEVER trusts client-submitted prices! Always looks up price from database.
 */
export async function createCheckoutSession(
  photographerId: number,
  req: CreateCheckoutSessionRequest
): Promise<CreateCheckoutSessionResponse> {
  const sessionId = `cs_${crypto.randomBytes(16).toString('hex')}`;

  if (req.planId) {
    const plan = await getPlanById(req.planId);
    if (!plan) {
      throw new PlanNotFoundError(`Plan "${req.planId}" does not exist`);
    }

    if (!plan.is_active) {
      throw new ConflictError(`Plan "${plan.name}" is no longer active for new subscriptions`);
    }

    const checkoutUrl = `/billing/checkout?session_id=${sessionId}&mode=subscription&plan_id=${encodeURIComponent(plan.id)}`;

    await recordBillingAuditLog(
      photographerId,
      'checkout_session_created',
      `Initiated plan checkout for ${plan.name}`,
      {
        sessionId,
        mode: 'subscription',
        planId: plan.id,
        priceCents: plan.price_cents,
        currency: plan.currency,
      }
    );

    return {
      sessionId,
      checkoutUrl,
      mode: 'subscription',
    };
  } else if (req.addonId) {
    const addons = await getStorageAddons();
    const addon = addons.find((a) => a.id === req.addonId);

    if (!addon) {
      throw new ValidationError(`Storage add-on "${req.addonId}" does not exist`);
    }

    const checkoutUrl = `/billing/checkout?session_id=${sessionId}&mode=addon&addon_id=${encodeURIComponent(addon.id)}`;

    await recordBillingAuditLog(
      photographerId,
      'checkout_session_created',
      `Initiated storage add-on checkout for ${addon.name}`,
      {
        sessionId,
        mode: 'addon',
        addonId: addon.id,
        priceCents: addon.price_cents,
        currency: addon.currency,
      }
    );

    return {
      sessionId,
      checkoutUrl,
      mode: 'addon',
    };
  } else {
    throw new ValidationError('Checkout session requires either planId or addonId');
  }
}

/**
 * Handles incoming payment provider webhook events idempotently.
 * Protects against duplicate deliveries and replay attacks.
 */
export async function processPaymentWebhook(
  idempotencyKey: string,
  eventType: string,
  payload: Record<string, any>
): Promise<{ processed: boolean; duplicate: boolean }> {
  // 1. Webhook Idempotency Guard: check if already processed
  const existing = await query<{ idempotency_key: string }>(
    `SELECT idempotency_key FROM processed_webhook_events WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  if (existing.rows.length > 0) {
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'payment-webhook',
      message: `Duplicate webhook event "${idempotencyKey}" safely ignored`,
      details: { idempotencyKey, eventType },
    });
    return { processed: true, duplicate: true };
  }

  // 2. Process event based on event type
  await withTransaction(async (client) => {
    switch (eventType) {
      case 'checkout.session.completed': {
        const metadata = payload.metadata || payload;
        const photographerId = Number(metadata.photographer_id || metadata.photographerId);
        const planId = metadata.plan_id || metadata.planId;
        const addonId = metadata.addon_id || metadata.addonId;

        if (!photographerId || (!planId && !addonId)) {
          throw new ValidationError('Webhook checkout.session.completed missing required metadata');
        }

        if (planId) {
          const planRes = await client.query<Plan>(
            'SELECT * FROM plans WHERE id = $1',
            [planId]
          );
          if (planRes.rows.length === 0) {
            throw new PlanNotFoundError(`Plan "${planId}" not found`);
          }
          const plan = planRes.rows[0];

          // Update active subscription
          await client.query(
            `UPDATE subscriptions
             SET plan_id = $1,
                 status = 'active',
                 current_period_start = NOW(),
                 current_period_end = NOW() + INTERVAL '30 days',
                 cancel_at_period_end = false,
                 cancelled_at = NULL,
                 grace_period_until = NULL,
                 updated_at = NOW()
             WHERE photographer_id = $2`,
            [plan.id, photographerId]
          );

          // Generate paid invoice
          const invId = crypto.randomUUID();
          await client.query(
            `INSERT INTO invoices (
              id, photographer_id, amount_cents, currency, status,
              description, issued_at, paid_at
            ) VALUES ($1, $2, $3, $4, 'paid', $5, NOW(), NOW())`,
            [
              invId,
              photographerId,
              plan.price_cents,
              plan.currency,
              `Subscription to ${plan.name} Plan`,
            ]
          );
        } else if (addonId) {
          const addonRes = await client.query<StorageAddon>(
            'SELECT * FROM storage_addons WHERE id = $1',
            [addonId]
          );
          if (addonRes.rows.length === 0) {
            throw new ValidationError(`Addon "${addonId}" not found`);
          }
          const addon = addonRes.rows[0];

          // Insert photographer active storage addon
          const psaId = crypto.randomUUID();
          await client.query(
            `INSERT INTO photographer_storage_addons (
              id, photographer_id, addon_id, status,
              current_period_end
            ) VALUES (
              $1, $2, $3, 'active', NOW() + INTERVAL '30 days'
            )`,
            [psaId, photographerId, addon.id]
          );

          // Generate paid invoice
          const invId = crypto.randomUUID();
          await client.query(
            `INSERT INTO invoices (
              id, photographer_id, amount_cents, currency, status,
              description, issued_at, paid_at
            ) VALUES ($1, $2, $3, $4, 'paid', $5, NOW(), NOW())`,
            [
              invId,
              photographerId,
              addon.price_cents,
              addon.currency,
              `Storage Add-on: ${addon.name}`,
            ]
          );
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoiceData = payload.invoice || payload;
        const photographerId = Number(invoiceData.photographer_id || invoiceData.photographerId);

        if (photographerId) {
          await client.query(
            `UPDATE subscriptions
             SET status = 'active',
                 grace_period_until = NULL,
                 updated_at = NOW()
             WHERE photographer_id = $1`,
            [photographerId]
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoiceData = payload.invoice || payload;
        const photographerId = Number(invoiceData.photographer_id || invoiceData.photographerId);

        if (photographerId) {
          // Transition to past_due and grant 7-day grace period
          await client.query(
            `UPDATE subscriptions
             SET status = 'past_due',
                 grace_period_until = NOW() + INTERVAL '7 days',
                 updated_at = NOW()
             WHERE photographer_id = $1`,
            [photographerId]
          );

          // Record unpaid invoice
          const invId = crypto.randomUUID();
          await client.query(
            `INSERT INTO invoices (
              id, photographer_id, amount_cents, currency, status,
              description, issued_at
            ) VALUES ($1, $2, $3, $4, 'open', 'Failed subscription renewal payment', NOW())`,
            [
              invId,
              photographerId,
              invoiceData.amount_cents || 0,
              invoiceData.currency || 'USD',
            ]
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subData = payload.subscription || payload;
        const photographerId = Number(subData.photographer_id || subData.photographerId);

        if (photographerId) {
          // Fallback to Free plan upon subscription cancellation expiry
          await client.query(
            `UPDATE subscriptions
             SET plan_id = 'plan_free',
                 status = 'active',
                 cancel_at_period_end = false,
                 cancelled_at = NULL,
                 grace_period_until = NULL,
                 updated_at = NOW()
             WHERE photographer_id = $1`,
            [photographerId]
          );
        }
        break;
      }

      default:
        log({
          timestamp: new Date().toISOString(),
          level: 'info',
          service: 'payment-webhook',
          message: `Unhandled payment webhook event type: "${eventType}"`,
        });
        break;
    }

    // 3. Mark webhook as processed for idempotency
    await client.query(
      `INSERT INTO processed_webhook_events (idempotency_key, provider, event_type)
       VALUES ($1, 'stripe', $2)`,
      [idempotencyKey, eventType]
    );
  });

  return { processed: true, duplicate: false };
}
