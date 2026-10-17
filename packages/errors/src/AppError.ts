import type { ApiErrorResponse } from '@photography-saas/types';

/**
 * Base Application Error
 * All domain and infrastructure errors extend this class.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
    isOperational = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    // Capture standard stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Formats this error into the standard API error response envelope.
   */
  public toResponse(requestId: string): ApiErrorResponse {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        requestId,
      },
    };
  }
}

/**
 * 400 Bad Request / Schema Validation Error
 */
export class ValidationError extends AppError {
  constructor(message = 'Invalid request parameters', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

/**
 * 401 Unauthorized / Unauthenticated Error
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(401, 'AUTHENTICATION_REQUIRED', message, details);
  }
}

/**
 * 403 Forbidden / Access Denied Error
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Access forbidden to requested resource', details?: unknown) {
    super(403, 'FORBIDDEN', message, details);
  }
}

/**
 * 404 Not Found Error
 */
export class NotFoundError extends AppError {
  constructor(message = 'Requested resource not found', details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
  }
}

/**
 * 409 Conflict Error
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource state conflict', details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

/**
 * 410 Gone / Gallery Expired Error
 */
export class GalleryExpiredError extends AppError {
  constructor(message = 'The public viewing window for this gallery has expired', details?: unknown) {
    super(410, 'GALLERY_EXPIRED', message, details);
  }
}

/**
 * 404 Event Not Found Error
 */
export class EventNotFoundError extends AppError {
  constructor(message = 'Event not found or access denied', details?: unknown) {
    super(404, 'EVENT_NOT_FOUND', message, details);
  }
}

/**
 * 409 Slug Already Exists Conflict Error
 */
export class SlugAlreadyExistsError extends AppError {
  constructor(message = 'An event with this URL slug already exists', details?: unknown) {
    super(409, 'SLUG_ALREADY_EXISTS', message, details);
  }
}

/**
 * 400 Public Window Exceeded Error
 */
export class PublicWindowExceededError extends AppError {
  constructor(message = 'Public visibility period cannot exceed the maximum limit of 30 days', details?: unknown) {
    super(400, 'PUBLIC_WINDOW_EXCEEDED', message, details);
  }
}

/**
 * 400 Invalid Lifecycle Transition Error
 */
export class InvalidLifecycleTransitionError extends AppError {
  constructor(message = 'Invalid event lifecycle state transition', details?: unknown) {
    super(400, 'INVALID_LIFECYCLE_TRANSITION', message, details);
  }
}

/**
 * 429 Too Many Requests / Rate Limit Error
 */
export class RateLimitError extends AppError {
  public readonly retryAfterSeconds: number;

  constructor(
    message = 'Too many requests. Please try again later.',
    retryAfterSeconds = 900,
    details?: unknown
  ) {
    super(429, 'RATE_LIMITED', message, details);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * 404 Folder Not Found Error
 */
export class FolderNotFoundError extends AppError {
  constructor(message = 'Folder not found or does not belong to this event', details?: unknown) {
    super(404, 'FOLDER_NOT_FOUND', message, details);
  }
}

/**
 * 409 Folder Name Conflict Error
 */
export class FolderNameConflictError extends AppError {
  constructor(message = 'A folder with this name already exists in this event', details?: unknown) {
    super(409, 'FOLDER_NAME_CONFLICT', message, details);
  }
}

/**
 * 400 Invalid Target Folder Error
 */
export class InvalidTargetFolderError extends AppError {
  constructor(message = 'Target folder does not exist or does not belong to this event', details?: unknown) {
    super(400, 'INVALID_TARGET_FOLDER', message, details);
  }
}

/**
 * 404 Media Not Found Error
 */
export class MediaNotFoundError extends AppError {
  constructor(message = 'Media asset not found or does not belong to this event', details?: unknown) {
    super(404, 'MEDIA_NOT_FOUND', message, details);
  }
}

/**
 * 415 Unsupported Media Type Error
 */
export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Unsupported media format for upload', details?: unknown) {
    super(415, 'UNSUPPORTED_MEDIA_TYPE', message, details);
  }
}

/**
 * 413 File Too Large Error
 */
export class FileTooLargeError extends AppError {
  constructor(message = 'File exceeds maximum permitted upload size', details?: unknown) {
    super(413, 'FILE_TOO_LARGE', message, details);
  }
}

/**
 * 400 Batch Limit Exceeded Error
 */
export class BatchLimitExceededError extends AppError {
  constructor(message = 'Batch size exceeds maximum permitted items', details?: unknown) {
    super(400, 'BATCH_LIMIT_EXCEEDED', message, details);
  }
}

/**
 * 400 Upload Verification Failed Error
 */
export class UploadVerificationFailedError extends AppError {
  constructor(message = 'Uploaded media object could not be verified in storage', details?: unknown) {
    super(400, 'UPLOAD_VERIFICATION_FAILED', message, details);
  }
}

/**
 * 403 Event Access Denied Error
 */
export class EventAccessDeniedError extends AppError {
  constructor(message = 'Access denied to the requested event', details?: unknown) {
    super(403, 'EVENT_ACCESS_DENIED', message, details);
  }
}

/**
 * 500 Storage Error
 */
export class StorageError extends AppError {
  constructor(message = 'Storage operation failure', details?: unknown) {
    super(500, 'STORAGE_ERROR', message, details, false);
  }
}

/**
 * 503 Storage Configuration Missing Error
 */
export class StorageConfigError extends AppError {
  constructor(message = 'Cloudflare R2 storage is not properly configured', details?: unknown) {
    super(503, 'STORAGE_CONFIG_MISSING', message, details, true);
  }
}

/**
 * 502 Storage Authentication Failed Error
 */
export class StorageAuthenticationError extends AppError {
  constructor(message = 'Storage authentication failed. Verify R2 credentials.', details?: unknown) {
    super(502, 'STORAGE_AUTH_FAILED', message, details, false);
  }
}

/**
 * 403 Storage Permission Denied Error
 */
export class StoragePermissionError extends AppError {
  constructor(message = 'Permission denied for storage operation on configured bucket.', details?: unknown) {
    super(403, 'STORAGE_PERMISSION_DENIED', message, details, false);
  }
}

/**
 * 502 Storage Bucket Not Found Error
 */
export class StorageBucketNotFoundError extends AppError {
  constructor(message = 'Configured storage bucket does not exist or is inaccessible.', details?: unknown) {
    super(502, 'STORAGE_BUCKET_NOT_FOUND', message, details, false);
  }
}

/**
 * 404 Storage Object Not Found Error
 */
export class StorageObjectNotFoundError extends AppError {
  constructor(message = 'Requested storage object does not exist.', details?: unknown) {
    super(404, 'STORAGE_OBJECT_NOT_FOUND', message, details, true);
  }
}

/**
 * 504 Storage Timeout Error
 */
export class StorageTimeoutError extends AppError {
  constructor(message = 'Storage operation timed out.', details?: unknown) {
    super(504, 'STORAGE_TIMEOUT', message, details, true);
  }
}

/**
 * 502 Storage Network Error
 */
export class StorageNetworkError extends AppError {
  constructor(message = 'Failed to connect to storage service.', details?: unknown) {
    super(502, 'STORAGE_NETWORK_ERROR', message, details, true);
  }
}

/**
 * 429 Storage Rate Limited Error
 */
export class StorageRateLimitError extends AppError {
  constructor(message = 'Storage service rate limit reached. Please retry later.', details?: unknown) {
    super(429, 'STORAGE_RATE_LIMITED', message, details, true);
  }
}

/**
 * 400 Storage Key Invalid Error
 */
export class StorageKeyInvalidError extends AppError {
  constructor(message = 'Invalid storage object key format.', details?: unknown) {
    super(400, 'STORAGE_KEY_INVALID', message, details, true);
  }
}

/**
 * Normalizes AWS S3 / Cloudflare R2 SDK errors into typed AppErrors.
 */
export function normalizeStorageError(error: unknown, context?: Record<string, unknown>): AppError {
  if (isAppError(error)) {
    return error;
  }

  const err = error as Record<string, unknown> | null;
  const name = typeof err?.name === 'string' ? err.name : '';
  const message = typeof err?.message === 'string' ? err.message : '';
  const code = typeof err?.code === 'string' ? err.code : '';
  const statusCode =
    typeof err?.$metadata === 'object' && err?.$metadata !== null
      ? ((err.$metadata as Record<string, unknown>).httpStatusCode as number | undefined)
      : undefined;

  // Object not found (404 / NotFound / NoSuchKey)
  if (name === 'NoSuchKey' || name === 'NotFound' || statusCode === 404) {
    return new StorageObjectNotFoundError(undefined, context);
  }

  // Bucket not found (NoSuchBucket)
  if (name === 'NoSuchBucket') {
    return new StorageBucketNotFoundError(undefined, context);
  }

  // Auth / Signature error
  if (
    name === 'InvalidAccessKeyId' ||
    name === 'SignatureDoesNotMatch' ||
    name === 'InvalidSecurity' ||
    name === 'AuthFailure'
  ) {
    return new StorageAuthenticationError(undefined, context);
  }

  // Permission / Access Denied
  if (name === 'AccessDenied' || statusCode === 403) {
    return new StoragePermissionError(undefined, context);
  }

  // Timeout
  if (
    name === 'TimeoutError' ||
    name === 'RequestTimeout' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    statusCode === 504 ||
    statusCode === 408
  ) {
    return new StorageTimeoutError(undefined, context);
  }

  // Network / DNS error
  if (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    message.includes('fetch failed')
  ) {
    return new StorageNetworkError(undefined, context);
  }

  // Rate Limiting / SlowDown
  if (name === 'SlowDown' || name === 'TooManyRequests' || statusCode === 429 || statusCode === 503) {
    return new StorageRateLimitError(undefined, context);
  }

  // Fallback storage error
  return new StorageError(message || 'Storage operation failed', context);
}

/**
 * 500 Processing Error
 */
export class ProcessingError extends AppError {
  constructor(message = 'Media processing failure', details?: unknown) {
    super(500, 'PROCESSING_ERROR', message, details, false);
  }
}

/**
 * 422 Corrupt or Unreadable Image Error
 */
export class CorruptImageError extends AppError {
  constructor(message = 'The provided image file is corrupt or cannot be decoded.', details?: unknown) {
    super(422, 'CORRUPT_IMAGE', message, details);
  }
}

/**
 * 422 Decompression Bomb / Excessive Dimensions Error
 */
export class DecompressionBombError extends AppError {
  constructor(message = 'Image pixel dimensions exceed maximum allowed safety threshold (50 Megapixels).', details?: unknown) {
    super(422, 'DECOMPRESSION_BOMB_DETECTED', message, details);
  }
}

/**
 * 500 Image Processing Pipeline Error
 */
export class ImageProcessingError extends AppError {
  constructor(message = 'Image processing pipeline failed to generate derivatives.', details?: unknown) {
    super(500, 'IMAGE_PROCESSING_FAILED', message, details, false);
  }
}

/**
 * 422 Corrupt or Unreadable Video Error
 */
export class CorruptVideoError extends AppError {
  constructor(message = 'The provided video file is corrupt or cannot be probed.', details?: unknown) {
    super(422, 'CORRUPT_VIDEO', message, details);
  }
}

/**
 * 422 Unsupported Video Codec or Stream Configuration
 */
export class UnsupportedVideoCodecError extends AppError {
  constructor(message = 'The video stream uses an unsupported codec.', details?: unknown) {
    super(422, 'UNSUPPORTED_VIDEO_CODEC', message, details);
  }
}

/**
 * 422 Video Duration Exceeds Policy Limit
 */
export class VideoDurationExceededError extends AppError {
  constructor(message = 'Video duration exceeds maximum allowed limit.', details?: unknown) {
    super(422, 'VIDEO_DURATION_EXCEEDED', message, details);
  }
}

/**
 * 422 Video Dimensions Exceed Policy Limit
 */
export class VideoDimensionsExceededError extends AppError {
  constructor(message = 'Video resolution exceeds maximum allowed dimensions.', details?: unknown) {
    super(422, 'VIDEO_DIMENSIONS_EXCEEDED', message, details);
  }
}

/**
 * 500 Video Processing Pipeline Error
 */
export class VideoProcessingError extends AppError {
  constructor(message = 'Video processing pipeline failed during probe, poster extraction, or transcoding.', details?: unknown) {
    super(500, 'VIDEO_PROCESSING_FAILED', message, details, false);
  }
}

/**
 * 422 Face Search: No face detected in query selfie
 */
export class NoFaceDetectedError extends AppError {
  constructor(message = 'No face detected in selfie. Please submit a clear, well-lit photo of your face.', details?: unknown) {
    super(422, 'NO_FACE_DETECTED', message, details);
  }
}

/**
 * 422 Face Search: Multiple faces detected in query selfie
 */
export class MultipleFacesDetectedError extends AppError {
  constructor(message = 'Multiple faces detected. Please submit a selfie containing only one person.', details?: unknown) {
    super(422, 'MULTIPLE_FACES_DETECTED', message, details);
  }
}

/**
 * 400 Face Search: Invalid selfie format, corrupt image, or size limit exceeded
 */
export class InvalidSelfieError extends AppError {
  constructor(message = 'Invalid selfie image format or payload.', details?: unknown) {
    super(400, 'INVALID_SELFIE', message, details);
  }
}

/**
 * 403 Face Search: Disabled for requested event
 */
export class FaceSearchDisabledError extends AppError {
  constructor(message = 'Face search is disabled for this event.', details?: unknown) {
    super(403, 'FACE_SEARCH_DISABLED', message, details);
  }
}

/**
 * 429 Too Many Requests: Face Search Rate Limit Exceeded
 */
export class FaceSearchRateLimitError extends AppError {
  public readonly retryAfterSeconds: number;

  constructor(message = 'Too many face search requests. Please wait a moment before trying again.', retryAfterSeconds = 60, details?: unknown) {
    super(429, 'FACE_SEARCH_RATE_LIMITED', message, details);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * 401 Unauthorized: Event PIN Required
 */
export class EventPinRequiredError extends AppError {
  constructor(message = 'Event PIN required to access this gallery.', details?: unknown) {
    super(401, 'EVENT_PIN_REQUIRED', message, details);
  }
}

/**
 * 401 Unauthorized: Invalid or Incorrect Event PIN
 */
export class InvalidEventPinError extends AppError {
  constructor(message = 'Incorrect PIN. Please try again.', details?: unknown) {
    super(401, 'INVALID_EVENT_PIN', message, details);
  }
}

/**
 * 429 Too Many Requests: Event PIN Rate Limit Exceeded (Brute-force protection)
 */
export class PinRateLimitError extends AppError {
  public readonly retryAfterSeconds: number;

  constructor(
    message = 'Too many incorrect PIN attempts. Please wait before trying again.',
    retryAfterSeconds = 900,
    details?: unknown
  ) {
    super(429, 'PIN_RATE_LIMITED', message, details);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * 403 Forbidden: Inconsistent Event PIN Configuration (Fails closed)
 */
export class PinConfigurationError extends AppError {
  constructor(message = 'This gallery has PIN protection enabled but is not properly configured.', details?: unknown) {
    super(403, 'PIN_CONFIGURATION_ERROR', message, details);
  }
}

/**
 * 403 Forbidden: Downloads Disabled for Event
 */
export class DownloadsDisabledError extends AppError {
  constructor(message = 'Downloads are disabled for this gallery.', details?: unknown) {
    super(403, 'DOWNLOADS_DISABLED', message, details);
  }
}

/**
 * 404 Not Found: Download Job Not Found
 */
export class DownloadJobNotFoundError extends AppError {
  constructor(message = 'Download job not found or has expired.', details?: unknown) {
    super(404, 'DOWNLOAD_JOB_NOT_FOUND', message, details);
  }
}

/**
 * 400 Bad Request: Download Selection Limit Exceeded
 */
export class DownloadLimitExceededError extends AppError {
  constructor(message = 'Selection exceeds maximum download limit.', details?: unknown) {
    super(400, 'DOWNLOAD_LIMIT_EXCEEDED', message, details);
  }
}

/**
 * 400 Bad Request: No Media Selected
 */
export class NoMediaSelectedError extends AppError {
  constructor(message = 'No valid ready media items available for download.', details?: unknown) {
    super(400, 'NO_MEDIA_SELECTED', message, details);
  }
}

/**
 * 400 Bad Request: Media Not Ready for Download
 */
export class MediaNotReadyForDownloadError extends AppError {
  constructor(message = 'Requested media item is not ready for download.', details?: unknown) {
    super(400, 'MEDIA_NOT_READY', message, details);
  }
}

/**
 * 403 Forbidden: Storage Quota Exceeded
 */
export class StorageQuotaExceededError extends AppError {
  constructor(message = 'Photographer storage quota exceeded. Please upgrade your plan or purchase storage add-ons.', details?: unknown) {
    super(403, 'STORAGE_QUOTA_EXCEEDED', message, details);
  }
}

/**
 * 403 Forbidden: Plan Limit Exceeded (e.g. max events, max face searches)
 */
export class PlanLimitExceededError extends AppError {
  constructor(message = 'Current plan limit exceeded for this operation.', details?: unknown) {
    super(403, 'PLAN_LIMIT_EXCEEDED', message, details);
  }
}

/**
 * 402 Payment Required: Active Subscription Required
 */
export class SubscriptionRequiredError extends AppError {
  constructor(message = 'An active subscription is required to perform this action.', details?: unknown) {
    super(402, 'SUBSCRIPTION_REQUIRED', message, details);
  }
}

/**
 * 400 Bad Request: Payment Processing Failed
 */
export class PaymentFailedError extends AppError {
  constructor(message = 'Payment processing failed or was declined.', details?: unknown) {
    super(400, 'PAYMENT_FAILED', message, details);
  }
}

/**
 * 404 Not Found: Plan Not Found
 */
export class PlanNotFoundError extends AppError {
  constructor(message = 'The requested subscription plan was not found.', details?: unknown) {
    super(404, 'PLAN_NOT_FOUND', message, details);
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalError extends AppError {
  constructor(message = 'An unexpected internal error occurred', details?: unknown) {
    super(500, 'INTERNAL_SERVER_ERROR', message, details, false);
  }
}


/**
 * Type guard to check if an unknown error is an instance of AppError.
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Normalizes an unknown error into a standardized AppError.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  if (error instanceof Error) {
    const internal = new InternalError(error.message);
    internal.stack = error.stack;
    return internal;
  }
  return new InternalError('An unknown error occurred');
}
