import {
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  StorageObjectMetadata,
  PresignedPutOptions,
  PresignedGetOptions,
  PresignedUrlResult,
  BucketAccessResult,
  SubsystemHealthCheck,
} from '@photography-saas/types';
import {
  isValidStorageKey,
} from '@photography-saas/types';
import {
  StorageKeyInvalidError,
  StorageObjectNotFoundError,
  normalizeStorageError,
} from '@photography-saas/errors';
import { getR2Client, getR2BucketName, isR2StorageConfigured } from './r2Client.js';
import { logger } from '../utils/logger.js';

/**
 * Sanitizes and strips sensitive security query parameters from a URL for safe logging.
 */
export function redactUrlForLogs(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // Remove all AWS signature query parameters
    const sensitiveParams = [
      'X-Amz-Signature',
      'X-Amz-Credential',
      'X-Amz-Security-Token',
      'X-Amz-Date',
      'X-Amz-Expires',
      'X-Amz-SignedHeaders',
      'signature',
      'sig',
      'token',
    ];
    for (const param of sensitiveParams) {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return '[REDACTED_URL]';
  }
}

/**
 * Cloudflare R2 Storage Adapter
 * Provides server-side storage primitives with strict error normalization,
 * deterministic key validation, and secret-redacted logging.
 */
export class StorageAdapter {
  /**
   * Checks whether the configured R2 bucket exists and is accessible.
   * Performs a lightweight HeadBucketCommand probe.
   */
  async checkBucketAccess(): Promise<BucketAccessResult> {
    const startTime = Date.now();
    let bucketName = 'unknown';

    try {
      const client = getR2Client();
      bucketName = getR2BucketName();

      await client.send(
        new HeadBucketCommand({
          Bucket: bucketName,
        })
      );

      const latencyMs = Date.now() - startTime;
      logger.info('Storage bucket connectivity probe succeeded', {
        service: 'storage',
        operation: 'checkBucketAccess',
        bucketName,
        latencyMs,
      });

      return {
        accessible: true,
        bucketName,
        latencyMs,
      };
    } catch (error: unknown) {
      const latencyMs = Date.now() - startTime;
      const normalized = normalizeStorageError(error, { bucketName });

      logger.warn('Storage bucket connectivity probe failed', {
        service: 'storage',
        operation: 'checkBucketAccess',
        bucketName,
        latencyMs,
        errorCode: normalized.code,
        message: normalized.message,
      });

      return {
        accessible: false,
        bucketName,
        latencyMs,
        error: normalized.message,
      };
    }
  }

  /**
   * Retrieves metadata for a stored object.
   * Returns null if the object does not exist (404/NotFound).
   */
  async headObject(key: string): Promise<StorageObjectMetadata | null> {
    this.assertValidKey(key);
    const client = getR2Client();
    const bucketName = getR2BucketName();
    const startTime = Date.now();

    try {
      const response = await client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );

      const metadata: StorageObjectMetadata = {
        key,
        sizeBytes: response.ContentLength ?? 0,
        contentType: response.ContentType,
        etag: response.ETag ? response.ETag.replace(/"/g, '') : undefined,
        lastModified: response.LastModified,
        customMetadata: response.Metadata,
      };

      logger.debug('Storage headObject succeeded', {
        service: 'storage',
        operation: 'headObject',
        key,
        sizeBytes: metadata.sizeBytes,
        durationMs: Date.now() - startTime,
      });

      return metadata;
    } catch (error: unknown) {
      const normalized = normalizeStorageError(error, { key, bucketName });

      if (normalized instanceof StorageObjectNotFoundError) {
        return null;
      }

      logger.error('Storage headObject failed', {
        service: 'storage',
        operation: 'headObject',
        key,
        errorCode: normalized.code,
        durationMs: Date.now() - startTime,
      });

      throw normalized;
    }
  }

  /**
   * Checks whether an object exists in storage.
   */
  async objectExists(key: string): Promise<boolean> {
    const meta = await this.headObject(key);
    return meta !== null;
  }

  /**
   * Retrieves an object's binary buffer from R2.
   * Throws StorageObjectNotFoundError if the object does not exist.
   */
  async getObject(key: string): Promise<Buffer> {
    this.assertValidKey(key);
    const client = getR2Client();
    const bucketName = getR2BucketName();
    const startTime = Date.now();

    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );

      if (!response.Body) {
        throw new StorageObjectNotFoundError(`Object "${key}" returned empty body from bucket "${bucketName}"`);
      }

      // In AWS SDK v3, response.Body has transformToByteArray()
      const bodyAny = response.Body as any;
      let buffer: Buffer;

      if (typeof bodyAny.transformToByteArray === 'function') {
        const byteArray = await bodyAny.transformToByteArray();
        buffer = Buffer.from(byteArray);
      } else if (Buffer.isBuffer(bodyAny)) {
        buffer = bodyAny;
      } else {
        // Fallback for stream reading
        const chunks: Buffer[] = [];
        for await (const chunk of bodyAny) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        buffer = Buffer.concat(chunks);
      }

      logger.debug('Storage getObject succeeded', {
        service: 'storage',
        operation: 'getObject',
        key,
        sizeBytes: buffer.length,
        durationMs: Date.now() - startTime,
      });

      return buffer;
    } catch (error: unknown) {
      const normalized = normalizeStorageError(error, { key, bucketName });

      logger.error('Storage getObject failed', {
        service: 'storage',
        operation: 'getObject',
        key,
        errorCode: normalized.code,
        durationMs: Date.now() - startTime,
      });

      throw normalized;
    }
  }

  /**
   * Stores an object buffer or string directly into R2.
   */
  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<{ key: string; sizeBytes: number }> {
    this.assertValidKey(key);
    const client = getR2Client();
    const bucketName = getR2BucketName();
    const startTime = Date.now();
    const sizeBytes = typeof body === 'string' ? Buffer.byteLength(body) : body.length;

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          Metadata: metadata,
        })
      );

      logger.info('Storage putObject succeeded', {
        service: 'storage',
        operation: 'putObject',
        key,
        sizeBytes,
        contentType,
        durationMs: Date.now() - startTime,
      });

      return { key, sizeBytes };
    } catch (error: unknown) {
      const normalized = normalizeStorageError(error, { key, bucketName, sizeBytes });

      logger.error('Storage putObject failed', {
        service: 'storage',
        operation: 'putObject',
        key,
        errorCode: normalized.code,
        durationMs: Date.now() - startTime,
      });

      throw normalized;
    }
  }

  /**
   * Deletes a specific object from R2.
   * Idempotent: succeeds if the object was already deleted or did not exist.
   */
  async deleteObject(key: string): Promise<{ key: string; deleted: boolean }> {
    this.assertValidKey(key);
    const client = getR2Client();
    const bucketName = getR2BucketName();
    const startTime = Date.now();

    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );

      logger.info('Storage deleteObject succeeded', {
        service: 'storage',
        operation: 'deleteObject',
        key,
        durationMs: Date.now() - startTime,
      });

      return { key, deleted: true };
    } catch (error: unknown) {
      const normalized = normalizeStorageError(error, { key, bucketName });

      logger.error('Storage deleteObject failed', {
        service: 'storage',
        operation: 'deleteObject',
        key,
        errorCode: normalized.code,
        durationMs: Date.now() - startTime,
      });

      throw normalized;
    }
  }

  /**
   * Lists objects with a given prefix, handling pagination via continuation tokens.
   */
  async listObjects(options: {
    prefix: string;
    continuationToken?: string;
    maxKeys?: number;
  }): Promise<{
    keys: string[];
    isTruncated: boolean;
    nextContinuationToken?: string;
    keyCount: number;
  }> {
    if (!isR2StorageConfigured()) {
      return { keys: [], isTruncated: false, keyCount: 0 };
    }
    const client = getR2Client();
    const bucketName = getR2BucketName();
    const startTime = Date.now();

    try {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: options.prefix,
        ContinuationToken: options.continuationToken,
        MaxKeys: options.maxKeys ?? 1000,
      });

      const response = await client.send(command);
      const keys = (response.Contents || []).map((c) => c.Key!).filter(Boolean);

      logger.info('Storage listObjects succeeded', {
        service: 'storage',
        operation: 'listObjects',
        prefix: options.prefix,
        keyCount: keys.length,
        isTruncated: response.IsTruncated ?? false,
        durationMs: Date.now() - startTime,
      });

      return {
        keys,
        isTruncated: response.IsTruncated ?? false,
        nextContinuationToken: response.NextContinuationToken,
        keyCount: keys.length,
      };
    } catch (error: unknown) {
      const normalized = normalizeStorageError(error, { bucketName });
      logger.error('Storage listObjects failed', {
        service: 'storage',
        operation: 'listObjects',
        prefix: options.prefix,
        errorCode: normalized.code,
        durationMs: Date.now() - startTime,
      });
      throw normalized;
    }
  }

  /**
   * Deletes a batch of objects from R2 using DeleteObjectsCommand (up to 1,000 keys per chunk).
   */
  async deleteObjects(keys: string[]): Promise<{ deletedCount: number }> {
    if (!keys || keys.length === 0) {
      return { deletedCount: 0 };
    }
    if (!isR2StorageConfigured()) {
      return { deletedCount: keys.length };
    }

    const client = getR2Client();
    const bucketName = getR2BucketName();
    const startTime = Date.now();

    try {
      let totalDeleted = 0;
      const CHUNK_SIZE = 1000;
      for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
        const chunk = keys.slice(i, i + CHUNK_SIZE);
        const command = new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: chunk.map((k) => ({ Key: k })),
            Quiet: true,
          },
        });
        await client.send(command);
        totalDeleted += chunk.length;
      }

      logger.info('Storage deleteObjects batch succeeded', {
        service: 'storage',
        operation: 'deleteObjects',
        deletedCount: totalDeleted,
        durationMs: Date.now() - startTime,
      });

      return { deletedCount: totalDeleted };
    } catch (error: unknown) {
      const normalized = normalizeStorageError(error, { bucketName });
      logger.error('Storage deleteObjects batch failed', {
        service: 'storage',
        operation: 'deleteObjects',
        keyCount: keys.length,
        errorCode: normalized.code,
        durationMs: Date.now() - startTime,
      });
      throw normalized;
    }
  }

  /**
   * Recursively purges all Cloudflare R2 objects for an event.
   * Inventories all keys under prefix `events/{eventId}/` (handling pagination across thousands of objects),
   * deletes them in batches with retry logic, and verifies zero remaining keys.
   */
  async purgeEventPrefix(
    eventId: string,
    options?: { maxRetries?: number; batchSize?: number }
  ): Promise<{ eventId: string; deletedCount: number; prefix: string }> {
    const prefix = `events/${eventId}/`;
    if (!isR2StorageConfigured()) {
      logger.info('Cloudflare R2 is unconfigured; skipping purgeEventPrefix', {
        service: 'storage',
        eventId,
        prefix,
      });
      return { eventId, deletedCount: 0, prefix };
    }

    const maxRetries = options?.maxRetries ?? 3;
    let attempt = 0;
    let totalDeleted = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        let continuationToken: string | undefined = undefined;
        const eventKeys: string[] = [];

        do {
          const listResult = await this.listObjects({
            prefix,
            continuationToken,
            maxKeys: 1000,
          });

          eventKeys.push(...listResult.keys);
          continuationToken = listResult.isTruncated ? listResult.nextContinuationToken : undefined;
        } while (continuationToken);

        if (eventKeys.length === 0) {
          logger.info('No R2 objects found for event prefix purge', {
            service: 'storage',
            eventId,
            prefix,
            totalDeleted,
          });
          return { eventId, deletedCount: totalDeleted, prefix };
        }

        const deleteResult = await this.deleteObjects(eventKeys);
        totalDeleted += deleteResult.deletedCount;

        // Verify that 0 objects remain under prefix
        const verifyList = await this.listObjects({ prefix, maxKeys: 1 });
        if (verifyList.keyCount === 0) {
          logger.info('Event R2 prefix purge successfully completed and verified', {
            service: 'storage',
            eventId,
            prefix,
            totalDeleted,
          });
          return { eventId, deletedCount: totalDeleted, prefix };
        }
      } catch (err: unknown) {
        logger.warn(`R2 purge attempt ${attempt}/${maxRetries} failed for event ${eventId}`, {
          service: 'storage',
          eventId,
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempt >= maxRetries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, attempt * 500));
      }
    }

    return { eventId, deletedCount: totalDeleted, prefix };
  }



  /**
   * Generates a short-lived presigned PUT URL for direct browser-to-R2 upload.
   * Expiration is bounded between 60 seconds and 3600 seconds (1 hour).
   */
  async generatePresignedPutUrl(options: PresignedPutOptions): Promise<PresignedUrlResult> {
    this.assertValidKey(options.key);
    const client = getR2Client();
    const bucketName = getR2BucketName();
    const startTime = Date.now();

    // Bound expiration to safe limits: default 900s (15m), min 60s, max 3600s (1h)
    const rawExpiry = options.expiresInSeconds ?? 900;
    const expiresInSeconds = Math.max(60, Math.min(3600, rawExpiry));

    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: options.key,
        ContentType: options.contentType,
        ContentLength: options.contentLength,
        Metadata: options.customMetadata,
      });

      const url = await getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
      });

      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

      logger.info('Storage presigned PUT URL generated', {
        service: 'storage',
        operation: 'generatePresignedPutUrl',
        key: options.key,
        expiresInSeconds,
        safeUrl: redactUrlForLogs(url),
        durationMs: Date.now() - startTime,
      });

      return {
        url,
        key: options.key,
        expiresInSeconds,
        expiresAt,
      };
    } catch (error: unknown) {
      const normalized = normalizeStorageError(error, { key: options.key, bucketName });

      logger.error('Failed to generate presigned PUT URL', {
        service: 'storage',
        operation: 'generatePresignedPutUrl',
        key: options.key,
        errorCode: normalized.code,
        durationMs: Date.now() - startTime,
      });

      throw normalized;
    }
  }

  /**
   * Generates a short-lived presigned GET URL for secure media delivery or download.
   * Expiration is bounded between 60 seconds and 3600 seconds (1 hour).
   */
  async generatePresignedGetUrl(options: PresignedGetOptions): Promise<PresignedUrlResult> {
    this.assertValidKey(options.key);
    const client = getR2Client();
    const bucketName = getR2BucketName();
    const startTime = Date.now();

    // Bound expiration: default 900s (15m), min 60s, max 3600s (1h)
    const rawExpiry = options.expiresInSeconds ?? 900;
    const expiresInSeconds = Math.max(60, Math.min(3600, rawExpiry));

    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: options.key,
        ResponseContentDisposition: options.responseContentDisposition,
      });

      const url = await getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
      });

      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

      logger.info('Storage presigned GET URL generated', {
        service: 'storage',
        operation: 'generatePresignedGetUrl',
        key: options.key,
        expiresInSeconds,
        safeUrl: redactUrlForLogs(url),
        durationMs: Date.now() - startTime,
      });

      return {
        url,
        key: options.key,
        expiresInSeconds,
        expiresAt,
      };
    } catch (error: unknown) {
      const normalized = normalizeStorageError(error, { key: options.key, bucketName });

      logger.error('Failed to generate presigned GET URL', {
        service: 'storage',
        operation: 'generatePresignedGetUrl',
        key: options.key,
        errorCode: normalized.code,
        durationMs: Date.now() - startTime,
      });

      throw normalized;
    }
  }

  /**
   * Helper that asserts a key conforms strictly to the deterministic key convention.
   * Protects against path traversal, arbitrary bucket writes, and malformed identifiers.
   */
  private assertValidKey(key: string): void {
    if (!key || typeof key !== 'string' || !isValidStorageKey(key)) {
      throw new StorageKeyInvalidError(
        `Invalid storage object key: "${key}". Key must match format: events/{eventId}/{category}/{filename}`
      );
    }
  }
}

/**
 * Singleton instance of the storage adapter
 */
export const storageAdapter = new StorageAdapter();

/**
 * Diagnostic health check for Cloudflare R2 storage subsystem.
 */
export async function checkStorageHealth(): Promise<SubsystemHealthCheck> {
  if (!isR2StorageConfigured()) {
    return {
      status: 'disabled',
      message: 'Cloudflare R2 storage is not configured (optional in local development)',
    };
  }

  const result = await storageAdapter.checkBucketAccess();

  if (result.accessible) {
    return {
      status: 'healthy',
      latencyMs: result.latencyMs,
      message: `Cloudflare R2 bucket "${result.bucketName}" is accessible`,
      details: {
        bucket: result.bucketName,
      },
    };
  }

  return {
    status: 'unhealthy',
    latencyMs: result.latencyMs,
    message: result.error || `Failed to access Cloudflare R2 bucket "${result.bucketName}"`,
    details: {
      bucket: result.bucketName,
    },
  };
}

