import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { IMemoryDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestEvent,
  insertTestFolder,
} from '../helpers/db_test_helper.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import {
  getPhotographerEffectiveQuota,
  assertCanUpload,
} from '../../apps/api/src/services/billingService.js';
import { processPaymentWebhook } from '../../apps/api/src/services/paymentService.js';

describe('Phase 44: SaaS Commercial Engine — Billing, Storage Quotas & Lifecycle', () => {
  let db: IMemoryDb;
  let pool: any;
  const app = createApp();

  const TEST_PASSWORD = 'CommercialSaaSPassword2026!';
  let authCookie: string;
  const PHOTOGRAPHER_ID = 1;
  const EVENT_ID = 'e1000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    db = createTestDatabase();

    // Insert sole owner photographer
    db.public.none(
      `INSERT INTO photographer (id, email, password_hash, business_name, tagline)
       VALUES (${PHOTOGRAPHER_ID}, 'owner@studiolumina.photo', '${passwordHash}', 'Studio Lumina', 'Commercial SaaS');`
    );

    // Insert active test event
    insertTestEvent(db, {
      id: EVENT_ID,
      owner_id: PHOTOGRAPHER_ID,
      slug: 'commercial-gala-2026',
      name: 'Commercial Launch Gala',
    });

    pool = db.adapters.createPg().Pool;
    setDatabasePool(new pool());

    // Authenticate photographer
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'owner@studiolumina.photo',
        password: TEST_PASSWORD,
      });

    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers['set-cookie'];
    authCookie = Array.isArray(cookies)
      ? cookies.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`))!
      : cookies;
  });

  afterAll(async () => {
    setDatabasePool(null);
  });

  describe('1. Database-Driven Subscription Plans', () => {
    it('returns all active commercial subscription tiers', async () => {
      const res = await request(app)
        .get('/api/billing/plans')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(4);

      const planIds = res.body.data.map((p: any) => p.id);
      expect(planIds).toContain('plan_free');
      expect(planIds).toContain('plan_starter');
      expect(planIds).toContain('plan_pro');
      expect(planIds).toContain('plan_studio');

      const proPlan = res.body.data.find((p: any) => p.id === 'plan_pro');
      expect(proPlan.price_cents).toBe(3900);
      expect(proPlan.currency).toBe('USD');
      expect(Number(proPlan.storage_limit_bytes)).toBe(107374182400); // 100 GB
      expect(proPlan.video_enabled).toBe(true);
    });

    it('returns modular storage add-ons catalog', async () => {
      const res = await request(app)
        .get('/api/billing/addons')
        .set('Cookie', authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(4);

      const addonIds = res.body.data.map((a: any) => a.id);
      expect(addonIds).toContain('addon_storage_50gb');
      expect(addonIds).toContain('addon_storage_200gb');
      expect(addonIds).toContain('addon_storage_500gb');
      expect(addonIds).toContain('addon_storage_1tb');
    });
  });

  describe('2. Authoritative Photographer Commercial Overview & Storage Quotas', () => {
    it('returns unified commercial overview including plan, active subscription, and quota', async () => {
      const res = await request(app)
        .get('/api/billing/overview')
        .set('Cookie', authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.plan).toBeDefined();
      expect(res.body.data.subscription).toBeDefined();
      expect(res.body.data.quota).toBeDefined();
      expect(res.body.data.quota.canUpload).toBe(true);
      expect(res.body.data.quota.isOverQuota).toBe(false);
      expect(res.body.data.quota.warningLevel).toBe('normal');
    });

    it('blocks uploads with 403 STORAGE_QUOTA_EXCEEDED when photographer quota is exceeded', async () => {
      // Simulate account on a Free plan with 5 GB storage limit (5368709120 bytes)
      await db.public.none(
        `UPDATE subscriptions SET plan_id = 'plan_free' WHERE photographer_id = ${PHOTOGRAPHER_ID}`
      );

      // Seed media records consuming 5.1 GB (over 5 GB limit)
      const fakeMediaId = '00000000-0000-0000-0000-000000000088';
      await db.public.none(
        `INSERT INTO media (
          id, event_id, storage_key_original, filename, original_name, type, mime_type, file_size, status
        ) VALUES (
          '${fakeMediaId}', '${EVENT_ID}', 'events/${EVENT_ID}/originals/${fakeMediaId}.jpg', '${fakeMediaId}.jpg', 'heavy_shoot.jpg', 'photo', 'image/jpeg', 5500000000, 'ready'
        );`
      );

      // Attempt upload via presign batch
      const res = await request(app)
        .post(`/api/events/${EVENT_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .send({
          items: [
            {
              filename: 'new_photo.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 5000000,
            },
          ],
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');

      // Cleanup fake media
      await db.public.none(`DELETE FROM media WHERE id = '${fakeMediaId}'`);
      await db.public.none(
        `UPDATE subscriptions SET plan_id = 'plan_pro' WHERE photographer_id = ${PHOTOGRAPHER_ID}`
      );
    });

    it('rejects an upload batch whose size would push photographer over quota', async () => {
      // Set photographer to Free plan (5 GB limit = 5,368,709,120 bytes)
      await db.public.none(
        `UPDATE subscriptions SET plan_id = 'plan_free' WHERE photographer_id = ${PHOTOGRAPHER_ID}`
      );

      // Attempt to upload a single batch exceeding remaining capacity
      const res = await request(app)
        .post(`/api/events/${EVENT_ID}/media/presign-batch`)
        .set('Cookie', authCookie)
        .send({
          items: [
            {
              filename: 'huge_asset.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 6000000000, // 6 GB > 5 GB limit
            },
          ],
        });

      // The validation or quota gate rejects before generating R2 signed URLs
      expect([400, 413, 403]).toContain(res.status);

      // Restore Pro plan
      await db.public.none(
        `UPDATE subscriptions SET plan_id = 'plan_pro' WHERE photographer_id = ${PHOTOGRAPHER_ID}`
      );
    });
  });

  describe('3. Checkout Session Generation & Server-Side Price Protection', () => {
    it('creates an authoritative checkout session for plan upgrade', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Cookie', authCookie)
        .send({
          planId: 'plan_studio',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.sessionId).toMatch(/^cs_/);
      expect(res.body.data.mode).toBe('subscription');
      expect(res.body.data.checkoutUrl).toContain('plan_id=plan_studio');
    });

    it('creates an authoritative checkout session for modular storage expansion', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Cookie', authCookie)
        .send({
          addonId: 'addon_storage_200gb',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.sessionId).toMatch(/^cs_/);
      expect(res.body.data.mode).toBe('addon');
      expect(res.body.data.checkoutUrl).toContain('addon_id=addon_storage_200gb');
    });

    it('rejects checkout request without planId or addonId', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set('Cookie', authCookie)
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('4. Payment Webhook Processing & Idempotency', () => {
    it('processes checkout.session.completed event and upgrades subscription', async () => {
      const idempotencyKey = `evt_test_checkout_${Date.now()}`;

      const res = await processPaymentWebhook(idempotencyKey, 'checkout.session.completed', {
        photographer_id: PHOTOGRAPHER_ID,
        plan_id: 'plan_studio',
      });

      expect(res.processed).toBe(true);
      expect(res.duplicate).toBe(false);

      // Verify subscription upgraded in DB
      const subRes = await request(app)
        .get('/api/billing/overview')
        .set('Cookie', authCookie)
        .expect(200);

      expect(subRes.body.data.subscription.plan_id).toBe('plan_studio');
      expect(subRes.body.data.plan.name).toBe('Studio Master');

      // Verify invoice generated
      const invoicesRes = await request(app)
        .get('/api/billing/invoices')
        .set('Cookie', authCookie)
        .expect(200);

      expect(invoicesRes.body.data.length).toBeGreaterThanOrEqual(1);
      expect(invoicesRes.body.data[0].status).toBe('paid');
    });

    it('safely ignores duplicate webhook delivery using idempotency key', async () => {
      const duplicateKey = 'evt_duplicate_idempotency_12345';

      // First delivery
      const first = await processPaymentWebhook(duplicateKey, 'invoice.payment_succeeded', {
        photographer_id: PHOTOGRAPHER_ID,
      });
      expect(first.processed).toBe(true);
      expect(first.duplicate).toBe(false);

      // Duplicate delivery
      const second = await processPaymentWebhook(duplicateKey, 'invoice.payment_succeeded', {
        photographer_id: PHOTOGRAPHER_ID,
      });
      expect(second.processed).toBe(true);
      expect(second.duplicate).toBe(true);
    });

    it('handles invoice.payment_failed by setting past_due with 7-day grace period', async () => {
      const failedKey = `evt_failed_${Date.now()}`;

      await processPaymentWebhook(failedKey, 'invoice.payment_failed', {
        photographer_id: PHOTOGRAPHER_ID,
        amount_cents: 8900,
        currency: 'USD',
      });

      const overviewRes = await request(app)
        .get('/api/billing/overview')
        .set('Cookie', authCookie)
        .expect(200);

      expect(overviewRes.body.data.subscription.status).toBe('past_due');
      expect(overviewRes.body.data.subscription.grace_period_until).toBeDefined();
    });
  });

  describe('5. Subscription Cancellation & Downgrade Behavior', () => {
    it('schedules cancellation at period end preserving active access', async () => {
      const res = await request(app)
        .post('/api/billing/cancel')
        .set('Cookie', authCookie)
        .send({ immediately: false })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.cancel_at_period_end).toBe(true);

      const overviewRes = await request(app)
        .get('/api/billing/overview')
        .set('Cookie', authCookie)
        .expect(200);

      expect(overviewRes.body.data.subscription.cancel_at_period_end).toBe(true);
    });

    it('handles customer.subscription.deleted by downgrading to plan_free', async () => {
      const deleteKey = `evt_del_sub_${Date.now()}`;

      await processPaymentWebhook(deleteKey, 'customer.subscription.deleted', {
        photographer_id: PHOTOGRAPHER_ID,
      });

      const overviewRes = await request(app)
        .get('/api/billing/overview')
        .set('Cookie', authCookie)
        .expect(200);

      expect(overviewRes.body.data.subscription.plan_id).toBe('plan_free');
      expect(overviewRes.body.data.subscription.status).toBe('active');
    });
  });

  describe('6. Storage Reconciliation Sweep', () => {
    it('executes storage reconciliation and returns structured audit report', async () => {
      const res = await request(app)
        .post('/api/billing/reconcile-storage')
        .set('Cookie', authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.reconciledEventsCount).toBeGreaterThanOrEqual(1);
      expect(res.body.data.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.body.data.orphanedR2Objects)).toBe(true);
      expect(Array.isArray(res.body.data.missingR2Objects)).toBe(true);
    });
  });
});
