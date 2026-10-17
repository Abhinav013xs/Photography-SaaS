import { randomUUID } from 'crypto';
import { query } from '../infrastructure/database.js';
import { log } from '../middleware/logger.js';
import {
  StorageQuotaExceededError,
  PlanNotFoundError,
} from '@photography-saas/errors';
import type {
  Plan,
  Subscription,
  StorageAddon,
  PhotographerStorageAddon,
  Invoice,
  StorageQuotaStatus,
  SubscriptionOverviewDTO,
} from '@photography-saas/types';
import { getStorageUsageSummary } from './storageService.js';

/**
 * Retrieves all currently active commercial subscription plans.
 */
export async function getPlans(): Promise<Plan[]> {
  const res = await query<Plan>(
    `SELECT 
      id, name, description, price_cents, annual_price_cents, currency,
      billing_interval, storage_limit_bytes, event_limit, face_search_limit,
      video_enabled, custom_branding_enabled, features, is_active,
      created_at, updated_at
    FROM plans
    WHERE is_active = true
    ORDER BY price_cents ASC`
  );
  return res.rows;
}

/**
 * Retrieves a single plan by unique ID.
 */
export async function getPlanById(planId: string): Promise<Plan | null> {
  const res = await query<Plan>(
    `SELECT 
      id, name, description, price_cents, annual_price_cents, currency,
      billing_interval, storage_limit_bytes, event_limit, face_search_limit,
      video_enabled, custom_branding_enabled, features, is_active,
      created_at, updated_at
    FROM plans
    WHERE id = $1`,
    [planId]
  );
  return res.rows[0] ?? null;
}

/**
 * Retrieves available modular storage add-on packages.
 */
export async function getStorageAddons(): Promise<StorageAddon[]> {
  const res = await query<StorageAddon>(
    `SELECT 
      id, name, capacity_bytes, price_cents, currency, is_active, created_at
    FROM storage_addons
    WHERE is_active = true
    ORDER BY capacity_bytes ASC`
  );
  return res.rows;
}

/**
 * Retrieves the current subscription for a photographer.
 * If no subscription exists, provisions an active default subscription.
 */
export async function getPhotographerSubscription(photographerId: number): Promise<Subscription> {
  const res = await query<Subscription>(
    `SELECT 
      id, photographer_id, plan_id, status, billing_cycle, provider,
      provider_customer_id, provider_subscription_id,
      current_period_start, current_period_end, cancel_at_period_end,
      cancelled_at, grace_period_until, created_at, updated_at
    FROM subscriptions
    WHERE photographer_id = $1
    ORDER BY (
      CASE status 
        WHEN 'active' THEN 1 
        WHEN 'trialing' THEN 2 
        WHEN 'past_due' THEN 3 
        WHEN 'paused' THEN 4 
        ELSE 5 
      END
    ) ASC, created_at DESC
    LIMIT 1`,
    [photographerId]
  );

  if (res.rows.length > 0) {
    return res.rows[0];
  }

  // Provision default active subscription
  const subId = randomUUID();
  const defaultSubRes = await query<Subscription>(
    `INSERT INTO subscriptions (
      id, photographer_id, plan_id, status, billing_cycle, provider,
      current_period_start, current_period_end, cancel_at_period_end
    ) VALUES (
      $1, $2, 'plan_pro', 'active', 'month', 'system_default',
      NOW(), NOW() + INTERVAL '365 days', false
    )
    RETURNING 
      id, photographer_id, plan_id, status, billing_cycle, provider,
      provider_customer_id, provider_subscription_id,
      current_period_start, current_period_end, cancel_at_period_end,
      cancelled_at, grace_period_until, created_at, updated_at`,
    [subId, photographerId]
  );

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'billing',
    message: `Provisioned default subscription for photographer ${photographerId}`,
    details: { photographerId, subscriptionId: defaultSubRes.rows[0].id },
  });

  return defaultSubRes.rows[0];
}

/**
 * Retrieves active storage add-ons for a photographer.
 */
export async function getPhotographerActiveAddons(
  photographerId: number
): Promise<PhotographerStorageAddon[]> {
  const res = await query<PhotographerStorageAddon>(
    `SELECT 
      psa.id, psa.photographer_id, psa.addon_id, psa.status,
      psa.provider_subscription_id, psa.current_period_end, psa.created_at,
      sa.name, sa.capacity_bytes, sa.price_cents
    FROM photographer_storage_addons psa
    JOIN storage_addons sa ON sa.id = psa.addon_id
    WHERE psa.photographer_id = $1 AND psa.status = 'active'`,
    [photographerId]
  );

  return res.rows;
}

/**
 * Calculates authoritative photographer storage quota status.
 * Plan storage limit + Add-on expansion - Measured byte consumption.
 */
export async function getPhotographerEffectiveQuota(
  photographerId: number
): Promise<StorageQuotaStatus> {
  const subscription = await getPhotographerSubscription(photographerId);
  const plan = await getPlanById(subscription.plan_id);

  if (!plan) {
    throw new PlanNotFoundError(`Assigned plan "${subscription.plan_id}" not found`);
  }

  // Calculate active add-on storage expansion
  const addons = await getPhotographerActiveAddons(photographerId);
  const addonStorageBytes = addons.reduce(
    (acc, curr) => acc + Number(curr.capacity_bytes || 0),
    0
  );

  const planStorageLimitBytes = Number(plan.storage_limit_bytes);
  const totalStorageLimitBytes = planStorageLimitBytes + addonStorageBytes;

  // Retrieve authoritative current byte consumption across all events
  const usageSummary = await getStorageUsageSummary(photographerId);
  const usedBytes = usageSummary.totalBytes;

  const remainingBytes = Math.max(0, totalStorageLimitBytes - usedBytes);
  const percentageUsed =
    totalStorageLimitBytes > 0
      ? Number(((usedBytes / totalStorageLimitBytes) * 100).toFixed(2))
      : 100;

  const isOverQuota = usedBytes > totalStorageLimitBytes;

  // Active events count
  const eventsCountRes = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM events 
     WHERE owner_id = $1 AND status != 'trashed' AND status != 'deleting'`,
    [photographerId]
  );
  const activeEventsCount = Number(eventsCountRes.rows[0]?.count || 0);

  // Upload gate rules
  let canUpload = !isOverQuota;
  if (['cancelled', 'expired'].includes(subscription.status)) {
    canUpload = false;
  } else if (subscription.status === 'past_due' && subscription.grace_period_until) {
    if (new Date() > new Date(subscription.grace_period_until)) {
      canUpload = false;
    }
  }

  let warningLevel: 'normal' | 'warning' | 'critical' | 'exceeded' = 'normal';
  if (percentageUsed >= 100) {
    warningLevel = 'exceeded';
  } else if (percentageUsed >= 95) {
    warningLevel = 'critical';
  } else if (percentageUsed >= 85) {
    warningLevel = 'warning';
  }

  return {
    usedBytes,
    planStorageLimitBytes,
    addonStorageBytes,
    totalStorageLimitBytes,
    remainingBytes,
    percentageUsed,
    isOverQuota,
    warningLevel,
    activeEventsCount,
    eventLimit: plan.event_limit,
    canUpload,
  };
}

/**
 * Authoritative Server-Side Quota Enforcement Gate.
 * Must be executed prior to generating any presigned upload URLs.
 */
export async function assertCanUpload(
  photographerId: number,
  incomingBatchBytes: number
): Promise<StorageQuotaStatus> {
  const quota = await getPhotographerEffectiveQuota(photographerId);

  if (!quota.canUpload) {
    throw new StorageQuotaExceededError(
      `Uploads are currently blocked because your storage limit of ${(quota.totalStorageLimitBytes / (1024 * 1024 * 1024)).toFixed(2)} GB has been reached or your subscription is past due. Please upgrade your plan or add storage add-ons.`,
      {
        totalLimitBytes: quota.totalStorageLimitBytes,
        usedBytes: quota.usedBytes,
        isOverQuota: quota.isOverQuota,
        warningLevel: quota.warningLevel,
      }
    );
  }

  if (quota.usedBytes + incomingBatchBytes > quota.totalStorageLimitBytes) {
    const requestedMb = (incomingBatchBytes / (1024 * 1024)).toFixed(1);
    const availableMb = (quota.remainingBytes / (1024 * 1024)).toFixed(1);
    throw new StorageQuotaExceededError(
      `Upload batch (${requestedMb} MB) exceeds your remaining available storage (${availableMb} MB). Please upgrade your subscription tier or add storage add-ons to proceed.`,
      {
        totalLimitBytes: quota.totalStorageLimitBytes,
        usedBytes: quota.usedBytes,
        remainingBytes: quota.remainingBytes,
        incomingBatchBytes,
      }
    );
  }

  return quota;
}

/**
 * Retrieves invoices for a photographer.
 */
export async function getPhotographerInvoices(photographerId: number): Promise<Invoice[]> {
  const res = await query<Invoice>(
    `SELECT 
      id, photographer_id, subscription_id, provider_invoice_id,
      amount_cents, currency, status, description, invoice_pdf_url,
      issued_at, paid_at, created_at
    FROM invoices
    WHERE photographer_id = $1
    ORDER BY issued_at DESC`,
    [photographerId]
  );
  return res.rows;
}

/**
 * Records a durable billing audit event.
 */
export async function recordBillingAuditLog(
  photographerId: number,
  eventType: string,
  description?: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const eventId = randomUUID();
  await query(
    `INSERT INTO billing_events (
      id, photographer_id, event_type, description, metadata
    ) VALUES ($1, $2, $3, $4, $5)`,
    [eventId, photographerId, eventType, description ?? null, JSON.stringify(metadata)]
  );

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'billing-audit',
    message: `[Billing Event] ${eventType} for photographer ${photographerId}`,
    details: { photographerId, eventType, metadata },
  });
}

/**
 * Retrieves complete unified commercial overview for the authenticated photographer.
 */
export async function getPhotographerBillingOverview(
  photographerId: number
): Promise<SubscriptionOverviewDTO> {
  const subscription = await getPhotographerSubscription(photographerId);
  const plan = await getPlanById(subscription.plan_id);

  if (!plan) {
    throw new PlanNotFoundError(`Assigned plan "${subscription.plan_id}" not found`);
  }

  const quota = await getPhotographerEffectiveQuota(photographerId);
  const addons = await getPhotographerActiveAddons(photographerId);
  const invoices = await getPhotographerInvoices(photographerId);

  return {
    plan,
    subscription,
    addons,
    quota,
    invoices,
  };
}

/**
 * Initiates cancellation of subscription.
 * Defaults to cancel_at_period_end = true to preserve paid period access.
 */
export async function cancelSubscription(
  photographerId: number,
  immediately = false
): Promise<Subscription> {
  const currentSub = await getPhotographerSubscription(photographerId);

  let updatedSub: Subscription;

  if (immediately) {
    const res = await query<Subscription>(
      `UPDATE subscriptions
       SET status = 'cancelled',
           cancel_at_period_end = true,
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND photographer_id = $2
       RETURNING *`,
      [currentSub.id, photographerId]
    );
    updatedSub = res.rows[0];
  } else {
    const res = await query<Subscription>(
      `UPDATE subscriptions
       SET cancel_at_period_end = true,
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND photographer_id = $2
       RETURNING *`,
      [currentSub.id, photographerId]
    );
    updatedSub = res.rows[0];
  }

  await recordBillingAuditLog(
    photographerId,
    'subscription_cancelled',
    immediately ? 'Immediate subscription cancellation' : 'Cancellation scheduled for period end',
    {
      subscriptionId: updatedSub.id,
      immediately,
      effectiveAt: immediately ? new Date().toISOString() : updatedSub.current_period_end,
    }
  );

  return updatedSub;
}
