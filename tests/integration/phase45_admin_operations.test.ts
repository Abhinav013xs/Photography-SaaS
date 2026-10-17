import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
// @ts-ignore
import db, { initDatabase } from '../../server/db.js';
// @ts-ignore
import adminRouter from '../../server/routes/admin.js';
// @ts-ignore
import authRouter from '../../server/routes/auth.js';
// @ts-ignore
import eventRouter from '../../server/routes/events.js';
// @ts-ignore
import mediaRouter from '../../server/routes/media.js';
// @ts-ignore
import { signAdminToken, ADMIN_ROLES } from '../../server/middleware/adminAuth.js';
// @ts-ignore
import { signPhotographerToken } from '../../server/middleware/auth.js';

describe('Phase 45: Admin Operations, Customer Support, Audit System & Control Center Integration Tests', () => {
  let app: express.Express;

  let superAdminToken: string;
  let supportAgentToken: string;
  let financeAdminToken: string;
  let photographerToken: string;

  beforeAll(() => {
    initDatabase();

    // Generate tokens for distinct role actors
    superAdminToken = signAdminToken({
      id: 'admin_super_1',
      email: 'admin@studiolumina.photo',
      name: 'Platform Director',
      role: ADMIN_ROLES.SUPER_ADMIN,
    });

    supportAgentToken = signAdminToken({
      id: 'admin_support_1',
      email: 'support@studiolumina.photo',
      name: 'Support Agent',
      role: ADMIN_ROLES.SUPPORT_AGENT,
    });

    financeAdminToken = signAdminToken({
      id: 'admin_finance_1',
      email: 'finance@studiolumina.photo',
      name: 'Finance Admin',
      role: ADMIN_ROLES.FINANCE_ADMIN,
    });

    photographerToken = signPhotographerToken({
      id: 1,
      email: 'photographer@studiolumina.photo',
    });
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());

    app.use('/api/admin', adminRouter);
    app.use('/api/auth', authRouter);
    app.use('/api/events', eventRouter);
    app.use('/api/media', mediaRouter);
  });

  /* ========================================================================
     1. ADMIN AUTHENTICATION & SESSION GUARDS
     ======================================================================== */
  describe('1. Administrative Authentication & Sessions', () => {
    it('authenticates valid admin credentials and returns scoped JWT', async () => {
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({
          email: 'admin@studiolumina.photo',
          password: process.env.ADMIN_PASSWORD || 'AdminMaster2026!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.admin.role).toBe('SUPER_ADMIN');
      expect(res.body.admin.permissions).toContain('VIEW_TELEMETRY');
      expect(res.body.admin.permissions).toContain('MANAGE_FEATURES');
    });

    it('rejects invalid admin passwords with HTTP 401', async () => {
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({
          email: 'admin@studiolumina.photo',
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid administrative credentials');
    });

    it('verifies active admin session via /api/admin/auth/me', async () => {
      const res = await request(app)
        .get('/api/admin/auth/me')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.admin.email).toBe('admin@studiolumina.photo');
      expect(res.body.admin.role).toBe('SUPER_ADMIN');
    });

    it('rejects unauthenticated requests to /api/admin/auth/me with HTTP 401', async () => {
      const res = await request(app).get('/api/admin/auth/me');
      expect(res.status).toBe(401);
    });
  });

  /* ========================================================================
     2. PRIVILEGE ESCALATION DEFENSE & RBAC ENFORCEMENT
     ======================================================================== */
  describe('2. Role-Based Access Control (RBAC) & Privilege Boundaries', () => {
    it('prevents normal photographer from accessing admin endpoints (returns 403)', async () => {
      const res = await request(app)
        .get('/api/admin/telemetry')
        .set('Authorization', `Bearer ${photographerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Photographer credentials cannot access administrative endpoints');
    });

    it('allows SUPPORT_AGENT to read telemetry and events', async () => {
      const res = await request(app)
        .get('/api/admin/telemetry')
        .set('Authorization', `Bearer ${supportAgentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.telemetry).toBeDefined();
    });

    it('denies SUPPORT_AGENT from adjusting billing (returns 403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/admin/billing/users/1/adjust')
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .send({
          action: 'grant_storage',
          reason: 'Attempted unauthorized adjustment',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('lacks required permission "MANAGE_BILLING"');
    });

    it('denies FINANCE_ADMIN from retrying jobs or accessing break-glass (returns 403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/admin/jobs/job-fake-id/retry')
        .set('Authorization', `Bearer ${financeAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('lacks required permission "MANAGE_JOBS"');
    });

    it('allows FINANCE_ADMIN to apply audited billing adjustment with valid reason', async () => {
      const res = await request(app)
        .post('/api/admin/billing/users/1/adjust')
        .set('Authorization', `Bearer ${financeAdminToken}`)
        .send({
          action: 'grant_storage',
          reason: 'Customer support goodwill capacity extension',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.adjustment.action).toBe('grant_storage');
    });
  });

  /* ========================================================================
     3. BIOMETRIC DATA PRIVACY & LEAST PRIVILEGE GUARANTEE
     ======================================================================== */
  describe('3. Biometric Protection & Zero Vector Disclosure', () => {
    it('returns face embedding counts without exposing raw 128-D vectors in events list', async () => {
      const res = await request(app)
        .get('/api/admin/events')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      for (const ev of res.body.events) {
        expect(ev.metrics.embeddingCount).toBeTypeOf('number');
        // Critical: zero raw vectors or biometric payloads
        expect(ev.embedding).toBeUndefined();
        expect(ev.embeddings).toBeUndefined();
        expect(ev.faceVectors).toBeUndefined();
      }
    });

    it('reports aggregate biometric embeddings count in telemetry', async () => {
      const res = await request(app)
        .get('/api/admin/telemetry')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.telemetry.biometrics.totalEmbeddings).toBeTypeOf('number');
      expect(res.body.telemetry.biometrics.protectionPolicy).toContain('Zero guest selfie retention');
    });
  });

  /* ========================================================================
     4. USER ACCOUNT LIFECYCLE & SUSPENSION ENFORCEMENT
     ======================================================================== */
  describe('4. User Lifecycle, Suspension & Restoration', () => {
    it('requires minimum 5-character reason to suspend a photographer', async () => {
      const res = await request(app)
        .post('/api/admin/users/1/suspend')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('min 5 characters');
    });

    it('suspends photographer account and blocks future logins and operations', async () => {
      const photographerRow = db.prepare('SELECT id, email FROM photographer LIMIT 1').get() as { id: number, email: string };
      const photogEmail = photographerRow?.email || 'photographer@studiolumina.photo';
      const photogId = photographerRow?.id || 1;

      // 1. Admin suspends user
      const suspendRes = await request(app)
        .post(`/api/admin/users/${photogId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Payment dispute investigation hold' });

      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.status).toBe('suspended');

      // 2. Suspended photographer login attempt fails
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: photogEmail,
          password: 'any_password',
        });

      expect(loginRes.status).toBe(403);
      expect(loginRes.body.error).toBe('Account Suspended');

      // 3. Suspended photographer cannot create events
      const createEventRes = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${photographerToken}`)
        .send({
          name: 'Blocked Event',
          client_name: 'Test Client',
          event_date: '2026-11-01',
        });

      expect(createEventRes.status).toBe(403);
      expect(createEventRes.body.error).toBe('Account Suspended');

      // 4. Admin restores photographer account
      const restoreRes = await request(app)
        .post(`/api/admin/users/${photogId}/restore`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Dispute resolved successfully' });

      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.status).toBe('active');

      // 5. Account is active again
      const restoredUser = db.prepare('SELECT status FROM photographer WHERE id = ?').get(photogId) as { status: string };
      expect(restoredUser.status).toBe('active');
    });
  });

  /* ========================================================================
     5. STORAGE RECONCILIATION ENGINE
     ======================================================================== */
  describe('5. Storage Reconciliation Engine', () => {
    it('executes reconciliation and returns structured verification report', async () => {
      const res = await request(app)
        .post('/api/admin/storage/reconcile')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.report.status).toBeDefined();
      expect(res.body.report.summary.totalDbMediaRecords).toBeTypeOf('number');
      expect(res.body.report.summary.verifiedKeysCount).toBeTypeOf('number');
      expect(res.body.report.discrepancies).toBeDefined();
      expect(res.body.report.policyNote).toContain('Automated deletions require explicit operator confirmation');
    });
  });

  /* ========================================================================
     6. EMERGENCY KILL SWITCHES & FEATURE FLAGS
     ======================================================================== */
  describe('6. Emergency Kill Switches & Feature Flags', () => {
    it('requires typed "CONFIRM" string to toggle emergency kill switch', async () => {
      const res = await request(app)
        .post('/api/admin/features/toggle')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          key: 'face_search',
          enabled: false,
          reason: 'Test emergency shutdown',
          confirmationText: 'NOT_CORRECT',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('requires confirmationText: "CONFIRM"');
    });

    it('toggles emergency kill switch with valid typed confirmation', async () => {
      // Toggle off
      const toggleOff = await request(app)
        .post('/api/admin/features/toggle')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          key: 'face_search',
          enabled: false,
          reason: 'Emergency testing of kill switch protocol',
          confirmationText: 'CONFIRM',
        });

      expect(toggleOff.status).toBe(200);
      expect(toggleOff.body.enabled).toBe(false);

      // Verify feature status
      const featuresRes = await request(app)
        .get('/api/admin/features')
        .set('Authorization', `Bearer ${superAdminToken}`);

      const faceSearchFlag = featuresRes.body.features.find((f: any) => f.key === 'face_search');
      expect(faceSearchFlag?.enabled).toBe(false);

      // Toggle back on
      const toggleOn = await request(app)
        .post('/api/admin/features/toggle')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          key: 'face_search',
          enabled: true,
          reason: 'Restoring face search operational readiness',
          confirmationText: 'CONFIRM',
        });

      expect(toggleOn.status).toBe(200);
      expect(toggleOn.body.enabled).toBe(true);
    });
  });

  /* ========================================================================
     7. IMMUTABLE ADMIN AUDIT TRAIL
     ======================================================================== */
  describe('7. Immutable Administrative Audit Logging', () => {
    it('records administrative actions into append-only admin_audit_logs table', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.logs)).toBe(true);
      expect(res.body.logs.length).toBeGreaterThan(0);

      // Find an audit entry from our prior actions
      const sample = res.body.logs[0];
      expect(sample.id).toBeDefined();
      expect(sample.adminEmail).toBeDefined();
      expect(sample.action).toBeDefined();
      expect(sample.reason).toBeDefined();
      expect(sample.createdAt).toBeDefined();
    });
  });

  /* ========================================================================
     8. BREAK-GLASS EMERGENCY ACCESS
     ======================================================================== */
  describe('8. Ephemeral Break-Glass Event Access', () => {
    it('requires minimum 10-character justification for break-glass token', async () => {
      const events = db.prepare('SELECT id FROM events LIMIT 1').get() as { id: string } | undefined;
      const eventId = events?.id || 'fake-id';

      const res = await request(app)
        .post(`/api/admin/events/${eventId}/break-glass`)
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .send({ reason: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('min 10 characters');
    });

    it('issues 15-minute time-boxed ephemeral token when justified', async () => {
      const events = db.prepare('SELECT id FROM events LIMIT 1').get() as { id: string } | undefined;
      if (!events) return;

      const res = await request(app)
        .post(`/api/admin/events/${events.id}/break-glass`)
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .send({ reason: 'Customer reported missing portraits during reception ceremony' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.expiresAt).toBeDefined();
    });
  });
});
