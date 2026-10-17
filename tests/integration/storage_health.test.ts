import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app.js';
import { S3Client } from '@aws-sdk/client-s3';
import { setR2ClientForTesting, resetR2Client } from '../../apps/api/src/infrastructure/r2Client.js';
import { checkStorageHealth } from '../../apps/api/src/infrastructure/storageAdapter.js';
import * as dbModule from '../../apps/api/src/infrastructure/database.js';
import * as redisModule from '../../apps/api/src/infrastructure/redis.js';
import * as aiModule from '../../apps/api/src/infrastructure/aiClient.js';

describe('Storage Subsystem Health Check Integration Tests', () => {
  const app = createApp();

  beforeEach(() => {
    resetR2Client();
    vi.spyOn(dbModule, 'checkDatabaseHealth').mockResolvedValue({ status: 'healthy', latencyMs: 2 });
    vi.spyOn(redisModule, 'checkRedisHealth').mockResolvedValue({ status: 'healthy', latencyMs: 1 });
    vi.spyOn(aiModule, 'checkAiServiceHealth').mockResolvedValue({ status: 'disabled', message: 'AI disabled' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetR2Client();
  });

  describe('checkStorageHealth direct contract', () => {
    it('should report status disabled when R2 is unconfigured in test environment', async () => {
      const result = await checkStorageHealth();
      expect(result.status).toBe('disabled');
      expect(result.message).toContain('Cloudflare R2 storage is not configured');
    });

    it('should report status healthy when R2 bucket is accessible', async () => {
      const mockClient = new S3Client({
        region: 'auto',
        endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: '0123456789abcdef0123456789abcdef',
          secretAccessKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      });

      vi.spyOn(mockClient, 'send').mockResolvedValueOnce({} as never);
      setR2ClientForTesting(mockClient, 'studio-lumina-bucket');

      const result = await checkStorageHealth();
      expect(result.status).toBe('healthy');
      expect(result.details?.bucket).toBe('studio-lumina-bucket');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should report status unhealthy when R2 bucket probe fails', async () => {
      const mockClient = new S3Client({
        region: 'auto',
        endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: '0123456789abcdef0123456789abcdef',
          secretAccessKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      });

      vi.spyOn(mockClient, 'send').mockRejectedValueOnce({
        name: 'NoSuchBucket',
        message: 'The specified bucket does not exist',
      } as never);
      setR2ClientForTesting(mockClient, 'studio-lumina-bucket');

      const result = await checkStorageHealth();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Configured storage bucket does not exist');
    });
  });

  describe('GET /health route diagnostic inclusion', () => {
    it('should include storage check in GET /health response', async () => {
      const mockClient = new S3Client({
        region: 'auto',
        endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: '0123456789abcdef0123456789abcdef',
          secretAccessKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      });

      vi.spyOn(mockClient, 'send').mockResolvedValueOnce({} as never);
      setR2ClientForTesting(mockClient, 'studio-lumina-bucket');

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.storage).toBeDefined();
      expect(res.body.checks.storage.status).toBe('healthy');
      expect(res.body.checks.storage.details.bucket).toBe('studio-lumina-bucket');
    });

    it('should report storage disabled in GET /health when unconfigured', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.checks.storage).toBeDefined();
      expect(res.body.checks.storage.status).toBe('disabled');
    });
  });
});
