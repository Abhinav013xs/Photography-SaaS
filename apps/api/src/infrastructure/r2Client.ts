import { S3Client } from '@aws-sdk/client-s3';
import { getConfig, isR2Configured } from '@photography-saas/config';
import { StorageConfigError } from '@photography-saas/errors';
import { logger } from '../utils/logger.js';

let cachedS3Client: S3Client | null = null;
let cachedBucketName: string | null = null;

/**
 * Returns whether Cloudflare R2 storage credentials are fully configured.
 */
export function isR2StorageConfigured(): boolean {
  if (cachedS3Client !== null && cachedBucketName !== null) {
    return true;
  }
  const config = getConfig();
  return isR2Configured(config.r2);
}

/**
 * Derives the official Cloudflare R2 endpoint for the configured account.
 * Format: https://<account_id>.r2.cloudflarestorage.com
 */
export function getR2Endpoint(r2Config: ReturnType<typeof getConfig>['r2']): string {
  if (r2Config.endpoint && r2Config.endpoint.trim().length > 0) {
    return r2Config.endpoint.trim();
  }

  if (r2Config.accountId && r2Config.accountId.trim().length > 0) {
    return `https://${r2Config.accountId.trim()}.r2.cloudflarestorage.com`;
  }

  throw new StorageConfigError(
    'Cloudflare R2 requires either R2_ACCOUNT_ID or an explicit R2_ENDPOINT to construct the S3 endpoint.'
  );
}

/**
 * Retrieves the configured S3Client instance for Cloudflare R2.
 * Initializes lazily on first access.
 * Throws StorageConfigError if storage credentials are missing or incomplete.
 */
export function getR2Client(): S3Client {
  if (cachedS3Client) {
    return cachedS3Client;
  }

  const config = getConfig();
  const r2 = config.r2;

  if (!isR2Configured(r2)) {
    const missing: string[] = [];
    if (!r2.accountId && !r2.endpoint) missing.push('R2_ACCOUNT_ID / R2_ENDPOINT');
    if (!r2.accessKeyId) missing.push('R2_ACCESS_KEY_ID');
    if (!r2.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
    if (!r2.bucketName) missing.push('R2_BUCKET_NAME');

    throw new StorageConfigError(
      `Cloudflare R2 is not configured. Missing required environment variables: ${missing.join(', ')}`,
      { missingVariables: missing }
    );
  }

  const endpoint = getR2Endpoint(r2);

  cachedS3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: r2.accessKeyId!,
      secretAccessKey: r2.secretAccessKey!,
    },
    maxAttempts: 3,
  });

  cachedBucketName = r2.bucketName!;

  logger.info('Cloudflare R2 storage client initialized', {
    endpoint,
    bucketName: r2.bucketName,
    region: 'auto',
  });

  return cachedS3Client;
}

/**
 * Retrieves the configured Cloudflare R2 bucket name.
 */
export function getR2BucketName(): string {
  if (cachedBucketName) {
    return cachedBucketName;
  }

  const config = getConfig();
  if (!config.r2.bucketName) {
    throw new StorageConfigError('R2_BUCKET_NAME is not configured.');
  }

  cachedBucketName = config.r2.bucketName;
  return cachedBucketName;
}

/**
 * Resets the cached S3Client instance (primarily for testing and mock injection).
 */
export function resetR2Client(): void {
  if (cachedS3Client) {
    try {
      cachedS3Client.destroy();
    } catch {
      // Ignore destroy errors during reset
    }
  }
  cachedS3Client = null;
  cachedBucketName = null;
}

/**
 * Overrides the cached S3Client instance (for integration contract tests with mocks/test doubles).
 */
export function setR2ClientForTesting(client: S3Client, bucketName = 'test-bucket'): void {
  cachedS3Client = client;
  cachedBucketName = bucketName;
}
