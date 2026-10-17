import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../infrastructure/database.js';
import { resolveUniqueSlug } from './slugService.js';
import {
  EventNotFoundError,
  ValidationError,
  PublicWindowExceededError,
  InvalidLifecycleTransitionError,
  ConflictError,
} from '@photography-saas/errors';
import type {
  Event,
  CreateEventDTO,
  UpdateEventDTO,
  EventListItem,
  EventDetail,
  EventListQuery,
  EventStatus,
  WatermarkReprocessStatus,
  WatermarkPosition,
  WatermarkSize,
  WatermarkColor,
  EventQrShareDTO,
  DeleteEventResponseDTO,
} from '@photography-saas/types';
import { log } from '../middleware/logger.js';
import { revokeEventGuestSessions } from './guestSessionService.js';
import {
  calculateExpiryTimestamp,
  isEventExpired,
  validatePublicDurationDays,
  DEFAULT_PUBLIC_DURATION_DAYS,
} from './galleryExpiryService.js';
import { enqueueExpiryJob, enqueuePhotoJob } from './queue/queueManager.js';
import { imageProcessingQueue } from './imageProcessingService.js';
import { generateEventQrCode } from './qrSharingService.js';
import { deleteEventPermanently, getEventDeletionStatus } from './eventDeletionService.js';
import {
  trashEvent,
  restoreEventFromBin,
  listBinEvents,
  emptyBin,
  reconcileExpiredBinEvents,
  calculateDaysRemaining,
} from './recycleBinService.js';

const PIN_REGEX = /^\d{4,8}$/;
const BCRYPT_ROUNDS = 10;
const MAX_PUBLIC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 + 1000; // 30 days + 1s tolerance for leap second / boundary

/**
 * Validates public window start and end dates against the hard 30-day product rule.
 */
export function validatePublicWindow(
  publicStart: string | Date | null | undefined,
  publicUntil: string | Date | null | undefined
): void {
  if (!publicStart && !publicUntil) return;

  if ((publicStart && !publicUntil) || (!publicStart && publicUntil)) {
    throw new ValidationError(
      'Both public_start and public_until must be provided together for public gallery periods.'
    );
  }

  const start = new Date(publicStart!);
  const until = new Date(publicUntil!);

  if (isNaN(start.getTime()) || isNaN(until.getTime())) {
    throw new ValidationError('Invalid date format for public gallery window.');
  }

  if (until.getTime() < start.getTime()) {
    throw new ValidationError('public_until date must be equal to or after public_start.');
  }

  const durationMs = until.getTime() - start.getTime();
  if (durationMs > MAX_PUBLIC_WINDOW_MS) {
    throw new PublicWindowExceededError(
      `Public visibility window cannot exceed the 30-day maximum limit (requested ${Math.ceil(
        durationMs / (1000 * 60 * 60 * 24)
      )} days).`
    );
  }
}

/**
 * Validates numeric PIN format (4 to 8 digits) and returns its salted bcrypt hash.
 */
export async function hashEventPin(pin: string): Promise<string> {
  const trimmed = pin.trim();
  if (!PIN_REGEX.test(trimmed)) {
    throw new ValidationError('Event PIN must consist of exactly 4 to 8 numeric digits (0-9).');
  }
  return bcrypt.hash(trimmed, BCRYPT_ROUNDS);
}

/**
 * Sanitizes a raw database event row into an external-safe EventDetail object.
 * Strips sensitive internal hashes (pin_hash) and owner credentials.
 */
export function formatEventDetail(row: Event): EventDetail {
  const isExpired = isEventExpired(row.public_until);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    client_name: row.client_name,
    client_email: row.client_email,
    event_date: typeof row.event_date === 'string' ? row.event_date : new Date(row.event_date).toISOString().split('T')[0],
    location: row.location,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    public_start: row.public_start ? new Date(row.public_start).toISOString() : null,
    public_until: row.public_until ? new Date(row.public_until).toISOString() : null,
    public_duration_days: row.public_duration_days ?? DEFAULT_PUBLIC_DURATION_DAYS,
    is_expired: isExpired,
    expired_at: row.expired_at ? new Date(row.expired_at).toISOString() : null,
    pin_enabled: row.pin_enabled,
    allow_downloads: row.allow_downloads,
    allow_photo_downloads: row.allow_photo_downloads !== false,
    allow_bulk_downloads: row.allow_bulk_downloads !== false,
    allow_video_downloads: row.allow_video_downloads !== false,
    watermark_enabled: row.watermark_enabled,
    watermark_text: row.watermark_text,
    watermark_opacity: row.watermark_opacity !== undefined ? Number(row.watermark_opacity) : 0.35,
    watermark_size: (row.watermark_size as WatermarkSize) || 'medium',
    watermark_position: (row.watermark_position as WatermarkPosition) || 'bottom-right',
    watermark_color: (row.watermark_color as WatermarkColor) || 'white',
    watermark_version: Number(row.watermark_version || 1),
    face_search_enabled: row.face_search_enabled,
    cover_photo_id: row.cover_photo_id,
    deleted_at: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    purge_after: row.purge_after ? new Date(row.purge_after).toISOString() : null,
    deleted_by: row.deleted_by ?? null,
    days_remaining: row.purge_after ? calculateDaysRemaining(row.purge_after) : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Sanitizes a raw database event row into an EventListItem summary.
 */
export function formatEventListItem(row: Event): EventListItem {
  const isExpired = isEventExpired(row.public_until);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    client_name: row.client_name,
    client_email: row.client_email,
    event_date: typeof row.event_date === 'string' ? row.event_date : new Date(row.event_date).toISOString().split('T')[0],
    location: row.location,
    status: row.status,
    visibility: row.visibility,
    public_start: row.public_start ? new Date(row.public_start).toISOString() : null,
    public_until: row.public_until ? new Date(row.public_until).toISOString() : null,
    public_duration_days: row.public_duration_days ?? DEFAULT_PUBLIC_DURATION_DAYS,
    is_expired: isExpired,
    expired_at: row.expired_at ? new Date(row.expired_at).toISOString() : null,
    pin_enabled: row.pin_enabled,
    allow_downloads: row.allow_downloads,
    allow_photo_downloads: row.allow_photo_downloads !== false,
    allow_bulk_downloads: row.allow_bulk_downloads !== false,
    allow_video_downloads: row.allow_video_downloads !== false,
    watermark_enabled: row.watermark_enabled,
    deleted_at: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    purge_after: row.purge_after ? new Date(row.purge_after).toISOString() : null,
    deleted_by: row.deleted_by ?? null,
    days_remaining: row.purge_after ? calculateDaysRemaining(row.purge_after) : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Creates a new event container with explicit safe defaults.
 */
export async function createEvent(
  ownerId: number,
  input: CreateEventDTO
): Promise<EventDetail> {
  const durationDays = input.public_duration_days !== undefined
    ? validatePublicDurationDays(input.public_duration_days)
    : DEFAULT_PUBLIC_DURATION_DAYS;

  let publicStart = input.public_start;
  let publicUntil = input.public_until;

  // Validate or auto-calculate public window if public visibility requested
  if (input.visibility === 'public') {
    if (!publicStart && !publicUntil) {
      const now = new Date();
      publicStart = now.toISOString();
      publicUntil = calculateExpiryTimestamp(now, durationDays).toISOString();
    }
    validatePublicWindow(publicStart, publicUntil);
  } else if (publicStart || publicUntil) {
    validatePublicWindow(publicStart, publicUntil);
  }

  // Handle PIN hashing
  let pinHash: string | null = null;
  let pinEnabled = input.pin_enabled ?? false;

  if (pinEnabled) {
    if (!input.pin) {
      throw new ValidationError('A PIN code must be provided when PIN protection is enabled.');
    }
    pinHash = await hashEventPin(input.pin);
  }

  // Resolve unique slug
  const slug = await resolveUniqueSlug(input.slug || input.name);

  // Apply safe defaults: private, draft, downloads disabled
  const status = input.status || 'draft';
  const visibility = input.visibility || 'private';
  const allowDownloads = input.allow_downloads ?? false;
  const allowPhotoDownloads = input.allow_photo_downloads ?? true;
  const allowBulkDownloads = input.allow_bulk_downloads ?? true;
  const allowVideoDownloads = input.allow_video_downloads ?? true;
  const coverPhotoId = input.cover_photo_id ?? null;
  const watermarkEnabled = input.watermark_enabled ?? false;
  const watermarkText = input.watermark_text || 'Studio Lumina';
  const watermarkOpacity = input.watermark_opacity ?? 0.35;
  const watermarkSize = input.watermark_size || 'medium';
  const watermarkPosition = input.watermark_position || 'bottom-right';
  const watermarkColor = input.watermark_color || 'white';
  const watermarkVersion = 1;
  const faceSearchEnabled = input.face_search_enabled ?? true;
  const eventId = randomUUID();

  const res = await query<Event>(
    `INSERT INTO events (
      id, owner_id, slug, name, client_name, client_email, event_date,
      location, description, status, visibility, public_start, public_until,
      public_duration_days, pin_enabled, pin_hash, allow_downloads,
      allow_photo_downloads, allow_bulk_downloads, allow_video_downloads,
      cover_photo_id, watermark_enabled, watermark_text, watermark_opacity, watermark_size,
      watermark_position, watermark_color, watermark_version,
      face_search_enabled, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17,
      $18, $19, $20,
      $21, $22, $23, $24, $25,
      $26, $27, $28,
      $29, NOW(), NOW()
    ) RETURNING *`,
    [
      eventId,
      ownerId,
      slug,
      input.name.trim(),
      input.client_name.trim(),
      input.client_email ? input.client_email.trim() : null,
      input.event_date,
      input.location ? input.location.trim() : null,
      input.description ? input.description.trim() : null,
      status,
      visibility,
      publicStart ? new Date(publicStart) : null,
      publicUntil ? new Date(publicUntil) : null,
      durationDays,
      pinEnabled,
      pinHash,
      allowDownloads,
      allowPhotoDownloads,
      allowBulkDownloads,
      allowVideoDownloads,
      coverPhotoId,
      watermarkEnabled,
      watermarkText,
      watermarkOpacity,
      watermarkSize,
      watermarkPosition,
      watermarkColor,
      watermarkVersion,
      faceSearchEnabled,
    ]
  );

  const created = res.rows[0];

  if (created.visibility === 'public' && created.public_until) {
    const delayMs = new Date(created.public_until).getTime() - Date.now();
    void enqueueExpiryJob(
      { eventId: created.id, expectedExpiresAt: new Date(created.public_until).toISOString() },
      delayMs
    ).catch(() => {});
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Event container created: ${created.name} (${created.id})`,
    details: {
      eventId: created.id,
      slug: created.slug,
      ownerId,
      status: created.status,
      visibility: created.visibility,
    },
  });

  return formatEventDetail(created);
}

/**
 * Retrieves a single event detail by ID, strictly enforcing owner authorization.
 */
export async function getEventById(
  eventId: string,
  ownerId: number
): Promise<EventDetail> {
  const res = await query<Event>(
    'SELECT * FROM events WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [eventId, ownerId]
  );

  if (res.rows.length === 0) {
    throw new EventNotFoundError(`Event with ID "${eventId}" not found or unauthorized`);
  }

  return formatEventDetail(res.rows[0]);
}

/**
 * Lists events for the authenticated photographer with optional search and status filtering.
 */
export async function listEvents(
  ownerId: number,
  params: EventListQuery = {}
): Promise<{ events: EventListItem[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['owner_id = $1'];
  const values: any[] = [ownerId];
  let valIndex = 2;

  if (params.status && params.status !== 'all') {
    conditions.push(`status = $${valIndex++}`);
    values.push(params.status);
  } else {
    // Normal active-events view excludes trashed, deleting, and deleted events
    conditions.push("(status != 'trashed' AND status != 'deleting' AND status != 'deleted')");
  }

  if (params.visibility && params.visibility !== 'all') {
    conditions.push(`visibility = $${valIndex++}`);
    values.push(params.visibility);
  }

  if (params.search && params.search.trim()) {
    conditions.push(`(name ILIKE $${valIndex} OR client_name ILIKE $${valIndex} OR location ILIKE $${valIndex})`);
    values.push(`%${params.search.trim()}%`);
    valIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM events WHERE ${whereClause}`,
    values
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const querySql = `
    SELECT * FROM events
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${valIndex++} OFFSET $${valIndex++}
  `;
  values.push(limit, offset);

  const res = await query<Event>(querySql, values);
  const events = res.rows.map(formatEventListItem);

  return { events, total, page, limit };
}

/**
 * Updates event metadata via partial update, preserving untouched fields.
 */
export async function updateEvent(
  eventId: string,
  ownerId: number,
  input: UpdateEventDTO
): Promise<EventDetail> {
  const existingRes = await query<Event>(
    'SELECT * FROM events WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [eventId, ownerId]
  );

  if (existingRes.rows.length === 0) {
    throw new EventNotFoundError(`Event with ID "${eventId}" not found or unauthorized`);
  }

  const existing = existingRes.rows[0];

  if (existing.status === 'deleting') {
    throw new ConflictError(`Event "${eventId}" is currently being deleted and cannot be modified`);
  }

  const targetVisibility = input.visibility ?? existing.visibility;
  let targetDurationDays = input.public_duration_days !== undefined
    ? validatePublicDurationDays(input.public_duration_days)
    : (existing.public_duration_days ?? DEFAULT_PUBLIC_DURATION_DAYS);

  let targetPublicStart = input.public_start !== undefined
    ? (input.public_start ? new Date(input.public_start).toISOString() : null)
    : (existing.public_start ? new Date(existing.public_start).toISOString() : null);

  let targetPublicUntil = input.public_until !== undefined
    ? (input.public_until ? new Date(input.public_until).toISOString() : null)
    : (existing.public_until ? new Date(existing.public_until).toISOString() : null);

  let targetExpiredAt: Date | null = existing.expired_at;
  let finalVisibility = targetVisibility;

  // Visibility and Expiry Transition Rules
  if (targetVisibility === 'public') {
    const isExistingExpired = isEventExpired(existing.public_until);
    const isTransitioningFromPrivate = existing.visibility === 'private' || isExistingExpired;

    if (isTransitioningFromPrivate) {
      // Transitioning from private or expired -> start a new public period from authoritative NOW
      const now = new Date();
      targetPublicStart = input.public_start || now.toISOString();
      targetPublicUntil = input.public_until || calculateExpiryTimestamp(new Date(targetPublicStart), targetDurationDays).toISOString();
      validatePublicWindow(targetPublicStart, targetPublicUntil);
      targetExpiredAt = null;
    } else {
      // Event is currently public and active
      if (input.public_duration_days !== undefined && input.public_duration_days !== existing.public_duration_days) {
        // Duration changed explicitly while public -> recalculate expiry from current publication start time
        const pubStart = existing.public_start ? new Date(existing.public_start) : new Date();
        const recalculatedUntil = calculateExpiryTimestamp(pubStart, targetDurationDays);
        targetPublicUntil = recalculatedUntil.toISOString();

        // If recalculated expiry is already reached/passed, transition to private immediately
        if (recalculatedUntil.getTime() <= Date.now()) {
          finalVisibility = 'private';
          targetExpiredAt = new Date();
          await revokeEventGuestSessions(existing.id);
        }
      } else if (input.public_start !== undefined || input.public_until !== undefined) {
        validatePublicWindow(targetPublicStart, targetPublicUntil);
      }
    }
  } else if (targetVisibility === 'private') {
    // Transitioning to private from public -> revoke active guest sessions
    if (existing.visibility === 'public') {
      await revokeEventGuestSessions(existing.id);
    }
  }

  // Handle PIN update
  let pinHash = existing.pin_hash;
  let pinEnabled = input.pin_enabled ?? existing.pin_enabled;
  let pinChanged = false;

  if (input.pin_enabled !== undefined && !input.pin_enabled) {
    if (existing.pin_enabled) {
      pinChanged = true;
    }
    pinEnabled = false;
    pinHash = null;
  } else if (input.pin) {
    pinHash = await hashEventPin(input.pin);
    pinEnabled = true;
    pinChanged = true;
  }

  if (pinChanged) {
    // Revoke any existing active guest sessions so old PIN tokens can no longer be used
    await revokeEventGuestSessions(existing.id);
  }

  // Handle slug change if requested
  let slug = existing.slug;
  if (input.slug && input.slug !== existing.slug) {
    slug = await resolveUniqueSlug(input.slug, existing.id);
  }

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const clientName = input.client_name !== undefined ? input.client_name.trim() : existing.client_name;
  const clientEmail = input.client_email !== undefined ? (input.client_email ? input.client_email.trim() : null) : existing.client_email;
  const eventDate = input.event_date !== undefined ? input.event_date : existing.event_date;
  const location = input.location !== undefined ? (input.location ? input.location.trim() : null) : existing.location;
  const description = input.description !== undefined ? (input.description ? input.description.trim() : null) : existing.description;
  const status = input.status ?? existing.status;
  const allowDownloads = input.allow_downloads ?? existing.allow_downloads;
  const allowPhotoDownloads = input.allow_photo_downloads ?? (existing as any).allow_photo_downloads ?? true;
  const allowBulkDownloads = input.allow_bulk_downloads ?? (existing as any).allow_bulk_downloads ?? true;
  const allowVideoDownloads = input.allow_video_downloads ?? (existing as any).allow_video_downloads ?? true;
  const coverPhotoId = input.cover_photo_id !== undefined ? input.cover_photo_id : existing.cover_photo_id;

  // Watermark Configuration Changes & Version Incrementing (Phase 22)
  const existingWatermarkEnabled = Boolean(existing.watermark_enabled);
  const existingWatermarkText = existing.watermark_text || 'Studio Lumina';
  const existingWatermarkOpacity = Number(existing.watermark_opacity ?? 0.35);
  const existingWatermarkSize = existing.watermark_size || 'medium';
  const existingWatermarkPosition = existing.watermark_position || 'bottom-right';
  const existingWatermarkColor = existing.watermark_color || 'white';

  const watermarkEnabled = input.watermark_enabled !== undefined ? Boolean(input.watermark_enabled) : existingWatermarkEnabled;
  const watermarkText = input.watermark_text !== undefined ? (input.watermark_text ? input.watermark_text.trim() : 'Studio Lumina') : existingWatermarkText;
  const watermarkOpacity = input.watermark_opacity !== undefined ? Number(input.watermark_opacity) : existingWatermarkOpacity;
  const watermarkSize = (input.watermark_size as WatermarkSize) || existingWatermarkSize;
  const watermarkPosition = (input.watermark_position as WatermarkPosition) || existingWatermarkPosition;
  const watermarkColor = (input.watermark_color as WatermarkColor) || existingWatermarkColor;

  const watermarkChanged =
    watermarkEnabled !== existingWatermarkEnabled ||
    watermarkText !== existingWatermarkText ||
    Math.abs(watermarkOpacity - existingWatermarkOpacity) > 0.001 ||
    watermarkSize !== existingWatermarkSize ||
    watermarkPosition !== existingWatermarkPosition ||
    watermarkColor !== existingWatermarkColor;

  let watermarkVersion = Number(existing.watermark_version || 1);
  if (watermarkChanged) {
    watermarkVersion = watermarkVersion + 1;
  }

  const faceSearchEnabled = input.face_search_enabled ?? existing.face_search_enabled;

  const res = await query<Event>(
    `UPDATE events SET
      slug = $1,
      name = $2,
      client_name = $3,
      client_email = $4,
      event_date = $5,
      location = $6,
      description = $7,
      status = $8,
      visibility = $9,
      public_start = $10,
      public_until = $11,
      public_duration_days = $12,
      expired_at = $13,
      pin_enabled = $14,
      pin_hash = $15,
      allow_downloads = $16,
      allow_photo_downloads = $17,
      allow_bulk_downloads = $18,
      allow_video_downloads = $19,
      cover_photo_id = $20,
      watermark_enabled = $21,
      watermark_text = $22,
      watermark_opacity = $23,
      watermark_size = $24,
      watermark_position = $25,
      watermark_color = $26,
      watermark_version = $27,
      face_search_enabled = $28,
      updated_at = NOW()
    WHERE id = $29 AND owner_id = $30
    RETURNING *`,
    [
      slug,
      name,
      clientName,
      clientEmail,
      eventDate,
      location,
      description,
      status,
      finalVisibility,
      targetPublicStart ? new Date(targetPublicStart) : null,
      targetPublicUntil ? new Date(targetPublicUntil) : null,
      targetDurationDays,
      targetExpiredAt,
      pinEnabled,
      pinHash,
      allowDownloads,
      allowPhotoDownloads,
      allowBulkDownloads,
      allowVideoDownloads,
      coverPhotoId,
      watermarkEnabled,
      watermarkText,
      watermarkOpacity,
      watermarkSize,
      watermarkPosition,
      watermarkColor,
      watermarkVersion,
      faceSearchEnabled,
      eventId,
      ownerId,
    ]
  );

  const updated = res.rows[0];

  if (updated.visibility === 'public' && updated.public_until) {
    const delayMs = new Date(updated.public_until).getTime() - Date.now();
    void enqueueExpiryJob(
      { eventId: updated.id, expectedExpiresAt: new Date(updated.public_until).toISOString() },
      delayMs
    ).catch(() => {});
  }

  // If watermark settings changed, trigger asynchronous reprocessing of photo derivatives
  if (watermarkChanged) {
    void reprocessEventWatermarks(updated.id).catch((err) => {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Failed to trigger photo watermark reprocessing: ${err instanceof Error ? err.message : String(err)}`,
        details: { eventId: updated.id },
      });
    });
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Event updated: ${updated.name} (${updated.id})`,
    details: {
      eventId,
      ownerId,
      status: updated.status,
      visibility: updated.visibility,
      watermarkChanged,
      watermarkVersion: updated.watermark_version,
    },
  });

  return formatEventDetail(updated);
}

/**
 * Deliberately publishes an event to public visibility.
 * If private or expired, begins a fresh public period from authoritative NOW.
 * If already public, preserves existing timestamps (idempotent).
 */
export async function publishEvent(
  eventId: string,
  ownerId: number,
  publicStart?: string,
  publicUntil?: string,
  publicDurationDays?: number
): Promise<EventDetail> {
  const existing = await getEventById(eventId, ownerId);

  const isCurrentlyExpired = isEventExpired(existing.public_until);
  const duration = publicDurationDays !== undefined
    ? validatePublicDurationDays(publicDurationDays)
    : (existing.public_duration_days || DEFAULT_PUBLIC_DURATION_DAYS);

  // If private or expired: start fresh public period from authoritative NOW()
  if (existing.visibility === 'private' || isCurrentlyExpired) {
    const start = publicStart || new Date().toISOString();
    const until = publicUntil || calculateExpiryTimestamp(new Date(start), duration).toISOString();
    validatePublicWindow(start, until);

    return updateEvent(eventId, ownerId, {
      visibility: 'public',
      status: existing.status === 'draft' ? 'active' : existing.status,
      public_start: start,
      public_until: until,
      public_duration_days: duration,
    });
  }

  // If already public and not expired:
  if (publicDurationDays !== undefined && publicDurationDays !== existing.public_duration_days) {
    return updateEvent(eventId, ownerId, {
      public_duration_days: duration,
    });
  }

  // Repeated publish on already-public active event: idempotent, returns existing without resetting
  return existing;
}

/**
 * Sets event visibility back to private.
 */
export async function unpublishEvent(
  eventId: string,
  ownerId: number
): Promise<EventDetail> {
  return updateEvent(eventId, ownerId, {
    visibility: 'private',
  });
}

/**
 * Explicitly updates an event's visibility between public and private.
 */
export async function updateEventVisibility(
  eventId: string,
  ownerId: number,
  visibility: 'public' | 'private',
  publicDurationDays?: number
): Promise<EventDetail> {
  if (visibility === 'public') {
    return publishEvent(eventId, ownerId, undefined, undefined, publicDurationDays);
  } else {
    return unpublishEvent(eventId, ownerId);
  }
}


/**
 * Archives an active or draft event.
 */
export async function archiveEvent(
  eventId: string,
  ownerId: number
): Promise<EventDetail> {
  const existing = await getEventById(eventId, ownerId);
  if (existing.status === 'archived') {
    return existing;
  }
  return updateEvent(eventId, ownerId, {
    status: 'archived',
    visibility: 'private', // Safe default: archiving privatizes gallery
  });
}

/**
 * Restores an archived or trashed event back to active status.
 */
export async function restoreEvent(
  eventId: string,
  ownerId: number
): Promise<EventDetail> {
  const existing = await getEventById(eventId, ownerId);
  if (existing.status === 'deleting') {
    throw new ConflictError('Cannot restore event: permanent deletion has already started');
  }
  if (existing.status === 'deleted') {
    throw new ConflictError('Cannot restore event: event has already been permanently deleted');
  }
  if (existing.status === 'trashed') {
    await restoreEventFromBin(eventId, ownerId);
    return getEventById(eventId, ownerId);
  }
  if (existing.status !== 'archived') {
    throw new InvalidLifecycleTransitionError('Only archived or trashed events can be restored');
  }
  return updateEvent(eventId, ownerId, {
    status: 'active',
  });
}

/**
 * Deletes an event record with deliberate confirmation matching and durable multi-tier cleanup.
 */
export async function deleteEvent(
  eventId: string,
  ownerId: number,
  confirmName?: string
): Promise<DeleteEventResponseDTO> {
  return deleteEventPermanently(eventId, ownerId, confirmName);
}

export {
  getEventDeletionStatus,
  trashEvent,
  restoreEventFromBin,
  listBinEvents,
  emptyBin,
  reconcileExpiredBinEvents,
};

/**
 * Triggers asynchronous reprocessing of all photo media for an event to apply
 * the current event watermark configuration.
 */
export async function reprocessEventWatermarks(
  eventId: string,
  ownerId?: number
): Promise<{ enqueuedCount: number; version: number }> {
  // If ownerId is provided, enforce ownership check
  let version = 1;
  if (ownerId !== undefined) {
    const ev = await query<{ id: string; watermark_version: number }>(
      'SELECT id, watermark_version FROM events WHERE id = $1 AND owner_id = $2',
      [eventId, ownerId]
    );
    if (ev.rows.length === 0) {
      throw new EventNotFoundError(`Event with ID "${eventId}" not found or unauthorized`);
    }
    version = Number(ev.rows[0].watermark_version || 1);
  } else {
    const ev = await query<{ id: string; watermark_version: number }>(
      'SELECT id, watermark_version FROM events WHERE id = $1',
      [eventId]
    );
    if (ev.rows.length > 0) {
      version = Number(ev.rows[0].watermark_version || 1);
    }
  }

  const photosRes = await query<{ id: string }>(
    `SELECT id FROM media WHERE event_id = $1 AND type = 'photo' ORDER BY created_at ASC`,
    [eventId]
  );

  const photos = photosRes.rows;
  let enqueuedCount = 0;

  for (const photo of photos) {
    try {
      await enqueuePhotoJob({ mediaId: photo.id, eventId });
      enqueuedCount++;
    } catch {
      // Fallback to in-process queue if BullMQ is offline or in test environments
      imageProcessingQueue.enqueue(photo.id, eventId);
      enqueuedCount++;
    }
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Scheduled watermark reprocessing for ${enqueuedCount} photos in event ${eventId} (v${version})`,
    details: { eventId, enqueuedCount, version },
  });

  return { enqueuedCount, version };
}

/**
 * Returns current watermark reprocessing and synchronization status for an event.
 */
export async function getEventWatermarkStatus(
  eventId: string,
  ownerId: number
): Promise<WatermarkReprocessStatus> {
  const evRes = await query<{ id: string; watermark_version: number }>(
    'SELECT id, COALESCE(watermark_version, 1) as watermark_version FROM events WHERE id = $1 AND owner_id = $2',
    [eventId, ownerId]
  );

  if (evRes.rows.length === 0) {
    throw new EventNotFoundError(`Event with ID "${eventId}" not found or unauthorized`);
  }

  const currentVersion = Number(evRes.rows[0].watermark_version);

  const statsRes = await query<{
    total_photos: string;
    synced_photos: string;
  }>(
    `SELECT 
       COUNT(*)::text as total_photos,
       COUNT(CASE WHEN watermark_version = $2 AND status = 'ready' THEN 1 END)::text as synced_photos
     FROM media
     WHERE event_id = $1 AND type = 'photo'`,
    [eventId, currentVersion]
  );

  const totalPhotos = parseInt(statsRes.rows[0]?.total_photos || '0', 10) || 0;
  const syncedPhotos = parseInt(statsRes.rows[0]?.synced_photos || '0', 10) || 0;
  const pendingPhotos = Math.max(0, totalPhotos - syncedPhotos);

  return {
    eventId,
    watermarkVersion: currentVersion,
    totalPhotos,
    syncedPhotos,
    pendingPhotos,
    inSync: pendingPhotos === 0,
  };
}

/**
 * Retrieves QR code and sharing metadata for an event, strictly enforcing owner authorization.
 */
export async function getEventQrSharing(
  eventId: string,
  ownerId: number,
  customAppUrl?: string
): Promise<EventQrShareDTO> {
  const res = await query<Event>(
    'SELECT * FROM events WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [eventId, ownerId]
  );

  if (res.rows.length === 0) {
    throw new EventNotFoundError(`Event with ID "${eventId}" not found or unauthorized`);
  }

  return generateEventQrCode(res.rows[0], customAppUrl);
}

