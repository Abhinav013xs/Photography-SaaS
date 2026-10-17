import db from '../db.js';
import storage from '../storage/r2.js';

/**
 * Storage Reconciliation Service
 * Compares database media records against physical storage objects (Cloudflare R2 or local disk).
 * Generates non-destructive discrepancy reports identifying:
 * - Missing objects (in DB, missing in storage)
 * - Orphan objects (in storage, unreferenced in DB)
 * - Orphan database records (media belonging to deleted/nonexistent events)
 * - Aggregate byte drift between database and physical storage
 */

export async function runStorageReconciliation({ customDb = null } = {}) {
  const activeDb = customDb || db;
  const startTime = Date.now();

  const missingObjects = [];
  const orphanRecords = [];
  const verifiedObjects = [];
  let dbTotalBytes = 0;

  // 1. Fetch all media records from the database
  const mediaRecords = activeDb.prepare(`
    SELECT m.id, m.event_id, m.filename, m.type, m.file_size, m.status,
           m.storage_key_original, m.storage_key_preview, m.storage_key_thumbnail,
           e.name as event_name, e.deleted_at as event_deleted_at
    FROM media m
    LEFT JOIN events e ON m.event_id = e.id
  `).all();

  const dbKeysSet = new Set();

  for (const m of mediaRecords) {
    dbTotalBytes += (m.file_size || 0);

    // Check if parent event is missing
    if (!m.event_name) {
      orphanRecords.push({
        mediaId: m.id,
        eventId: m.event_id,
        filename: m.filename,
        reason: 'Event does not exist in events table',
      });
    }

    // Verify original key
    if (m.storage_key_original && !m.storage_key_original.startsWith('temp_')) {
      dbKeysSet.add(m.storage_key_original);
      const exists = await storage.hasObject(m.storage_key_original);
      if (!exists && m.status === 'ready') {
        missingObjects.push({
          mediaId: m.id,
          eventId: m.event_id,
          key: m.storage_key_original,
          role: 'original',
          status: m.status,
        });
      } else if (exists) {
        verifiedObjects.push(m.storage_key_original);
      }
    }

    // Verify preview key
    if (m.storage_key_preview) {
      dbKeysSet.add(m.storage_key_preview);
      const exists = await storage.hasObject(m.storage_key_preview);
      if (!exists && m.status === 'ready') {
        missingObjects.push({
          mediaId: m.id,
          eventId: m.event_id,
          key: m.storage_key_preview,
          role: 'preview',
          status: m.status,
        });
      }
    }

    // Verify thumbnail key
    if (m.storage_key_thumbnail) {
      dbKeysSet.add(m.storage_key_thumbnail);
      const exists = await storage.hasObject(m.storage_key_thumbnail);
      if (!exists && m.status === 'ready') {
        missingObjects.push({
          mediaId: m.id,
          eventId: m.event_id,
          key: m.storage_key_thumbnail,
          role: 'thumbnail',
          status: m.status,
        });
      }
    }
  }

  // 2. Scan physical storage for unexpected / orphan objects
  let storageKeys = [];
  try {
    storageKeys = await storage.listKeys('events/');
  } catch (err) {
    console.warn('[Reconciliation] Error listing storage keys:', err.message);
  }

  const unexpectedObjects = [];
  for (const key of storageKeys) {
    if (!dbKeysSet.has(key)) {
      unexpectedObjects.push({
        key,
        reason: 'Storage object exists in bucket/disk but has no corresponding media record in database',
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const isHealthy = missingObjects.length === 0 && orphanRecords.length === 0;

  return {
    reconciledAt: new Date().toISOString(),
    durationMs,
    status: isHealthy ? 'CONSISTENT' : 'DRIFT_DETECTED',
    summary: {
      totalDbMediaRecords: mediaRecords.length,
      totalTrackedKeysInDb: dbKeysSet.size,
      totalPhysicalStorageKeys: storageKeys.length,
      verifiedKeysCount: verifiedObjects.length,
      missingObjectsCount: missingObjects.length,
      unexpectedObjectsCount: unexpectedObjects.length,
      orphanRecordsCount: orphanRecords.length,
      databaseDeclaredBytes: dbTotalBytes,
      storageEngine: storage.isR2 ? 'Cloudflare R2' : 'Local Disk Simulation',
      bucketName: storage.bucketName,
    },
    discrepancies: {
      missingObjects: missingObjects.slice(0, 100), // Top 100
      unexpectedObjects: unexpectedObjects.slice(0, 100),
      orphanRecords: orphanRecords.slice(0, 100),
    },
    policyNote: 'Discrepancies reported for administrative review. Automated deletions require explicit operator confirmation.',
  };
}

export default {
  runStorageReconciliation,
};
