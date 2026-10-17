import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isR2Configured } from '@photography-saas/config';
import {
  getR2Endpoint,
  getR2Client,
  resetR2Client,
  isR2StorageConfigured,
} from '../../apps/api/src/infrastructure/r2Client.js';
import { StorageConfigError } from '@photography-saas/errors';

describe('Storage Configuration & Endpoint Resolution', () => {
  beforeEach(() => {
    resetR2Client();
  });

  afterEach(() => {
    resetR2Client();
  });

  describe('isR2Configured helper', () => {
    it('should return false if r2 is undefined or empty', () => {
      expect(isR2Configured(undefined)).toBe(false);
      expect(isR2Configured({})).toBe(false);
    });

    it('should return false if any required credential is missing', () => {
      expect(
        isR2Configured({
          accountId: 'account-123',
          accessKeyId: 'key-123',
          secretAccessKey: 'secret-123',
          // bucket missing
        })
      ).toBe(false);

      expect(
        isR2Configured({
          accountId: 'account-123',
          accessKeyId: 'key-123',
          bucketName: 'photos',
          // secret missing
        })
      ).toBe(false);
    });

    it('should return true when all 4 core parameters are present', () => {
      expect(
        isR2Configured({
          accountId: 'test-account-id',
          accessKeyId: 'test-access-key-id',
          secretAccessKey: 'test-secret-access-key',
          bucketName: 'studio-lumina-photos',
        })
      ).toBe(true);
    });

    it('should return true when custom endpoint is provided instead of accountId', () => {
      expect(
        isR2Configured({
          endpoint: 'http://localhost:9000',
          accessKeyId: 'minio-admin',
          secretAccessKey: 'minio-secret',
          bucketName: 'local-bucket',
        })
      ).toBe(true);
    });
  });

  describe('getR2Endpoint', () => {
    it('should construct official Cloudflare R2 endpoint from account ID', () => {
      const endpoint = getR2Endpoint({
        accountId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      });
      expect(endpoint).toBe('https://a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4.r2.cloudflarestorage.com');
    });

    it('should use explicit endpoint override when provided', () => {
      const endpoint = getR2Endpoint({
        accountId: 'ignored-account',
        endpoint: 'https://custom-s3.example.com',
      });
      expect(endpoint).toBe('https://custom-s3.example.com');
    });

    it('should throw StorageConfigError when both accountId and endpoint are missing', () => {
      expect(() => getR2Endpoint({})).toThrow(StorageConfigError);
    });
  });

  describe('getR2Client unconfigured behavior', () => {
    it('should throw StorageConfigError when accessed without configuration', () => {
      // In default test environment without R2 env vars set
      if (!isR2StorageConfigured()) {
        expect(() => getR2Client()).toThrow(StorageConfigError);
      }
    });
  });
});
