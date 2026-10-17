import { query } from '../infrastructure/database.js';
import { revokeEventGuestSessions } from './guestSessionService.js';
import { log } from '../middleware/logger.js';
import {
  ValidationError,
  PublicWindowExceededError,
} from '@photography-saas/errors';

export const MIN_PUBLIC_DURATION_DAYS = 1;
export const MAX_PUBLIC_DURATION_DAYS = 30;
export const DEFAULT_PUBLIC_DURATION_DAYS = 30;
export const DEFAULT_RECONCILIATION_BATCH_SIZE = 50;
export const DEFAULT_RECONCILIATION_INTERVAL_MS = 60000; // 1 minute

let periodicReconcilerTimer: NodeJS.Timeout | null = null;

/**
 * Validates public duration in days (must be integer between 1 and 30).
 */
export function validatePublicDurationDays(days: unknown): number {
  if (typeof days !== 'number' || !Number.isInteger(days)) {
    throw new ValidationError('Public access duration must be a whole integer number of days.');
  }

  if (days < MIN_PUBLIC_DURATION_DAYS) {
    throw new ValidationError(`Public access duration must be at least ${MIN_PUBLIC_DURATION_DAYS} day.`);
  }

  if (days > MAX_PUBLIC_DURATION_DAYS) {
    throw new PublicWindowExceededError(
      `Public access duration cannot exceed the maximum limit of ${MAX_PUBLIC_DURATION_DAYS} days (requested ${days} days).`
    );
  }

  return days;
}

/**
 * Computes the authoritative expiry timestamp given a publication start date and duration in days.
 */
export function calculateExpiryTimestamp(
  publicStart: Date,
  durationDays: number = DEFAULT_PUBLIC_DURATION_DAYS
): Date {
  const validatedDays = validatePublicDurationDays(durationDays);
  return new Date(publicStart.getTime() + validatedDays * 24 * 60 * 60 * 1000);
}

/**
 * Evaluates whether an event is expired at the given authoritative timestamp.
 * Exact boundary: now >= public_until is treated as expired.
 */
export function isEventExpired(
  publicUntil: string | Date | null | undefined,
  asOf: Date | number = new Date()
): boolean {
  if (!publicUntil) return false;
  const expiryDate = publicUntil instanceof Date ? publicUntil : new Date(publicUntil);
  if (isNaN(expiryDate.getTime())) return false;
  const nowMs = typeof asOf === 'number' ? asOf : asOf.getTime();
  return nowMs >= expiryDate.getTime();
}

/**
 * Idempotently and guardedly expires a single event if its public window has ended.
 * 
 * Guards:
 * - Event must currently have visibility = 'public'
 * - Event must have public_until IS NOT NULL
 * - public_until must be <= authoritative asOf timestamp
 * 
 * Actions:
 * - Updates visibility to 'private'
 * - Sets expired_at = NOW()
 * - Sets updated_at = NOW()
 * - Revokes all active guest sessions for the event
 * - Preserves ALL media, folders, embeddings, and photographer access
 */
export async function expireEventIfDue(
  eventId: string,
  asOf: Date = new Date()
): Promise<{
  expired: boolean;
  eventId: string;
  name?: string;
  slug?: string;
  previousPublicUntil?: Date;
}> {
  try {
    const res = await query<{
      id: string;
      name: string;
      slug: string;
      public_until: Date;
    }>(
      `UPDATE events
       SET visibility = 'private',
           expired_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND visibility = 'public'
         AND public_until IS NOT NULL
         AND public_until <= $2
       RETURNING id, name, slug, public_until`,
      [eventId, asOf]
    );

    if (res.rows.length === 0) {
      return { expired: false, eventId };
    }

    const row = res.rows[0];

    // Invalidate active guest sessions for the newly expired event
    await revokeEventGuestSessions(row.id);

    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: `Automatic gallery expiry: Event "${row.name}" (${row.id}) transitioned to private`,
      details: {
        eventId: row.id,
        slug: row.slug,
        previousPublicUntil: row.public_until,
        asOf: asOf.toISOString(),
      },
    });

    return {
      expired: true,
      eventId: row.id,
      name: row.name,
      slug: row.slug,
      previousPublicUntil: new Date(row.public_until),
    };
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Failed to expire event ${eventId}: ${err instanceof Error ? err.message : String(err)}`,
      details: { eventId, asOf: asOf.toISOString() },
    });
    throw err;
  }
}

/**
 * Sweeps and reconciles all overdue public galleries in bounded batches.
 * Safe to rerun periodically, recovers from delayed schedulers or worker restarts.
 */
export async function reconcileExpiredEvents(options?: {
  asOfDate?: Date;
  batchSize?: number;
}): Promise<{
  processed: number;
  transitioned: number;
  failed: number;
  eventIds: string[];
}> {
  const asOf = options?.asOfDate ?? new Date();
  const batchSize = Math.max(1, Math.min(500, options?.batchSize ?? DEFAULT_RECONCILIATION_BATCH_SIZE));

  try {
    // Find due public events in bounded batch
    const candidatesRes = await query<{
      id: string;
      name: string;
      slug: string;
      public_until: Date;
    }>(
      `SELECT id, name, slug, public_until
       FROM events
       WHERE visibility = 'public'
         AND public_until IS NOT NULL
         AND public_until <= $1
       ORDER BY public_until ASC
       LIMIT $2`,
      [asOf, batchSize]
    );

    const candidates = candidatesRes.rows;
    let transitioned = 0;
    let failed = 0;
    const transitionedIds: string[] = [];

    for (const candidate of candidates) {
      try {
        const result = await expireEventIfDue(candidate.id, asOf);
        if (result.expired) {
          transitioned++;
          transitionedIds.push(candidate.id);
        }
      } catch (_err) {
        failed++;
      }
    }

    if (candidates.length > 0) {
      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'photography-api',
        message: `Gallery expiry reconciliation sweep completed: ${transitioned}/${candidates.length} transitioned to private (${failed} failed)`,
        details: {
          candidatesFound: candidates.length,
          transitioned,
          failed,
          transitionedIds,
          asOf: asOf.toISOString(),
        },
      });
    }

    return {
      processed: candidates.length,
      transitioned,
      failed,
      eventIds: transitionedIds,
    };
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: `Gallery expiry reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
      details: { asOf: asOf.toISOString() },
    });
    return {
      processed: 0,
      transitioned: 0,
      failed: 1,
      eventIds: [],
    };
  }
}

/**
 * Starts the periodic background reconciliation timer.
 */
export function startExpiryPeriodicReconciler(
  intervalMs: number = DEFAULT_RECONCILIATION_INTERVAL_MS
): NodeJS.Timeout {
  if (periodicReconcilerTimer) {
    clearInterval(periodicReconcilerTimer);
  }

  // Run immediate initial reconciliation on startup
  reconcileExpiredEvents().catch((err) => {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Initial gallery expiry sweep failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  });

  periodicReconcilerTimer = setInterval(() => {
    reconcileExpiredEvents().catch((err) => {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Periodic gallery expiry sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  }, intervalMs);

  periodicReconcilerTimer.unref();
  return periodicReconcilerTimer;
}

/**
 * Stops the periodic background reconciliation timer cleanly.
 */
export function stopExpiryPeriodicReconciler(): void {
  if (periodicReconcilerTimer) {
    clearInterval(periodicReconcilerTimer);
    periodicReconcilerTimer = null;
  }
}
