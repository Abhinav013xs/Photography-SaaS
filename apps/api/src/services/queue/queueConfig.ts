import { UnrecoverableError } from 'bullmq';
import {
  ValidationError,
  MediaNotFoundError,
  EventNotFoundError,
  CorruptImageError,
  DecompressionBombError,
  CorruptVideoError,
  VideoDurationExceededError,
  VideoDimensionsExceededError,
  AuthorizationError,
  EventAccessDeniedError,
  ConflictError,
  NotFoundError,
} from '@photography-saas/errors';
import {
  QUEUE_NAMES,
  type PhotoProcessingJobPayload,
  type VideoProcessingJobPayload,
  type GalleryExpiryJobPayload,
  type ZipGenerationJobPayload,
  type JobRetryPolicy,
} from '@photography-saas/types';
import { isValidUuid } from '@photography-saas/types';

/**
 * Default lease durations and timeouts in seconds
 */
export const DEFAULT_JOB_LEASE_SECONDS = 300; // 5 minutes
export const DEFAULT_LEASE_EXTENSION_SECONDS = 180; // 3 minutes

/**
 * Queue & Worker Infrastructure Configuration
 * Strictly isolated worker pools with bounded concurrency and exponential backoff retries.
 */
export const QUEUE_CONFIG = {
  names: QUEUE_NAMES,
  jobNames: {
    PHOTO: 'process-photo',
    VIDEO: 'process-video',
    EXPIRY: 'expire-gallery',
    ZIP: 'generate-zip',
  },
  photo: {
    concurrency: 4,
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 2000, // 2s -> 4s -> 8s
    },
    removeOnComplete: {
      age: 24 * 3600, // Retain completed jobs for 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Retain failed jobs for 7 days for diagnostics
      count: 5000,
    },
  },
  expiry: {
    concurrency: 2,
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 3000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
      count: 5000,
    },
  },
  video: {
    concurrency: 1, // Strictly bounded single-worker concurrency to prevent FFmpeg CPU exhaustion
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 5000, // 5s -> 10s
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 500,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
      count: 2000,
    },
  },
  zip: {
    concurrency: 2, // Bounded concurrency for background ZIP generation
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 3000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
      count: 2000,
    },
  },
  shutdown: {
    gracePeriodMs: 10000, // 10s grace period for in-flight tasks to finish
  },
};

/**
 * Standardized retry policies per job type
 */
export const RETRY_POLICIES: Record<string, JobRetryPolicy> = {
  photo_processing: {
    maxAttempts: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    jitterRatio: 0.2,
  },
  video_processing: {
    maxAttempts: 2,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    jitterRatio: 0.2,
  },
  gallery_expiry: {
    maxAttempts: 3,
    baseDelayMs: 3000,
    maxDelayMs: 30000,
    jitterRatio: 0.2,
  },
  zip_generation: {
    maxAttempts: 2,
    baseDelayMs: 3000,
    maxDelayMs: 30000,
    jitterRatio: 0.2,
  },
};

/**
 * Calculates bounded exponential backoff delay with random jitter.
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio = 0.2
): number {
  const safeAttempt = Math.max(1, attempt);
  const exponential = baseDelayMs * Math.pow(2, safeAttempt - 1);
  const bounded = Math.min(maxDelayMs, exponential);
  const jitter = bounded * jitterRatio * (Math.random() * 2 - 1); // +/- jitterRatio
  return Math.max(500, Math.round(bounded + jitter));
}

/**
 * Checks whether an error is permanent and non-retryable.
 * Permanent errors must transition immediately to 'failed' without consuming retries.
 */
export function isNonRetryableError(err: unknown): boolean {
  if (
    (err as any)?.name === 'UnrecoverableError' ||
    (typeof UnrecoverableError === 'function' && err instanceof UnrecoverableError)
  ) {
    return true;
  }
  if (
    err instanceof MediaNotFoundError ||
    err instanceof EventNotFoundError ||
    err instanceof CorruptImageError ||
    err instanceof DecompressionBombError ||
    err instanceof CorruptVideoError ||
    err instanceof VideoDurationExceededError ||
    err instanceof VideoDimensionsExceededError ||
    err instanceof ValidationError ||
    err instanceof AuthorizationError ||
    err instanceof EventAccessDeniedError ||
    err instanceof ConflictError ||
    err instanceof NotFoundError
  ) {
    return true;
  }
  if (typeof err === 'string') {
    const lower = err.toLowerCase();
    return (
      lower.includes('signature') ||
      lower.includes('corrupt') ||
      lower.includes('bomb') ||
      lower.includes('dimension') ||
      lower.includes('duration') ||
      lower.includes('unsupported') ||
      lower.includes('not found') ||
      lower.includes('invalid') ||
      lower.includes('unrecoverable') ||
      lower.includes('cannot read')
    );
  }
  if (err instanceof Error) {
    const lower = err.message.toLowerCase();
    return (
      lower.includes('signature') ||
      lower.includes('corrupt') ||
      lower.includes('bomb') ||
      lower.includes('dimension') ||
      lower.includes('duration') ||
      lower.includes('unsupported') ||
      lower.includes('not found') ||
      lower.includes('invalid') ||
      lower.includes('unrecoverable') ||
      lower.includes('cannot read')
    );
  }
  return false;
}

/**
 * Sanitizes error messages for public persistence in audit tables and logs.
 * Strips tokens, database connection URLs, secret keys, and raw payloads.
 */
export function sanitizeErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  let message = err instanceof Error ? err.message : String(err);

  // Redact potential connection strings / passwords / tokens
  message = message.replace(/postgres:\/\/[^@]+@/gi, 'postgres://***:***@');
  message = message.replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
  message = message.replace(/(?:key|secret|token|password)=["']?[^"'\s&]+["']?/gi, '$1=[REDACTED]');

  // Limit length to 1000 characters
  if (message.length > 1000) {
    message = message.slice(0, 1000) + '... (truncated)';
  }

  return message;
}

/**
 * Validates photo processing job payload.
 */
export function validatePhotoJobPayload(data: unknown): PhotoProcessingJobPayload {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Job payload must be an object');
  }

  const payload = data as Partial<PhotoProcessingJobPayload>;

  if (!payload.mediaId || typeof payload.mediaId !== 'string' || !isValidUuid(payload.mediaId)) {
    throw new ValidationError(`Invalid mediaId in photo job payload: "${payload.mediaId}"`);
  }

  if (!payload.eventId || typeof payload.eventId !== 'string' || !isValidUuid(payload.eventId)) {
    throw new ValidationError(`Invalid eventId in photo job payload: "${payload.eventId}"`);
  }

  return {
    mediaId: payload.mediaId,
    eventId: payload.eventId,
    version: payload.version ?? 1,
    jobVersion: payload.jobVersion ?? 1,
    timestamp: payload.timestamp ?? Date.now(),
    correlationId: payload.correlationId,
  };
}

/**
 * Validates video processing job payload.
 */
export function validateVideoJobPayload(data: unknown): VideoProcessingJobPayload {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Job payload must be an object');
  }

  const payload = data as Partial<VideoProcessingJobPayload>;

  if (!payload.mediaId || typeof payload.mediaId !== 'string' || !isValidUuid(payload.mediaId)) {
    throw new ValidationError(`Invalid mediaId in video job payload: "${payload.mediaId}"`);
  }

  if (!payload.eventId || typeof payload.eventId !== 'string' || !isValidUuid(payload.eventId)) {
    throw new ValidationError(`Invalid eventId in video job payload: "${payload.eventId}"`);
  }

  return {
    mediaId: payload.mediaId,
    eventId: payload.eventId,
    version: payload.version ?? 1,
    jobVersion: payload.jobVersion ?? 1,
    timestamp: payload.timestamp ?? Date.now(),
    correlationId: payload.correlationId,
  };
}

/**
 * Validates gallery expiry job payload.
 */
export function validateGalleryExpiryJobPayload(data: unknown): GalleryExpiryJobPayload {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Job payload must be an object');
  }

  const payload = data as Partial<GalleryExpiryJobPayload>;

  if (!payload.eventId || typeof payload.eventId !== 'string' || !isValidUuid(payload.eventId)) {
    throw new ValidationError(`Invalid eventId in gallery expiry job payload: "${payload.eventId}"`);
  }

  return {
    eventId: payload.eventId,
    expectedExpiresAt: payload.expectedExpiresAt,
    timestamp: payload.timestamp ?? Date.now(),
  };
}

/**
 * Validates zip generation job payload.
 */
export function validateZipJobPayload(data: unknown): ZipGenerationJobPayload {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Job payload must be an object');
  }

  const payload = data as Partial<ZipGenerationJobPayload>;

  if (!payload.jobId || typeof payload.jobId !== 'string' || !isValidUuid(payload.jobId)) {
    throw new ValidationError(`Invalid jobId in zip generation job payload: "${payload.jobId}"`);
  }

  if (!payload.eventId || typeof payload.eventId !== 'string' || !isValidUuid(payload.eventId)) {
    throw new ValidationError(`Invalid eventId in zip generation job payload: "${payload.eventId}"`);
  }

  return {
    jobId: payload.jobId,
    eventId: payload.eventId,
    mediaIds: payload.mediaIds,
    timestamp: payload.timestamp ?? Date.now(),
  };
}
