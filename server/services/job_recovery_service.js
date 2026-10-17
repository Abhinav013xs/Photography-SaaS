import fs from 'fs';
import db from '../db.js';

/**
 * Background Job & Worker Recovery Service
 * Identifies and recovers jobs stuck in 'processing' due to server crashes,
 * worker OOM terminations, or network timeouts.
 */

/**
 * Reaps orphaned leases and recovers stuck processing jobs.
 * @param {object} [options]
 * @param {number} [options.staleThresholdMs=300000] - 5 minutes default
 * @param {object} [options.customDb] - Optional custom DB instance
 * @returns {RecoveryReport}
 */
export function recoverStaleJobs({ staleThresholdMs = 300000, customDb = null } = {}) {
  const activeDb = customDb || db;
  const startTime = Date.now();

  // 1. Recover stuck media items
  // If an item has been in 'processing' longer than staleThresholdMs:
  const thresholdIso = new Date(Date.now() - staleThresholdMs).toISOString();

  // Find all stuck media items
  let stuckMedia = [];
  try {
    stuckMedia = activeDb.prepare(`
      SELECT id, event_id, storage_key_original, status, created_at
      FROM media
      WHERE status = 'processing'
    `).all();
  } catch {
    stuckMedia = [];
  }

  let mediaResetCount = 0;
  let mediaFailedCount = 0;

  for (const item of stuckMedia) {
    const tempFileExists = item.storage_key_original && fs.existsSync(item.storage_key_original);
    if (tempFileExists) {
      // Temp file still exists on disk; reset to 'uploaded' so worker loop re-picks it
      activeDb.prepare("UPDATE media SET status = 'uploaded' WHERE id = ?").run(item.id);
      mediaResetCount++;
    } else {
      // Temp file lost; mark as 'failed'
      activeDb.prepare("UPDATE media SET status = 'failed' WHERE id = ?").run(item.id);
      mediaFailedCount++;
    }
  }

  // 2. Recover stuck processing_jobs
  let stuckJobs = [];
  try {
    stuckJobs = activeDb.prepare(`
      SELECT id, event_id, status, total_items, processed_items
      FROM processing_jobs
      WHERE status = 'processing'
    `).all();
  } catch {
    stuckJobs = [];
  }

  let jobsUpdatedCount = 0;

  for (const job of stuckJobs) {
    // Check actual media completion status for this event
    const stats = activeDb.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('ready', 'failed') THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END) as pending
      FROM media
      WHERE event_id = ?
    `).get(job.event_id);

    const total = stats.total || 0;
    const done = stats.done || 0;
    const pending = stats.pending || 0;

    let newStatus = 'processing';
    if (total === 0 || done >= total) {
      newStatus = 'completed';
    } else if (pending > 0) {
      newStatus = 'pending';
    }

    const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;

    activeDb.prepare(`
      UPDATE processing_jobs
      SET status = ?, progress = ?, processed_items = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newStatus, progress, done, job.id);

    jobsUpdatedCount++;
  }

  return {
    recoveredAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    mediaResetCount,
    mediaFailedCount,
    jobsUpdatedCount,
    totalRecovered: mediaResetCount + mediaFailedCount + jobsUpdatedCount,
  };
}

export default {
  recoverStaleJobs,
};
