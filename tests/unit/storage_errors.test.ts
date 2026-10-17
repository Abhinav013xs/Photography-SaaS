import { describe, it, expect } from 'vitest';
import {
  StorageError,
  StorageConfigError,
  StorageAuthenticationError,
  StoragePermissionError,
  StorageBucketNotFoundError,
  StorageObjectNotFoundError,
  StorageTimeoutError,
  StorageNetworkError,
  StorageRateLimitError,
  StorageKeyInvalidError,
  normalizeStorageError,
} from '@photography-saas/errors';

describe('Storage Error Normalization & AppError Hierarchy', () => {
  it('should instantiate all storage error types with correct status and error codes', () => {
    const configErr = new StorageConfigError('Missing R2 secrets');
    expect(configErr.statusCode).toBe(503);
    expect(configErr.code).toBe('STORAGE_CONFIG_MISSING');

    const authErr = new StorageAuthenticationError('Invalid credentials');
    expect(authErr.statusCode).toBe(502);
    expect(authErr.code).toBe('STORAGE_AUTH_FAILED');

    const permErr = new StoragePermissionError('Forbidden');
    expect(permErr.statusCode).toBe(403);
    expect(permErr.code).toBe('STORAGE_PERMISSION_DENIED');

    const bucketErr = new StorageBucketNotFoundError('Bucket not found');
    expect(bucketErr.statusCode).toBe(502);
    expect(bucketErr.code).toBe('STORAGE_BUCKET_NOT_FOUND');

    const objErr = new StorageObjectNotFoundError('Object not found');
    expect(objErr.statusCode).toBe(404);
    expect(objErr.code).toBe('STORAGE_OBJECT_NOT_FOUND');

    const timeoutErr = new StorageTimeoutError('Timeout');
    expect(timeoutErr.statusCode).toBe(504);
    expect(timeoutErr.code).toBe('STORAGE_TIMEOUT');

    const networkErr = new StorageNetworkError('Network error');
    expect(networkErr.statusCode).toBe(502);
    expect(networkErr.code).toBe('STORAGE_NETWORK_ERROR');

    const rateErr = new StorageRateLimitError('Too many requests');
    expect(rateErr.statusCode).toBe(429);
    expect(rateErr.code).toBe('STORAGE_RATE_LIMITED');

    const keyErr = new StorageKeyInvalidError('Key invalid');
    expect(keyErr.statusCode).toBe(400);
    expect(keyErr.code).toBe('STORAGE_KEY_INVALID');
  });

  describe('normalizeStorageError', () => {
    it('should pass through existing AppErrors unchanged', () => {
      const original = new StorageKeyInvalidError('Invalid key format');
      const normalized = normalizeStorageError(original);
      expect(normalized).toBe(original);
    });

    it('should map S3 NoSuchKey / NotFound to StorageObjectNotFoundError', () => {
      const s3Error = { name: 'NoSuchKey', message: 'The specified key does not exist.' };
      const normalized = normalizeStorageError(s3Error);
      expect(normalized).toBeInstanceOf(StorageObjectNotFoundError);
      expect(normalized.statusCode).toBe(404);

      const s3NotFound = { name: 'NotFound', $metadata: { httpStatusCode: 404 } };
      const normalized404 = normalizeStorageError(s3NotFound);
      expect(normalized404).toBeInstanceOf(StorageObjectNotFoundError);
    });

    it('should map S3 NoSuchBucket to StorageBucketNotFoundError', () => {
      const s3Error = { name: 'NoSuchBucket', message: 'The specified bucket does not exist' };
      const normalized = normalizeStorageError(s3Error);
      expect(normalized).toBeInstanceOf(StorageBucketNotFoundError);
      expect(normalized.statusCode).toBe(502);
    });

    it('should map S3 authentication errors to StorageAuthenticationError', () => {
      const invalidKey = { name: 'InvalidAccessKeyId', message: 'The AWS Access Key Id does not exist' };
      expect(normalizeStorageError(invalidKey)).toBeInstanceOf(StorageAuthenticationError);

      const sigMismatch = { name: 'SignatureDoesNotMatch', message: 'Calculated signature does not match' };
      expect(normalizeStorageError(sigMismatch)).toBeInstanceOf(StorageAuthenticationError);
    });

    it('should map S3 AccessDenied to StoragePermissionError', () => {
      const accessDenied = { name: 'AccessDenied', message: 'Access Denied', $metadata: { httpStatusCode: 403 } };
      const normalized = normalizeStorageError(accessDenied);
      expect(normalized).toBeInstanceOf(StoragePermissionError);
      expect(normalized.statusCode).toBe(403);
    });

    it('should map timeout errors to StorageTimeoutError', () => {
      const timeout = { name: 'TimeoutError', message: 'Connection timed out' };
      expect(normalizeStorageError(timeout)).toBeInstanceOf(StorageTimeoutError);

      const socketTimeout = { code: 'ETIMEDOUT', message: 'Socket timed out' };
      expect(normalizeStorageError(socketTimeout)).toBeInstanceOf(StorageTimeoutError);
    });

    it('should map network/DNS errors to StorageNetworkError', () => {
      const enotfound = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' };
      expect(normalizeStorageError(enotfound)).toBeInstanceOf(StorageNetworkError);

      const connRefused = { code: 'ECONNREFUSED', message: 'Connection refused' };
      expect(normalizeStorageError(connRefused)).toBeInstanceOf(StorageNetworkError);
    });

    it('should map SlowDown / 429 to StorageRateLimitError', () => {
      const slowDown = { name: 'SlowDown', message: 'Please reduce your request rate' };
      expect(normalizeStorageError(slowDown)).toBeInstanceOf(StorageRateLimitError);

      const rateLimit = { $metadata: { httpStatusCode: 429 } };
      expect(normalizeStorageError(rateLimit)).toBeInstanceOf(StorageRateLimitError);
    });

    it('should map unclassified errors to generic StorageError', () => {
      const generic = new Error('Unknown S3 hardware failure');
      const normalized = normalizeStorageError(generic);
      expect(normalized).toBeInstanceOf(StorageError);
      expect(normalized.statusCode).toBe(500);
      expect(normalized.message).toBe('Unknown S3 hardware failure');
    });
  });
});
