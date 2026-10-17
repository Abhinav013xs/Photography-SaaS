import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import {
  StorageAdapter,
  storageAdapter,
} from '../../apps/api/src/infrastructure/storageAdapter.js';
import {
  setR2ClientForTesting,
  resetR2Client,
} from '../../apps/api/src/infrastructure/r2Client.js';
import {
  StorageKeyInvalidError,
  StorageBucketNotFoundError,
} from '@photography-saas/errors';

describe('StorageAdapter Integration & Contract Tests', () => {
  const validEventId = 'e0000000-0000-0000-0000-000000000001';
  const validKey = `events/${validEventId}/originals/dsc_0001.jpg`;
  const previewKey = `events/${validEventId}/previews/dsc_0001.webp`;
  const bucketName = 'studio-lumina-test-bucket';

  let mockS3Client: S3Client;

  beforeEach(() => {
    // Create an S3Client configured for offline signing and deterministic mocking
    mockS3Client = new S3Client({
      region: 'auto',
      endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: '0123456789abcdef0123456789abcdef',
        secretAccessKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
    });

    setR2ClientForTesting(mockS3Client, bucketName);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetR2Client();
  });

  describe('checkBucketAccess', () => {
    it('should report accessible true when HeadBucket succeeds', async () => {
      vi.spyOn(mockS3Client, 'send').mockResolvedValueOnce({} as never);

      const result = await storageAdapter.checkBucketAccess();

      expect(result.accessible).toBe(true);
      expect(result.bucketName).toBe(bucketName);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should report accessible false and normalized error when HeadBucket fails', async () => {
      vi.spyOn(mockS3Client, 'send').mockRejectedValueOnce({
        name: 'NoSuchBucket',
        message: 'The specified bucket does not exist',
      } as never);

      const result = await storageAdapter.checkBucketAccess();

      expect(result.accessible).toBe(false);
      expect(result.bucketName).toBe(bucketName);
      expect(result.error).toContain('Configured storage bucket does not exist');
    });
  });

  describe('headObject & objectExists', () => {
    it('should return object metadata when object exists', async () => {
      const lastModified = new Date('2026-10-09T08:00:00Z');
      vi.spyOn(mockS3Client, 'send').mockResolvedValueOnce({
        ContentLength: 4500000,
        ContentType: 'image/jpeg',
        ETag: '"9b2cf51b4e23456a7c8d9e0f"',
        LastModified: lastModified,
        Metadata: {
          'camera-make': 'Sony',
          'camera-model': 'A7 IV',
        },
      } as never);

      const metadata = await storageAdapter.headObject(validKey);

      expect(metadata).not.toBeNull();
      expect(metadata?.key).toBe(validKey);
      expect(metadata?.sizeBytes).toBe(4500000);
      expect(metadata?.contentType).toBe('image/jpeg');
      expect(metadata?.etag).toBe('9b2cf51b4e23456a7c8d9e0f');
      expect(metadata?.lastModified).toEqual(lastModified);
      expect(metadata?.customMetadata).toEqual({
        'camera-make': 'Sony',
        'camera-model': 'A7 IV',
      });

      // Verify objectExists returns true
      vi.spyOn(mockS3Client, 'send').mockResolvedValueOnce({
        ContentLength: 4500000,
      } as never);
      const exists = await storageAdapter.objectExists(validKey);
      expect(exists).toBe(true);
    });

    it('should return null when object does not exist (404/NotFound)', async () => {
      vi.spyOn(mockS3Client, 'send').mockRejectedValueOnce({
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      } as never);

      const metadata = await storageAdapter.headObject(validKey);
      expect(metadata).toBeNull();

      // Verify objectExists returns false
      vi.spyOn(mockS3Client, 'send').mockRejectedValueOnce({
        name: 'NoSuchKey',
      } as never);
      const exists = await storageAdapter.objectExists(validKey);
      expect(exists).toBe(false);
    });

    it('should throw normalized error when headObject encounters a non-404 failure', async () => {
      vi.spyOn(mockS3Client, 'send').mockRejectedValueOnce({
        name: 'NoSuchBucket',
        message: 'The bucket does not exist',
      } as never);

      await expect(storageAdapter.headObject(validKey)).rejects.toThrow(
        StorageBucketNotFoundError
      );
    });

    it('should reject invalid storage keys with StorageKeyInvalidError', async () => {
      await expect(storageAdapter.headObject('invalid/key.jpg')).rejects.toThrow(
        StorageKeyInvalidError
      );
      await expect(storageAdapter.headObject(`events/${validEventId}/originals/../hack.jpg`)).rejects.toThrow(
        StorageKeyInvalidError
      );
    });
  });

  describe('putObject', () => {
    it('should upload buffer and return key and sizeBytes', async () => {
      const buffer = Buffer.from('fake image content');
      vi.spyOn(mockS3Client, 'send').mockResolvedValueOnce({} as never);

      const result = await storageAdapter.putObject(validKey, buffer, 'image/jpeg');

      expect(result.key).toBe(validKey);
      expect(result.sizeBytes).toBe(buffer.length);
    });

    it('should upload string and return key and sizeBytes', async () => {
      const text = 'test text file';
      vi.spyOn(mockS3Client, 'send').mockResolvedValueOnce({} as never);

      const result = await storageAdapter.putObject(previewKey, text, 'text/plain');

      expect(result.key).toBe(previewKey);
      expect(result.sizeBytes).toBe(Buffer.byteLength(text));
    });

    it('should reject invalid keys on putObject', async () => {
      await expect(storageAdapter.putObject('bad-key', Buffer.from('test'), 'image/jpeg')).rejects.toThrow(
        StorageKeyInvalidError
      );
    });
  });

  describe('deleteObject', () => {
    it('should delete object idempotently and return deleted true', async () => {
      vi.spyOn(mockS3Client, 'send').mockResolvedValueOnce({} as never);

      const result = await storageAdapter.deleteObject(validKey);

      expect(result.key).toBe(validKey);
      expect(result.deleted).toBe(true);
    });

    it('should reject invalid keys on deleteObject', async () => {
      await expect(storageAdapter.deleteObject('events/bad/path.jpg')).rejects.toThrow(
        StorageKeyInvalidError
      );
    });
  });

  describe('generatePresignedPutUrl', () => {
    it('should generate a valid presigned PUT URL with bounded expiration', async () => {
      const result = await storageAdapter.generatePresignedPutUrl({
        key: validKey,
        contentType: 'image/jpeg',
        contentLength: 5000000,
        expiresInSeconds: 900,
      });

      expect(result.key).toBe(validKey);
      expect(result.expiresInSeconds).toBe(900);
      expect(result.url).toContain('test-account-id.r2.cloudflarestorage.com');
      expect(result.url).toContain(validKey);
      expect(result.url).toContain('X-Amz-Signature=');
      expect(result.expiresAt).toBeDefined();
    });

    it('should bound expiration between 60s and 3600s', async () => {
      // Lower bound check
      const lowResult = await storageAdapter.generatePresignedPutUrl({
        key: validKey,
        contentType: 'image/jpeg',
        expiresInSeconds: 10, // below 60s min
      });
      expect(lowResult.expiresInSeconds).toBe(60);

      // Upper bound check
      const highResult = await storageAdapter.generatePresignedPutUrl({
        key: validKey,
        contentType: 'image/jpeg',
        expiresInSeconds: 7200, // above 3600s max
      });
      expect(highResult.expiresInSeconds).toBe(3600);
    });

    it('should reject invalid keys on generatePresignedPutUrl', async () => {
      await expect(
        storageAdapter.generatePresignedPutUrl({
          key: '../traversal.jpg',
          contentType: 'image/jpeg',
        })
      ).rejects.toThrow(StorageKeyInvalidError);
    });
  });

  describe('generatePresignedGetUrl', () => {
    it('should generate a valid presigned GET URL with bounded expiration', async () => {
      const result = await storageAdapter.generatePresignedGetUrl({
        key: validKey,
        expiresInSeconds: 600,
      });

      expect(result.key).toBe(validKey);
      expect(result.expiresInSeconds).toBe(600);
      expect(result.url).toContain('test-account-id.r2.cloudflarestorage.com');
      expect(result.url).toContain(validKey);
      expect(result.url).toContain('X-Amz-Signature=');
      expect(result.expiresAt).toBeDefined();
    });

    it('should support content disposition header in presigned GET URL', async () => {
      const result = await storageAdapter.generatePresignedGetUrl({
        key: validKey,
        responseContentDisposition: 'attachment; filename="wedding_master.jpg"',
      });

      expect(result.url).toContain('response-content-disposition=');
    });

    it('should reject invalid keys on generatePresignedGetUrl', async () => {
      await expect(
        storageAdapter.generatePresignedGetUrl({
          key: 'not-a-valid-key',
        })
      ).rejects.toThrow(StorageKeyInvalidError);
    });
  });
});
