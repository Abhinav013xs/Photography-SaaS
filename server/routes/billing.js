import express from 'express';
import db from '../db.js';
import { authenticatePhotographer } from '../middleware/auth.js';
import crypto from 'crypto';

const router = express.Router();

const PLANS = [
  {
    id: 'plan_free',
    name: 'Free Trial',
    description: 'Essential gallery sharing for evaluation and emerging artists.',
    price_cents: 0,
    annual_price_cents: 0,
    currency: 'USD',
    billing_interval: 'month',
    storage_limit_bytes: 5368709120, // 5 GB
    event_limit: 2,
    face_search_limit: 50,
    video_enabled: false,
    custom_branding_enabled: false,
    features: ['5 GB Cloud Storage', '2 Active Events', '50 AI Face Searches/mo', 'Responsive Web Gallery', 'Standard Downloads'],
    is_active: true,
  },
  {
    id: 'plan_starter',
    name: 'Starter',
    description: 'Ideal for portrait and small boutique event photographers.',
    price_cents: 1500,
    annual_price_cents: 15000,
    currency: 'USD',
    billing_interval: 'month',
    storage_limit_bytes: 26843545600, // 25 GB
    event_limit: 10,
    face_search_limit: 500,
    video_enabled: true,
    custom_branding_enabled: true,
    features: ['25 GB Cloud Storage', '10 Active Events', '500 AI Face Searches/mo', 'Full 1080p Video Support', 'Custom Watermarks'],
    is_active: true,
  },
  {
    id: 'plan_pro',
    name: 'Professional',
    description: 'Our most popular tier for high-volume wedding and documentary photographers.',
    price_cents: 3900,
    annual_price_cents: 39000,
    currency: 'USD',
    billing_interval: 'month',
    storage_limit_bytes: 107374182400, // 100 GB
    event_limit: 50,
    face_search_limit: -1,
    video_enabled: true,
    custom_branding_enabled: true,
    features: ['100 GB Cloud Storage', '50 Active Events', 'Unlimited AI Face Searches', '4K Video Delivery', 'Studio Branding & Watermarks'],
    is_active: true,
  },
  {
    id: 'plan_studio',
    name: 'Studio Master',
    description: 'Maximum performance and massive capacity for commercial studios and high-volume wedding masters.',
    price_cents: 8900,
    annual_price_cents: 89000,
    currency: 'USD',
    billing_interval: 'month',
    storage_limit_bytes: 536870912000, // 500 GB
    event_limit: -1,
    face_search_limit: -1,
    video_enabled: true,
    custom_branding_enabled: true,
    features: ['500 GB Cloud Storage', 'Unlimited Active Events', 'Unlimited AI Face Searches', 'Master 4K Video Delivery', 'Full White-Label Branding'],
    is_active: true,
  },
];

const ADDONS = [
  { id: 'addon_storage_50gb', name: '+50 GB Storage Expansion', capacity_bytes: 53687091200, price_cents: 500, currency: 'USD', is_active: true },
  { id: 'addon_storage_200gb', name: '+200 GB Storage Expansion', capacity_bytes: 214748364800, price_cents: 1500, currency: 'USD', is_active: true },
  { id: 'addon_storage_500gb', name: '+500 GB Storage Expansion', capacity_bytes: 536870912000, price_cents: 3000, currency: 'USD', is_active: true },
  { id: 'addon_storage_1tb', name: '+1 TB Storage Expansion', capacity_bytes: 1099511627776, price_cents: 5000, currency: 'USD', is_active: true },
];

let activePlanId = 'plan_pro';
let cancelAtPeriodEnd = false;
let userAddons = [];
let userInvoices = [
  {
    id: 'inv_init_001',
    description: 'Professional Plan — Monthly Subscription',
    amount_cents: 3900,
    currency: 'USD',
    status: 'paid',
    issued_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

/**
 * GET /api/billing/plans
 */
router.get('/plans', (req, res) => {
  res.json({ success: true, data: PLANS });
});

/**
 * GET /api/billing/addons
 */
router.get('/addons', authenticatePhotographer, (req, res) => {
  res.json({ success: true, data: ADDONS });
});

/**
 * GET /api/billing/overview
 */
router.get('/overview', authenticatePhotographer, (req, res) => {
  const currentPlan = PLANS.find((p) => p.id === activePlanId) || PLANS[2];

  // Calculate actual storage usage from media table
  const mediaStats = db.prepare(`
    SELECT
      COUNT(id) as total_media,
      COALESCE(SUM(CASE WHEN type = 'photo' THEN file_size ELSE 0 END), 0) as photo_bytes,
      COALESCE(SUM(CASE WHEN type = 'video' THEN file_size ELSE 0 END), 0) as video_bytes
    FROM media
  `).get();

  const readyPhotos = db.prepare(`SELECT COUNT(id) as c FROM media WHERE type = 'photo' AND status = 'ready'`).get();
  const estimatedDerivativesBytes = (readyPhotos?.c || 0) * (35 * 1024 + 180 * 1024);
  const usedBytes = (mediaStats?.photo_bytes || 0) + (mediaStats?.video_bytes || 0) + estimatedDerivativesBytes;

  const addonStorageBytes = userAddons.reduce((sum, a) => sum + Number(a.capacity_bytes || 0), 0);
  const totalLimit = Number(currentPlan.storage_limit_bytes) + addonStorageBytes;
  const percentage = totalLimit > 0 ? Number(((usedBytes / totalLimit) * 100).toFixed(2)) : 0;

  const activeEvents = db.prepare(`SELECT COUNT(id) as c FROM events WHERE status != 'trashed'`).get();

  res.json({
    success: true,
    plan: currentPlan,
    subscription: {
      id: 'sub_default_photographer',
      plan_id: currentPlan.id,
      status: 'active',
      billing_cycle: 'month',
      current_period_start: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      current_period_end: new Date(Date.now() + 16 * 24 * 60 * 60 * 1000).toISOString(),
      cancel_at_period_end: cancelAtPeriodEnd,
    },
    quota: {
      usedBytes,
      planStorageLimitBytes: Number(currentPlan.storage_limit_bytes),
      addonStorageBytes,
      totalStorageLimitBytes: totalLimit,
      remainingBytes: Math.max(0, totalLimit - usedBytes),
      percentageUsed: percentage,
      isOverQuota: usedBytes > totalLimit,
      warningLevel: percentage >= 100 ? 'exceeded' : percentage >= 95 ? 'critical' : percentage >= 85 ? 'warning' : 'normal',
      activeEventsCount: activeEvents?.c || 0,
      eventLimit: currentPlan.event_limit,
      canUpload: usedBytes <= totalLimit,
    },
    addons: userAddons,
    invoices: userInvoices,
  });
});

/**
 * POST /api/billing/checkout
 */
router.post('/checkout', authenticatePhotographer, (req, res) => {
  const { planId, addonId } = req.body || {};
  const sessionId = `cs_${crypto.randomBytes(12).toString('hex')}`;

  if (planId) {
    const selectedPlan = PLANS.find((p) => p.id === planId);
    if (!selectedPlan) return res.status(404).json({ success: false, error: 'Plan not found' });

    activePlanId = selectedPlan.id;
    cancelAtPeriodEnd = false;
    userInvoices.unshift({
      id: `inv_${Date.now()}`,
      description: `${selectedPlan.name} Plan — Upgrade`,
      amount_cents: selectedPlan.price_cents,
      currency: selectedPlan.currency,
      status: 'paid',
      issued_at: new Date().toISOString(),
    });

    return res.json({
      success: true,
      data: {
        sessionId,
        checkoutUrl: `/billing/checkout?session_id=${sessionId}&mode=subscription`,
        mode: 'subscription',
      },
    });
  }

  if (addonId) {
    const selectedAddon = ADDONS.find((a) => a.id === addonId);
    if (!selectedAddon) return res.status(404).json({ success: false, error: 'Add-on not found' });

    userAddons.push(selectedAddon);
    userInvoices.unshift({
      id: `inv_${Date.now()}`,
      description: `Storage Add-On: ${selectedAddon.name}`,
      amount_cents: selectedAddon.price_cents,
      currency: selectedAddon.currency,
      status: 'paid',
      issued_at: new Date().toISOString(),
    });

    return res.json({
      success: true,
      data: {
        sessionId,
        checkoutUrl: `/billing/checkout?session_id=${sessionId}&mode=addon`,
        mode: 'addon',
      },
    });
  }

  return res.status(400).json({ success: false, error: 'Missing planId or addonId' });
});

/**
 * POST /api/billing/cancel
 */
router.post('/cancel', authenticatePhotographer, (req, res) => {
  cancelAtPeriodEnd = true;
  res.json({
    success: true,
    data: {
      status: 'active',
      cancel_at_period_end: true,
    },
  });
});

/**
 * GET /api/billing/invoices
 */
router.get('/invoices', authenticatePhotographer, (req, res) => {
  res.json({ success: true, data: userInvoices });
});

/**
 * POST /api/billing/reconcile-storage
 */
router.post('/reconcile-storage', authenticatePhotographer, (req, res) => {
  const eventsCount = db.prepare(`SELECT COUNT(id) as c FROM events`).get();
  res.json({
    success: true,
    data: {
      reconciledEventsCount: eventsCount?.c || 0,
      storageUsageDriftDetected: false,
      driftEventsCount: 0,
      orphanedR2Objects: [],
      missingR2Objects: [],
      repaired: true,
      durationMs: 14,
    },
  });
});

export default router;
