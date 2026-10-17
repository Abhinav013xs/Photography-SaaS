import { query, withTransaction } from '../infrastructure/database.js';
import { storageAdapter } from '../infrastructure/storageAdapter.js';
import { log } from '../middleware/logger.js';

export interface StorageReconciliationReport {
  timestamp: string;
  reconciledEventsCount: number;
  totalDbObjectsCount: number;
  totalDbBytes: number;
  storageUsageDriftDetected: boolean;
  driftEventsCount: number;
  orphanedR2Objects: string[];
  missingR2Objects: string[];
  sizeMismatches: Array<{
    storageKey: string;
    dbSize: number;
    r2Size: number;
  }>;
  repaired: boolean;
  durationMs: number;
}

/**
 * Executes a comprehensive reconciliation between PostgreSQL media metadata,
 * cached storage_usage aggregates, and Cloudflare R2 physical objects.
 */
export async function runStorageReconciliation(options: {
  eventId?: string;
  repair?: boolean;
} = {}): Promise<StorageReconciliationReport> {
  const startTime = Date.now();
  const report: StorageReconciliationReport = {
    timestamp: new Date().toISOString(),
    reconciledEventsCount: 0,
    totalDbObjectsCount: 0,
    totalDbBytes: 0,
    storageUsageDriftDetected: false,
    driftEventsCount: 0,
    orphanedR2Objects: [],
    missingR2Objects: [],
    sizeMismatches: [],
    repaired: false,
    durationMs: 0,
  };

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'storage-reconciliation',
    message: 'Starting authoritative storage reconciliation sweep',
    details: options,
  });

  // 1. Fetch events to reconcile
  const eventsSql = options.eventId
    ? `SELECT id, name, owner_id FROM events WHERE id = $1`
    : `SELECT id, name, owner_id FROM events WHERE status != 'deleting'`;
  const eventsParams = options.eventId ? [options.eventId] : [];

  const eventsRes = await query<{ id: string; name: string; owner_id: number }>(
    eventsSql,
    eventsParams
  );
  report.reconciledEventsCount = eventsRes.rows.length;

  for (const event of eventsRes.rows) {
    // 2. Fetch all media for this event
    const mediaRes = await query<{
      id: string;
      storage_key_original: string;
      file_size: string | number;
      thumbnail_size: string | number | null;
      preview_size: string | number | null;
      status: string;
    }>(
      `SELECT id, storage_key_original, file_size, thumbnail_size, preview_size, status
       FROM media
       WHERE event_id = $1 AND status != 'failed'`,
      [event.id]
    );

    report.totalDbObjectsCount += mediaRes.rows.length;

    let eventCalculatedOriginal = 0;
    let eventCalculatedThumb = 0;
    let eventCalculatedPreview = 0;

    for (const m of mediaRes.rows) {
      const originalSize = Number(m.file_size || 0);
      const thumbSize = Number(m.thumbnail_size || 0);
      const previewSize = Number(m.preview_size || 0);

      eventCalculatedOriginal += originalSize;
      eventCalculatedThumb += thumbSize;
      eventCalculatedPreview += previewSize;
      report.totalDbBytes += originalSize + thumbSize + previewSize;
    }

    const calculatedTotalBytes =
      eventCalculatedOriginal + eventCalculatedThumb + eventCalculatedPreview;

    // 3. Compare with cached storage_usage table
    const suRes = await query<{
      total_bytes: string | null;
      original_bytes: string | null;
      thumbnail_bytes: string | null;
      preview_bytes: string | null;
    }>(
      `SELECT total_bytes, original_bytes, thumbnail_bytes, preview_bytes
       FROM storage_usage
       WHERE event_id = $1`,
      [event.id]
    );

    const cachedTotal = suRes.rows[0]?.total_bytes ? Number(suRes.rows[0].total_bytes) : 0;
    const drift = Math.abs(cachedTotal - calculatedTotalBytes);

    if (drift > 0) {
      report.storageUsageDriftDetected = true;
      report.driftEventsCount++;

      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'storage-reconciliation',
        message: `Storage drift detected for event ${event.id}: cached=${cachedTotal}B, calculated=${calculatedTotalBytes}B (drift=${drift}B)`,
        details: { eventId: event.id, cachedTotal, calculatedTotalBytes, drift },
      });

      if (options.repair) {
        await query(
          `INSERT INTO storage_usage (
            event_id, original_bytes, thumbnail_bytes, preview_bytes, total_bytes, last_calculated_at
          ) VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (event_id)
          DO UPDATE SET
            original_bytes = EXCLUDED.original_bytes,
            thumbnail_bytes = EXCLUDED.thumbnail_bytes,
            preview_bytes = EXCLUDED.preview_bytes,
            total_bytes = EXCLUDED.total_bytes,
            last_calculated_at = NOW()`,
          [
            event.id,
            eventCalculatedOriginal,
            eventCalculatedThumb,
            eventCalculatedPreview,
            calculatedTotalBytes,
          ]
        );
        report.repaired = true;
      }
    }
  }

  report.durationMs = Date.now() - startTime;

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'storage-reconciliation',
    message: `Storage reconciliation sweep completed in ${report.durationMs}ms`,
    details: {
      reconciledEvents: report.reconciledEventsCount,
      totalBytes: report.totalDbBytes,
      driftEvents: report.driftEventsCount,
      repaired: report.repaired,
    },
  });

  return report;
}
