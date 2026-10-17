import { query } from '../infrastructure/database.js';
import { log } from '../middleware/logger.js';
import { getConfig } from '@photography-saas/config';
import {
  EventNotFoundError,
  ConflictError,
  InvalidLifecycleTransitionError,
} from '@photography-saas/errors';
import { revokeEventGuestSessions } from './guestSessionService.js';
import { deleteEventPermanently } from './eventDeletionService.js';
import { isEventExpired } from './galleryExpiryService.js';
import type {
  TrashEventResponseDTO,
  RestoreEventResponseDTO,
  TrashedEventListItem,
  EmptyBinResultDTO,
  Event,
  EventStatus,
} from '@photography-saas/types';

export const DEFAULT_BIN_RETENTION_DAYS = 30;

let binReconcilerInterval: NodeJS.Timeout | null = null;

/**
 * Calculates the UTC purge deadline based on configured retention duration.
 */
export function calculatePurgeDeadline(now: Date = new Date(), retentionDays?: number): Date {
  const config = getConfig();
  const days = retentionDays ?? config.recycleBin?.retentionDays ?? DEFAULT_BIN_RETENTION_DAYS;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Calculates remaining days until purge_after in UTC.
 */
export function calculateDaysRemaining(
  purgeAfter: Date | string | null | undefined,
  asOf: Date = new Date()
): number {
  if (!purgeAfter) return 0;
  const purgeDate = typeof purgeAfter === 'string' ? new Date(purgeAfter) : purgeAfter;
  const diffMs = purgeDate.getTime() - asOf.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Moves an active or archived event to the Recycle Bin (Soft Delete).
 * - Updates status to 'trashed'.
 * - Records deleted_at (UTC), purge_after (UTC), and deleted_by (photographer ID).
 * - Immediately revokes all active guest sessions for the event.
 * - Leaves all R2 objects, photos, videos, folders, and face embeddings 100% intact.
 */
export async function trashEvent(
  eventId: string,
  ownerId: number,
  retentionDays?: number
): Promise<TrashEventResponseDTO> {
  const existingRes = await query<{
    id: string;
    owner_id: number;
    name: string;
    status: EventStatus;
    deleted_at: Date | null;
    purge_after: Date | null;
  }>(
    'SELECT id, owner_id, name, status, deleted_at, purge_after FROM events WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [eventId, ownerId]
  );

  if (existingRes.rows.length === 0) {
    throw new EventNotFoundError(`Event with ID "${eventId}" not found or unauthorized`);
  }

  const existing = existingRes.rows[0];

  if (existing.status === 'deleting') {
    throw new ConflictError(
      `Event "${eventId}" is currently being permanently deleted and cannot be moved to the Bin`
    );
  }

  // Idempotent return if already in the bin
  if (existing.status === 'trashed') {
    const remaining = calculateDaysRemaining(existing.purge_after);
    return {
      trashed: true,
      id: existing.id,
      name: existing.name,
      status: 'trashed',
      deleted_at: existing.deleted_at
        ? new Date(existing.deleted_at).toISOString()
        : new Date().toISOString(),
      purge_after: existing.purge_after
        ? new Date(existing.purge_after).toISOString()
        : calculatePurgeDeadline().toISOString(),
      days_remaining: remaining,
    };
  }

  const now = new Date();
  const purgeAfter = calculatePurgeDeadline(now, retentionDays);

  const res = await query<{
    id: string;
    name: string;
    status: string;
    deleted_at: Date;
    purge_after: Date;
  }>(
    `UPDATE events
     SET status = 'trashed',
         visibility = 'private',
         deleted_at = $1,
         purge_after = $2,
         deleted_by = $3,
         updated_at = NOW()
     WHERE id = $4 AND owner_id = $5 AND status != 'deleting'
     RETURNING id, name, status, deleted_at, purge_after`,
    [now, purgeAfter, ownerId, eventId, ownerId]
  );

  if (res.rows.length === 0) {
    throw new ConflictError(
      `Event "${eventId}" could not be moved to the Recycle Bin (concurrent deletion in progress)`
    );
  }

  const row = res.rows[0];

  // Immediately revoke guest sessions for the newly trashed event
  await revokeEventGuestSessions(eventId);

  const daysRemaining = calculateDaysRemaining(row.purge_after, now);

  log({
    timestamp: new Date().toISOString(),
    level: 'warn',
    service: 'recycle-bin',
    message: `Event moved to Recycle Bin: ${row.name} (${row.id})`,
    details: {
      eventId: row.id,
      ownerId,
      deletedAt: row.deleted_at.toISOString(),
      purgeAfter: row.purge_after.toISOString(),
      daysRemaining,
    },
  });

  return {
    trashed: true,
    id: row.id,
    name: row.name,
    status: 'trashed',
    deleted_at: row.deleted_at.toISOString(),
    purge_after: row.purge_after.toISOString(),
    days_remaining: daysRemaining,
  };
}

/**
 * Restores a trashed event back to 'active' status.
 * - Confirms event is in 'trashed' state and permanent deletion has not started.
 * - Atomically transitions event back to 'active'.
 * - Preserves private visibility: galleries never accidentally republish upon restoration.
 * - If the public window expired, preserves/records expired_at and keeps visibility private.
 * - Clears deleted_at, purge_after, and deleted_by.
 * - Preserves intact photos, videos, folders, R2 objects, and face embeddings.
 */
export async function restoreEventFromBin(
  eventId: string,
  ownerId: number
): Promise<RestoreEventResponseDTO> {
  const existingRes = await query<{
    id: string;
    owner_id: number;
    name: string;
    status: EventStatus;
    public_until: Date | null;
  }>(
    'SELECT id, owner_id, name, status, public_until FROM events WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [eventId, ownerId]
  );

  if (existingRes.rows.length === 0) {
    throw new EventNotFoundError(`Event with ID "${eventId}" not found or unauthorized`);
  }

  const existing = existingRes.rows[0];

  if (existing.status === 'deleting') {
    throw new ConflictError(
      `Cannot restore event "${eventId}": permanent deletion has already started and cannot be reversed`
    );
  }

  if (existing.status !== 'trashed') {
    throw new InvalidLifecycleTransitionError(
      `Cannot restore event "${eventId}": only events in the Recycle Bin can be restored (current status: ${existing.status})`
    );
  }

  // Atomically claim and restore event, strictly guaranteeing private visibility and expiry preservation
  const res = await query<{
    id: string;
    name: string;
    status: EventStatus;
  }>(
    `UPDATE events
     SET status = 'active',
         visibility = 'private',
         expired_at = CASE
           WHEN public_until IS NOT NULL AND public_until <= NOW() THEN COALESCE(expired_at, NOW())
           ELSE expired_at
         END,
         deleted_at = NULL,
         purge_after = NULL,
         deleted_by = NULL,
         updated_at = NOW()
     WHERE id = $1 AND owner_id = $2 AND status = 'trashed'
     RETURNING id, name, status`,
    [eventId, ownerId]
  );

  if (res.rows.length === 0) {
    throw new ConflictError(
      `Cannot restore event "${eventId}": event state changed concurrently or permanent deletion has started`
    );
  }

  const restored = res.rows[0];

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'recycle-bin',
    message: `Event restored from Recycle Bin: ${restored.name} (${restored.id})`,
    details: {
      eventId: restored.id,
      ownerId,
      newStatus: restored.status,
    },
  });

  return {
    restored: true,
    id: restored.id,
    name: restored.name,
    status: restored.status,
  };
}

/**
 * Lists all trashed events belonging to the authenticated photographer.
 * Returns cover preview key, days remaining countdown, photo and video counts.
 */
export async function listBinEvents(ownerId: number): Promise<TrashedEventListItem[]> {
  const res = await query<
    Event & {
      cover_preview_key: string | null;
      photo_count: string | number;
      video_count: string | number;
      total_size_bytes: string | number;
    }
  >(
    `SELECT e.*,
            m.storage_key_preview as cover_preview_key,
            COALESCE(m_agg.photo_count, 0)::int AS photo_count,
            COALESCE(m_agg.video_count, 0)::int AS video_count,
            COALESCE(m_agg.total_size_bytes, 0)::bigint AS total_size_bytes
     FROM events e
     LEFT JOIN media m ON m.id = e.cover_photo_id
     LEFT JOIN (
       SELECT 
         med.event_id,
         COUNT(CASE WHEN med.type = 'photo' THEN 1 END) AS photo_count,
         COUNT(CASE WHEN med.type = 'video' THEN 1 END) AS video_count,
         SUM(med.file_size) AS total_size_bytes
       FROM media med
       GROUP BY med.event_id
     ) m_agg ON m_agg.event_id = e.id
     WHERE e.owner_id = $1 AND e.status = 'trashed'
     ORDER BY e.deleted_at DESC, e.created_at DESC`,
    [ownerId]
  );

  const now = new Date();

  return res.rows.map((row) => {
    const daysRemaining = calculateDaysRemaining(row.purge_after, now);
    const isExpired = isEventExpired(row.public_until, now);

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      client_name: row.client_name,
      client_email: row.client_email,
      event_date:
        typeof row.event_date === 'string'
          ? row.event_date
          : new Date(row.event_date).toISOString().split('T')[0],
      location: row.location,
      status: row.status,
      visibility: row.visibility,
      public_start: row.public_start ? new Date(row.public_start).toISOString() : null,
      public_until: row.public_until ? new Date(row.public_until).toISOString() : null,
      public_duration_days: row.public_duration_days,
      is_expired: isExpired,
      expired_at: row.expired_at ? new Date(row.expired_at).toISOString() : null,
      pin_enabled: row.pin_enabled,
      allow_downloads: row.allow_downloads,
      watermark_enabled: row.watermark_enabled,
      deleted_at: row.deleted_at ? new Date(row.deleted_at).toISOString() : now.toISOString(),
      purge_after: row.purge_after ? new Date(row.purge_after).toISOString() : now.toISOString(),
      deleted_by: row.deleted_by ?? null,
      days_remaining: daysRemaining,
      cover_photo_id: row.cover_photo_id,
      cover_preview_url: row.cover_preview_key
        ? `/api/media/preview/${row.id}/${row.cover_photo_id}`
        : null,
      photo_count: Number(row.photo_count || 0),
      video_count: Number(row.video_count || 0),
      total_size_bytes: Number(row.total_size_bytes || 0),
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  });
}

/**
 * Permanently deletes all trashed events belonging to the authenticated photographer (Empty Bin).
 * Processes each trashed event with the durable deletion engine, reporting per-event results.
 */
export async function emptyBin(ownerId: number): Promise<EmptyBinResultDTO> {
  const trashedRes = await query<{ id: string; name: string }>(
    "SELECT id, name FROM events WHERE owner_id = $1 AND status = 'trashed' ORDER BY deleted_at ASC",
    [ownerId]
  );

  const eventsToPurge = trashedRes.rows;
  const results: Array<{ eventId: string; name: string; success: boolean; error?: string }> = [];
  let successfullyDeleted = 0;
  let failedCount = 0;

  for (const item of eventsToPurge) {
    try {
      await deleteEventPermanently(item.id, ownerId, item.name, { skipNameCheck: true });
      results.push({
        eventId: item.id,
        name: item.name,
        success: true,
      });
      successfullyDeleted++;
    } catch (err) {
      failedCount++;
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({
        eventId: item.id,
        name: item.name,
        success: false,
        error: errMsg,
      });
      log({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'recycle-bin',
        message: `Failed to permanently delete trashed event ${item.id} during Empty Bin: ${errMsg}`,
        details: { eventId: item.id, ownerId },
      });
    }
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'recycle-bin',
    message: `Empty Bin completed for owner ${ownerId}: ${successfullyDeleted} deleted, ${failedCount} failed`,
    details: {
      ownerId,
      totalRequested: eventsToPurge.length,
      successfullyDeleted,
      failedCount,
    },
  });

  return {
    totalRequested: eventsToPurge.length,
    successfullyDeleted,
    failedCount,
    results,
  };
}

/**
 * Scheduled worker function that finds and purges events in the Recycle Bin whose
 * retention deadline (purge_after) has passed.
 * - Idempotently and atomically claims eligible events (setting status = 'deleting').
 * - Executes durable deletion workflow (Cloudflare R2 + Supabase pgvector + database).
 * - Safe against concurrent restore operations and multiple worker instances.
 */
export async function reconcileExpiredBinEvents(
  asOf: Date = new Date()
): Promise<{ claimedCount: number; purgedCount: number }> {
  // Query for trashed events whose retention deadline has passed
  const eligibleRes = await query<{
    id: string;
    owner_id: number;
    name: string;
    purge_after: Date;
  }>(
    `SELECT id, owner_id, name, purge_after
     FROM events
     WHERE status = 'trashed'
       AND purge_after IS NOT NULL
       AND purge_after <= $1
     ORDER BY purge_after ASC
     LIMIT 50`,
    [asOf]
  );

  let claimedCount = 0;
  let purgedCount = 0;

  for (const row of eligibleRes.rows) {
    try {
      // Atomically claim the event for permanent deletion
      const claimRes = await query<{ id: string; owner_id: number; name: string }>(
        `UPDATE events
         SET status = 'deleting',
             visibility = 'private',
             updated_at = NOW()
         WHERE id = $1
           AND status = 'trashed'
           AND purge_after IS NOT NULL
           AND purge_after <= $2
         RETURNING id, owner_id, name`,
        [row.id, asOf]
      );

      if (claimRes.rows.length === 0) {
        // Lost race to a restore operation or another worker instance
        continue;
      }

      claimedCount++;
      const claimed = claimRes.rows[0];

      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'recycle-bin-worker',
        message: `Claimed expired event for automated permanent purge: ${claimed.name} (${claimed.id})`,
        details: {
          eventId: claimed.id,
          ownerId: claimed.owner_id,
          purgeAfter: row.purge_after.toISOString(),
        },
      });

      // Execute durable permanent deletion workflow
      await deleteEventPermanently(claimed.id, claimed.owner_id, claimed.name, {
        skipNameCheck: true,
      });
      purgedCount++;
    } catch (err) {
      log({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'recycle-bin-worker',
        message: `Error during automated permanent purge of event ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        details: { eventId: row.id, ownerId: row.owner_id },
      });
    }
  }

  return { claimedCount, purgedCount };
}

/**
 * Starts periodic scheduled reconciler timer for automated Recycle Bin purge.
 */
export function startRecycleBinPurgeReconciler(intervalMs = 60000): void {
  if (binReconcilerInterval) {
    return;
  }

  binReconcilerInterval = setInterval(async () => {
    try {
      await reconcileExpiredBinEvents();
    } catch (err) {
      log({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'recycle-bin-worker',
        message: `Periodic Recycle Bin purge cycle error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, intervalMs);

  binReconcilerInterval.unref();

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'recycle-bin-worker',
    message: `Recycle Bin automated purge reconciler started (interval: ${intervalMs}ms)`,
  });
}

/**
 * Stops periodic scheduled reconciler timer.
 */
export function stopRecycleBinPurgeReconciler(): void {
  if (binReconcilerInterval) {
    clearInterval(binReconcilerInterval);
    binReconcilerInterval = null;
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'recycle-bin-worker',
      message: 'Recycle Bin automated purge reconciler stopped',
    });
  }
}
