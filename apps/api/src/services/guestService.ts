import bcrypt from 'bcryptjs';
import { query } from '../infrastructure/database.js';
import {
  EventNotFoundError,
  AuthorizationError,
  GalleryExpiredError,
  ValidationError,
  InvalidEventPinError,
  PinConfigurationError,
  PinRateLimitError,
} from '@photography-saas/errors';
import type {
  GuestEventMetadataDTO,
  VerifyPinResponseDTO,
} from '@photography-saas/types';
import {
  createGuestSession,
  GUEST_SESSION_TTL_HOURS,
} from './guestSessionService.js';
import { performDummyCompare } from './authService.js';
import { isEventExpired } from './galleryExpiryService.js';
import {
  checkPinRateLimit,
  recordFailedPinAttempt,
  clearPinRateLimit,
} from '../middleware/pinRateLimiter.js';
import { log } from '../middleware/logger.js';

export const PIN_FORMAT_REGEX = /^\d{4,8}$/;

/**
 * Resolves safe public event metadata for guest viewing.
 * Strips all sensitive credentials, internal hashes, and owner identifiers.
 */
export async function getGuestEventBySlug(slug: string): Promise<GuestEventMetadataDTO> {
  const res = await query<{
    id: string;
    slug: string;
    name: string;
    client_name: string;
    event_date: string;
    location: string | null;
    description: string | null;
    status: string;
    visibility: string;
    public_until: string | null;
    pin_enabled: boolean;
    pin_hash: string | null;
    allow_downloads: boolean;
    watermark_enabled: boolean;
    watermark_text: string | null;
    face_search_enabled: boolean;
    cover_photo_id: string | null;
    cover_preview_key: string | null;
    photographer_name: string;
    photographer_tagline: string | null;
    photographer_instagram: string | null;
    photographer_website: string | null;
  }>(
    `SELECT 
       e.id, e.slug, e.name, e.client_name, e.event_date, e.location,
       e.description, e.status, e.visibility, e.public_until,
       e.pin_enabled, e.pin_hash, e.allow_downloads, e.watermark_enabled,
       e.watermark_text, e.face_search_enabled, e.cover_photo_id,
       m.storage_key_preview as cover_preview_key,
       p.business_name as photographer_name,
       p.tagline as photographer_tagline,
       p.instagram as photographer_instagram,
       p.website as photographer_website
     FROM events e
     JOIN photographer p ON p.id = e.owner_id
     LEFT JOIN media m ON m.id = e.cover_photo_id
     WHERE e.slug = $1
     LIMIT 1`,
    [slug.trim()]
  );

  if (res.rows.length === 0) {
    throw new EventNotFoundError(`Gallery "${slug}" not found`);
  }

  const row = res.rows[0];

  // 1. Status & Visibility Check
  if (row.status !== 'active' || row.visibility !== 'public') {
    throw new AuthorizationError('This gallery is currently private.');
  }

  // 2. Expiration Check
  const expired = isEventExpired(row.public_until);
  if (expired) {
    throw new GalleryExpiredError('The public viewing period for this gallery has expired.');
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    client_name: row.client_name,
    event_date: typeof row.event_date === 'string' ? row.event_date : new Date(row.event_date).toISOString().split('T')[0],
    location: row.location,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    public_until: row.public_until ? new Date(row.public_until).toISOString() : null,
    is_expired: expired,
    pin_protected: Boolean(row.pin_enabled),
    allow_downloads: Boolean(row.allow_downloads),
    watermark_enabled: Boolean(row.watermark_enabled),
    watermark_text: row.watermark_text,
    face_search_enabled: Boolean(row.face_search_enabled),
    cover_photo_id: row.cover_photo_id,
    cover_preview_url: row.cover_preview_key ? `/api/media/preview/${row.id}/${row.cover_photo_id}` : null,
    photographer: {
      business_name: row.photographer_name,
      tagline: row.photographer_tagline,
      instagram: row.photographer_instagram,
      website: row.photographer_website,
    },
  };
}

/**
 * Verifies guest-submitted PIN for an event by slug or UUID:
 * 1. Resolves event and confirms public visibility.
 * 2. Checks PIN protection enabled.
 * 3. Enforces brute force rate limiting (5 attempts per IP + event in 15 min).
 * 4. Verifies salted bcrypt hash, preserving leading zeros.
 * 5. Issues signed JWT and records session hash in PostgreSQL.
 */
export async function verifyGuestPin(
  slugOrId: string,
  submittedPin: string,
  clientIp?: string
): Promise<VerifyPinResponseDTO> {
  // Resolve event by slug or ID
  const res = await query<{
    id: string;
    slug: string;
    name: string;
    status: string;
    visibility: string;
    public_until: string | null;
    pin_enabled: boolean;
    pin_hash: string | null;
  }>(
    `SELECT id, slug, name, status, visibility, public_until, pin_enabled, pin_hash
     FROM events
     WHERE slug = $1 OR id::text = $1
     LIMIT 1`,
    [slugOrId.trim()]
  );

  if (res.rows.length === 0) {
    await performDummyCompare(submittedPin || '0000');
    throw new EventNotFoundError('Gallery not found');
  }

  const event = res.rows[0];

  // Check status & visibility
  if (event.status !== 'active' || event.visibility !== 'public') {
    await performDummyCompare(submittedPin || '0000');
    throw new AuthorizationError('This gallery is currently private.');
  }

  if (isEventExpired(event.public_until)) {
    await performDummyCompare(submittedPin || '0000');
    throw new GalleryExpiredError('The public viewing period for this gallery has expired.');
  }

  // If PIN protection is not enabled, grant immediate access
  if (!event.pin_enabled) {
    const session = await createGuestSession(event.id, clientIp);
    return {
      success: true,
      guestToken: session.token,
      expiresInSeconds: GUEST_SESSION_TTL_HOURS * 3600,
      eventId: event.id,
    };
  }

  // Fails closed if PIN enabled but pin_hash is missing
  if (!event.pin_hash) {
    throw new PinConfigurationError('This gallery has PIN protection enabled but has no valid PIN configured.');
  }

  // Enforce rate limiting
  const ip = clientIp || 'unknown';
  const rateLimitStatus = checkPinRateLimit(ip, event.id);
  if (!rateLimitStatus.allowed) {
    throw new PinRateLimitError(
      `Too many incorrect PIN attempts. Please wait ${Math.ceil(rateLimitStatus.retryAfterSeconds / 60)} minutes before trying again.`,
      rateLimitStatus.retryAfterSeconds
    );
  }

  // Format validation: must be 4 to 8 numeric digits
  const pin = typeof submittedPin === 'string' ? submittedPin.trim() : '';
  if (!pin || !PIN_FORMAT_REGEX.test(pin)) {
    const failed = recordFailedPinAttempt(ip, event.id);
    if (failed.remainingAttempts === 0) {
      throw new PinRateLimitError(
        `Too many incorrect PIN attempts. Please wait ${Math.ceil(failed.retryAfterSeconds / 60)} minutes before trying again.`,
        failed.retryAfterSeconds
      );
    }
    throw new ValidationError('PIN must consist of 4 to 8 numeric digits.');
  }

  // Constant-time salted bcrypt comparison
  const isMatch = await bcrypt.compare(pin, event.pin_hash);
  if (!isMatch) {
    const failed = recordFailedPinAttempt(ip, event.id);
    if (failed.remainingAttempts === 0) {
      throw new PinRateLimitError(
        `Too many incorrect PIN attempts. Please wait ${Math.ceil(failed.retryAfterSeconds / 60)} minutes before trying again.`,
        failed.retryAfterSeconds
      );
    }
    throw new InvalidEventPinError('Incorrect PIN. Please try again.');
  }

  // Success: clear rate limit and issue session
  clearPinRateLimit(ip, event.id);
  const session = await createGuestSession(event.id, clientIp);

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Guest PIN verified successfully for event "${event.name}" (${event.id})`,
    details: { eventId: event.id, slug: event.slug },
  });

  return {
    success: true,
    guestToken: session.token,
    expiresInSeconds: GUEST_SESSION_TTL_HOURS * 3600,
    eventId: event.id,
  };
}

export interface GuestGalleryPaginationOptions {
  page?: number;
  limit?: number;
  cursor?: string | null;
}

export interface GuestGalleryMediaResult {
  folders: any[];
  media: any[];
  totalCount: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Encodes keyset cursor (created_at ISO string and UUID) to base64.
 */
function encodeCursor(createdAt: string | Date, id: string): string {
  const ts = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
  return Buffer.from(JSON.stringify({ createdAt: ts, id })).toString('base64');
}

/**
 * Decodes base64 keyset cursor. Returns null if malformed.
 */
function decodeCursor(cursorStr?: string | null): { createdAt: string; id: string } | null {
  if (!cursorStr) return null;
  try {
    const raw = Buffer.from(cursorStr, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // Return null on malformed cursor
  }
  return null;
}

/**
 * Retrieves folders and ready media for an event (guest gallery view) with
 * high-performance server-side cursor/offset pagination and stable tie-breaker.
 */
export async function getGuestGalleryMedia(
  eventId: string,
  folderId?: string | null,
  options?: GuestGalleryPaginationOptions
): Promise<GuestGalleryMediaResult> {
  // Folders with count of ready media (indexed by idx_media_folder_status)
  const foldersRes = await query(
    `SELECT f.id, f.name, f.sort_order, f.created_at,
            COUNT(m.id)::int as photo_count
     FROM folders f
     LEFT JOIN media m ON m.folder_id = f.id AND m.status = 'ready'
     WHERE f.event_id = $1
     GROUP BY f.id
     ORDER BY f.sort_order ASC, f.created_at ASC`,
    [eventId]
  );

  // Pagination parameters
  const page = Math.max(1, options?.page ?? 1);
  const isUnlimited = options?.limit === 0 || options?.limit === -1;
  const requestedLimit = options?.limit !== undefined && options.limit > 0 ? options.limit : 50;
  const limit = Math.min(200, Math.max(1, requestedLimit));

  const decodedCursor = decodeCursor(options?.cursor);

  // Build WHERE conditions for media
  const conditions: string[] = ['m.event_id = $1', "m.status = 'ready'"];
  const params: any[] = [eventId];

  if (folderId && folderId !== 'all') {
    if (folderId === 'uncategorized') {
      conditions.push('m.folder_id IS NULL');
    } else {
      params.push(folderId);
      conditions.push(`m.folder_id = $${params.length}`);
    }
  }

  // Count total ready media matching event + folder criteria
  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM media m
    WHERE ${conditions.join(' AND ')}
  `;
  const countRes = await query<{ total: number }>(countSql, params);
  const totalCount = countRes.rows[0]?.total ?? 0;

  // Keyset cursor condition for pagination
  if (decodedCursor) {
    params.push(decodedCursor.createdAt, decodedCursor.id);
    const tsIdx = params.length - 1;
    const idIdx = params.length;
    conditions.push(
      `(m.created_at > $${tsIdx}::timestamptz OR (m.created_at = $${tsIdx}::timestamptz AND m.id > $${idIdx}))`
    );
  }

  let mediaSql = `
    SELECT m.id, m.event_id, m.folder_id, m.type, m.filename, m.original_name,
           m.file_size, m.width, m.height, m.storage_key_preview,
           m.storage_key_thumbnail, m.camera_make, m.camera_model,
           m.date_taken, m.created_at, f.name as folder_name
    FROM media m
    LEFT JOIN folders f ON f.id = m.folder_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY m.created_at ASC, m.id ASC
  `;

  if (!isUnlimited) {
    // Fetch limit + 1 to detect next page availability
    params.push(limit + 1);
    const limitIdx = params.length;

    if (!decodedCursor) {
      const offset = (page - 1) * limit;
      params.push(offset);
      const offsetIdx = params.length;
      mediaSql += ` LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    } else {
      mediaSql += ` LIMIT $${limitIdx}`;
    }
  }

  const mediaRes = await query(mediaSql, params);
  const rows = mediaRes.rows;

  let hasMore = false;
  let nextCursor: string | null = null;

  if (!isUnlimited && rows.length > limit) {
    hasMore = true;
    rows.pop(); // Remove extra peek row
  } else if (!isUnlimited && !decodedCursor) {
    hasMore = page * limit < totalCount;
  }

  if (rows.length > 0) {
    const lastItem = rows[rows.length - 1];
    nextCursor = hasMore ? encodeCursor(lastItem.created_at, lastItem.id) : null;
  }

  return {
    folders: foldersRes.rows,
    media: rows,
    totalCount,
    page,
    limit: isUnlimited ? totalCount : limit,
    hasMore,
    nextCursor,
  };
}
