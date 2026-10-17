/**
 * Cloudflare R2 Storage Contracts & Key Conventions
 */

export const STORAGE_CATEGORIES = [
  'originals',
  'previews',
  'thumbnails',
  'videos',
  'exports',
] as const;

export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export interface StorageObjectMetadata {
  key: string;
  sizeBytes: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  customMetadata?: Record<string, string>;
}

export interface PresignedPutOptions {
  key: string;
  contentType: string;
  contentLength?: number;
  expiresInSeconds?: number;
  customMetadata?: Record<string, string>;
}

export interface PresignedGetOptions {
  key: string;
  expiresInSeconds?: number;
  responseContentDisposition?: string;
}

export interface PresignedUrlResult {
  url: string;
  key: string;
  expiresInSeconds: number;
  expiresAt: string;
}

export interface BucketAccessResult {
  accessible: boolean;
  bucketName: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Standard 8-4-4-4-12 hex UUID pattern
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/**
 * Validates that a string is a valid UUID
 */
export function isValidUuid(str: string): boolean {
  return UUID_REGEX.test(str);
}

/**
 * Validates storage category
 */
export function isValidStorageCategory(category: string): category is StorageCategory {
  return (STORAGE_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Sanitizes a filename, preventing directory traversal and null byte injections.
 * Allows alphanumeric, hyphens, underscores, dots.
 */
export function sanitizeStorageFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Filename must be a non-empty string');
  }

  // Reject null bytes, path traversal sequences
  if (filename.includes('\0') || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Filename contains invalid path characters or traversal sequences');
  }

  const trimmed = filename.trim();
  if (trimmed.length === 0 || trimmed.length > 255 || trimmed === '.' || trimmed === '..') {
    throw new Error('Filename length must be between 1 and 255 characters and cannot be "." or ".."');
  }

  return trimmed;
}

/**
 * Generates a deterministic, event-partitioned storage key.
 * Pattern: events/{eventId}/{category}/{filename}
 */
export function buildStorageKey(
  eventId: string,
  category: StorageCategory,
  filename: string
): string {
  if (!isValidUuid(eventId)) {
    throw new Error(`Invalid eventId for storage key: must be a valid UUID`);
  }

  if (!isValidStorageCategory(category)) {
    throw new Error(`Invalid storage category: ${category}. Allowed: ${STORAGE_CATEGORIES.join(', ')}`);
  }

  const cleanFilename = sanitizeStorageFilename(filename);
  return `events/${eventId}/${category}/${cleanFilename}`;
}

/**
 * Parses and verifies an existing deterministic storage key.
 * Returns eventId, category, and filename or null if malformed.
 */
export function parseStorageKey(
  key: string
): { eventId: string; category: StorageCategory; filename: string } | null {
  if (!key || typeof key !== 'string') {
    return null;
  }

  // Reject path traversal, leading/trailing slashes, backslashes, null bytes
  if (key.includes('..') || key.includes('\\') || key.includes('\0') || key.startsWith('/') || key.endsWith('/')) {
    return null;
  }

  const parts = key.split('/');
  if (parts.length !== 4) {
    return null;
  }

  const [prefix, eventId, category, filename] = parts;

  if (prefix !== 'events') {
    return null;
  }

  if (!isValidUuid(eventId)) {
    return null;
  }

  if (!isValidStorageCategory(category)) {
    return null;
  }

  try {
    const cleanFilename = sanitizeStorageFilename(filename);
    if (cleanFilename !== filename) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    eventId,
    category,
    filename,
  };
}

/**
 * Checks if a string conforms to the deterministic storage key format.
 */
export function isValidStorageKey(key: string): boolean {
  return parseStorageKey(key) !== null;
}

/**
 * Phase 9: Storage Management & Usage Breakdown Contracts
 */
export interface StorageBreakdown {
  originalPhotosBytes: number;
  derivedImagesBytes: number;
  videosBytes: number;
  otherBytes: number;
  originalVideosBytes?: number;
  playbackRenditionBytes?: number;
  posterImageBytes?: number;
}

export interface StorageMediaCounts {
  photos: number;
  videos: number;
  total: number;
}

export interface StorageEventSummary {
  eventId: string;
  eventName: string;
  slug: string;
  status: string;
  totalBytes: number;
  originalBytes: number;
  derivedBytes: number;
  videoBytes?: number;
  photoCount: number;
  videoCount: number;
  lastCalculatedAt: string | null;
}

export interface StorageR2Info {
  configured: boolean;
  bucketName: string | null;
  status: 'healthy' | 'unconfigured' | 'error';
  managementUrl: string;
  billingUrl: string;
}

export interface StorageUsageSummary {
  source: 'application_metadata' | 'application_media_records';
  totalBytes: number;
  breakdown: StorageBreakdown;
  mediaCounts: StorageMediaCounts;
  calculatedAt: string;
  isStale: boolean;
  r2: StorageR2Info;
  events: StorageEventSummary[];
}
