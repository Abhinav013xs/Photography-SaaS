import storage from '../storage/r2.js';
import db from '../db.js';

/**
 * Consistency Checker Service
 * Audits relational database media records against object storage (Cloudflare R2 / local fallback).
 * Detects missing storage objects and orphaned files.
 */

/**
 * Runs a complete consistency audit across the database and storage.
 * @param {object} options
 * @param {string} [options.eventId] - Optional event ID filter
 * @param {object} [options.customDb] - Optional custom database instance (for testing)
 * @param {object} [options.customStorage] - Optional custom storage adapter (for testing)
 * @returns {Promise<ConsistencyReport>}
 */
export async function runConsistencyAudit({ eventId = null, customDb = null, customStorage = null } = {}) {
  const activeDb = customDb || db;
  const activeStorage = customStorage || storage;

  let query = 'SELECT id, event_id, filename, storage_key_original, storage_key_preview, storage_key_thumbnail FROM media';
  const params = [];
  if (eventId) {
    query += ' WHERE event_id = ?';
    params.push(eventId);
  }

  const mediaRecords = activeDb.prepare ? activeDb.prepare(query).all(...params) : [];

  const missingInStorage = [];
  const knownStorageKeys = new Set();

  for (const record of mediaRecords) {
    const keysToCheck = [
      { type: 'original', key: record.storage_key_original },
      { type: 'preview', key: record.storage_key_preview },
      { type: 'thumbnail', key: record.storage_key_thumbnail },
    ].filter((item) => Boolean(item.key));

    for (const item of keysToCheck) {
      knownStorageKeys.add(item.key);
      const exists = await activeStorage.hasObject(item.key);
      if (!exists) {
        missingInStorage.push({
          mediaId: record.id,
          eventId: record.event_id,
          filename: record.filename,
          derivativeType: item.type,
          storageKey: item.key,
        });
      }
    }
  }

  // Scan storage for orphaned objects
  let prefix = '';
  if (eventId) {
    prefix = `events/${eventId}/`;
  }
  const allStorageKeys = await activeStorage.listKeys(prefix);
  const orphanedInStorage = [];

  for (const key of allStorageKeys) {
    // Only consider objects under events/
    if (key.startsWith('events/') && !knownStorageKeys.has(key)) {
      orphanedInStorage.push(key);
    }
  }

  const isConsistent = missingInStorage.length === 0 && orphanedInStorage.length === 0;

  return {
    timestamp: new Date().toISOString(),
    isConsistent,
    summary: {
      totalMediaRecordsAudited: mediaRecords.length,
      totalStorageKeysAudited: allStorageKeys.length,
      missingObjectCount: missingInStorage.length,
      orphanedObjectCount: orphanedInStorage.length,
    },
    missingInStorage,
    orphanedInStorage,
  };
}

export default {
  runConsistencyAudit,
};
