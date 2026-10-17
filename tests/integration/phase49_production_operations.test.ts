import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../server/index.js';
import db from '../../server/db.js';
import { exportDatabaseBackup, restoreDatabaseFromBackup } from '../../server/services/db_backup_service.js';
import { runConsistencyAudit } from '../../server/services/consistency_checker.js';

describe('Phase 49: Production Deployment, Monitoring, Backup & Operational Hardening', () => {
  beforeAll(() => {
    // Ensure test environment is clean and feature flags table is initialized
    db.exec(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        key TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        description TEXT,
        updated_by TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.prepare(`
      INSERT OR REPLACE INTO feature_flags (key, enabled, description)
      VALUES ('maintenance_mode', 0, 'Platform Maintenance Mode Gate')
    `).run();
  });

  // =========================================================================
  // 1. Production Health & Readiness Probes
  // =========================================================================
  describe('1. Health & Readiness Observability Probes', () => {
    it('GET /api/health returns healthy liveness probe with request ID', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.live).toBe(true);
      expect(res.body.requestId).toBeDefined();
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('GET /api/ready verifies database connection, storage mode, and queue telemetry', async () => {
      const res = await request(app).get('/api/ready');
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
      expect(res.body.database).toBe('connected');
      expect(['cloud_r2', 'local_fallback']).toContain(res.body.storage);
      expect(res.body.queue).toBeDefined();
      expect(res.body.queue.activeConcurrency).toBeGreaterThanOrEqual(2);
      expect(res.body.queue.queueDepth).toBeGreaterThanOrEqual(0);
    });

    it('GET /api/queue/metrics provides real-time worker queue depth and telemetry', async () => {
      const res = await request(app).get('/api/queue/metrics');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.metrics).toBeDefined();
      expect(res.body.metrics.activeConcurrency).toBeGreaterThanOrEqual(2);
      expect(res.body.metrics.queueDepth).toBeGreaterThanOrEqual(0);
      expect(res.body.metrics.totalProcessed).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // 2. Request ID Tracing & Security Headers
  // =========================================================================
  describe('2. Request Tracing & Security Headers', () => {
    it('echoes incoming X-Request-Id header across responses for distributed tracing', async () => {
      const traceId = 'req-trace-prod-987654';
      const res = await request(app)
        .get('/api/health')
        .set('x-request-id', traceId);

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(traceId);
      expect(res.body.requestId).toBe(traceId);
    });

    it('enforces helmet security headers to prevent clickjacking and MIME sniffing', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('masks internal stack traces in production error handler', async () => {
      const res = await request(app).get('/api/non-existent-probe-route-test');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.code).toBe('ROUTE_NOT_FOUND');
      expect(res.body.stack).toBeUndefined(); // Stack trace must NEVER be leaked
    });
  });

  // =========================================================================
  // 3. Platform Maintenance Mode & Admin Bypass Gate
  // =========================================================================
  describe('3. Platform Maintenance Mode & Administrative Bypass', () => {
    it('restricts normal guest and public API access when maintenance mode is active', async () => {
      // Activate maintenance mode
      db.prepare("UPDATE feature_flags SET enabled = 1 WHERE key = 'maintenance_mode'").run();

      const res = await request(app).get('/api/events');
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Platform Maintenance in Progress');
      expect(res.body.retryAfter).toBe(300);

      // Verify health probe is NOT blocked during maintenance
      const healthRes = await request(app).get('/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.status).toBe('healthy');

      // Verify admin endpoints are NOT blocked so operators can troubleshoot
      const adminRes = await request(app).get('/api/admin/auth/me');
      // Admin route requires admin auth token (returns 401), but NOT 503 maintenance mode
      expect(adminRes.status).toBe(401);

      // Deactivate maintenance mode
      db.prepare("UPDATE feature_flags SET enabled = 0 WHERE key = 'maintenance_mode'").run();

      const restoredRes = await request(app).get('/api/events');
      // Should now pass through to normal auth/route handler (not 503)
      expect(restoredRes.status).not.toBe(503);
    });
  });

  // =========================================================================
  // 4. Database Backup, Checksum & Restore Integrity Drill
  // =========================================================================
  describe('4. Database Backup & Restore Integrity Drill', () => {
    it('exports a verified database snapshot with SHA-256 hash and relational datasets', () => {
      const backup = exportDatabaseBackup();
      expect(backup.version).toBe('1.0.0');
      expect(backup.sha256).toBeDefined();
      expect(backup.sha256.length).toBe(64);
      expect(backup.recordCounts).toBeDefined();
      expect(backup.recordCounts.events).toBeGreaterThanOrEqual(0);
      expect(backup.recordCounts.feature_flags).toBeGreaterThanOrEqual(1);

      // Biometric Privacy Rule: Guest selfies and ephemeral guest sessions must NEVER be in backup
      expect(backup.data.guest_sessions).toBeUndefined();
      expect(backup.data.temporary_selfies).toBeUndefined();
    });

    it('rejects restoration if backup SHA-256 checksum is corrupted', () => {
      const backup = exportDatabaseBackup();
      const corruptedBackup = {
        ...backup,
        sha256: '0000000000000000000000000000000000000000000000000000000000000000', // Tampered hash
      };

      expect(() => {
        restoreDatabaseFromBackup(corruptedBackup);
      }).toThrow(/checksum mismatch/i);
    });

    it('restores all relational tables atomically with zero orphan records', () => {
      // 1. Take clean snapshot
      const baselineBackup = exportDatabaseBackup();

      // 2. Perform restore drill
      const report = restoreDatabaseFromBackup(baselineBackup);
      expect(report.success).toBe(true);
      expect(report.integrityCheck.status).toBe('VERIFIED');
      expect(report.integrityCheck.orphanMedia).toBe(0);
      expect(report.integrityCheck.orphanFaces).toBe(0);
      expect(report.durationMs).toBeLessThan(1000); // Must be sub-second
    });
  });

  // =========================================================================
  // 5. Storage Consistency Reconciliation Audit
  // =========================================================================
  describe('5. Storage Consistency Audit Execution', () => {
    it('executes storage consistency check comparing database records to storage adapter', async () => {
      const report = await runConsistencyAudit();
      expect(report.timestamp).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.summary.totalMediaRecordsAudited).toBeGreaterThanOrEqual(0);
      expect(typeof report.summary.missingObjectCount).toBe('number');
      expect(typeof report.summary.orphanedObjectCount).toBe('number');
      expect(Array.isArray(report.missingInStorage)).toBe(true);
      expect(Array.isArray(report.orphanedInStorage)).toBe(true);
    });
  });

  // =========================================================================
  // 6. Secret Isolation & Zero Biometric Retention
  // =========================================================================
  describe('6. Secret Masking & Biometric Privacy', () => {
    it('never leaks photographer password hashes or PIN hashes in event queries or public endpoints', async () => {
      // Check database schema serialization directly
      const event = db.prepare('SELECT slug FROM events LIMIT 1').get() as { slug?: string } | undefined;
      if (event && event.slug) {
        const res = await request(app).get(`/api/guest/gallery/${event.slug}`);
        if (res.status === 200 && res.body.event) {
          expect(res.body.event.pin_hash).toBeUndefined();
          expect(res.body.event.password_hash).toBeUndefined();
        }
      }

      // Check photographer table isolation
      const photog = db.prepare('SELECT * FROM photographer LIMIT 1').get() as any;
      if (photog) {
        expect(photog.password_hash).toBeDefined(); // Exists in DB
        // But auth/login endpoint returns sanitized profile without password_hash
        const loginRes = await request(app).post('/api/auth/login').send({
          email: photog.email,
          password: 'incorrect-test-pass',
        });
        expect(loginRes.body.password_hash).toBeUndefined();
      }
    });

    it('confirms ephemeral scratch directories are clean of guest selfies', () => {
      // Verify no leaked raw selfie images persist in filesystem
      const fs = require('fs');
      const path = require('path');
      const tempDir = path.resolve(process.cwd(), 'temp');
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        const selfieFiles = files.filter((f: string) => f.includes('selfie') || f.includes('guest_raw'));
        expect(selfieFiles.length).toBe(0);
      }
    });
  });
});
