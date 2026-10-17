import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { processPhoto, processVideo } from './image_processor.js';
import { detectAndIndexPhoto } from '../ai/face_service.js';
import { recoverStaleJobs } from './job_recovery_service.js';

class ProcessingQueue {
  constructor() {
    this.isProcessing = false;
    this.baseConcurrency = 2; // Baseline low-memory concurrency
    this.maxConcurrency = 8; // Controlled resource ceiling
    this.concurrency = this.baseConcurrency;
    this.totalProcessedCount = 0;
    this.totalFailedCount = 0;
    this.lastProcessingDurationMs = 0;
    this.peakQueueDepth = 0;

    // Immediate crash/recovery scan on worker boot
    try {
      recoverStaleJobs({ staleThresholdMs: 60000 });
    } catch (e) {
      console.warn('[Queue Recovery] Startup recovery check error:', e.message);
    }
    this.startWorkerLoop();
  }

  /**
   * Determine dynamic batch concurrency based on current queue depth (Backpressure Auto-Scaling)
   */
  calculateDynamicConcurrency(queueDepth) {
    if (queueDepth > this.peakQueueDepth) {
      this.peakQueueDepth = queueDepth;
    }
    if (queueDepth <= 10) return this.baseConcurrency;
    if (queueDepth <= 100) return 4;
    if (queueDepth <= 500) return 6;
    return this.maxConcurrency;
  }

  /**
   * Start worker loop that picks pending jobs with adaptive tick frequency
   */
  startWorkerLoop() {
    const runTick = async () => {
      try {
        if (!this.isProcessing) {
          await this.processNextBatch();
        }
      } catch (err) {
        console.error('[Queue Worker Loop Error]:', err);
      } finally {
        // Fast tick (500ms) when active backlog exists, idle tick (2000ms) when empty
        let nextDelay = 2000;
        try {
          const count = db.prepare("SELECT COUNT(*) as depth FROM media WHERE status = 'uploaded'").get()?.depth || 0;
          nextDelay = count > 0 ? 500 : 2000;
        } catch (_e) {}
        setTimeout(runTick, nextDelay);
      }
    };
    setTimeout(runTick, 1000);

    // Periodic stale job recovery tick (every 60s)
    setInterval(() => {
      try {
        recoverStaleJobs({ staleThresholdMs: 300000 });
      } catch (e) {
        console.warn('[Queue Recovery] Periodic recovery tick error:', e.message);
      }
    }, 60000);
  }

  /**
   * Create an upload batch processing job
   */
  createJob(eventId, mediaIds, type = 'media_processing') {
    const jobId = uuidv4();
    db.prepare(`
      INSERT INTO processing_jobs (id, event_id, type, status, progress, total_items, processed_items)
      VALUES (?, ?, ?, 'pending', 0, ?, 0)
    `).run(jobId, eventId, type, mediaIds.length);
    return jobId;
  }

  /**
   * Process pending media in the database with dynamic auto-scaling & round-robin fair scheduling
   */
  async processNextBatch() {
    const countRow = db.prepare("SELECT COUNT(*) as depth FROM media WHERE status = 'uploaded'").get();
    const queueDepth = countRow ? countRow.depth : 0;
    if (queueDepth === 0) return;

    this.concurrency = this.calculateDynamicConcurrency(queueDepth);

    // Multi-Event Anti-Starvation Scheduling:
    // Identify distinct events with pending media items
    const distinctEvents = db.prepare(`
      SELECT DISTINCT event_id
      FROM media
      WHERE status = 'uploaded'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(this.concurrency);

    let pendingMedia = [];

    if (distinctEvents.length <= 1) {
      // Single event backlog: grab up to current concurrency
      pendingMedia = db.prepare(`
        SELECT m.*, e.watermark_enabled, e.watermark_text, e.face_search_enabled
        FROM media m
        JOIN events e ON m.event_id = e.id
        WHERE m.status = 'uploaded'
        ORDER BY m.created_at ASC
        LIMIT ?
      `).all(this.concurrency);
    } else {
      // Multiple active events: interleave items fairly across events (Round-Robin)
      const perEventLimit = Math.max(1, Math.floor(this.concurrency / distinctEvents.length));
      for (const ev of distinctEvents) {
        const eventItems = db.prepare(`
          SELECT m.*, e.watermark_enabled, e.watermark_text, e.face_search_enabled
          FROM media m
          JOIN events e ON m.event_id = e.id
          WHERE m.status = 'uploaded' AND m.event_id = ?
          ORDER BY m.created_at ASC
          LIMIT ?
        `).all(ev.event_id, perEventLimit);
        pendingMedia.push(...eventItems);
        if (pendingMedia.length >= this.concurrency) break;
      }
    }

    if (pendingMedia.length === 0) return;

    this.isProcessing = true;
    const batchStartTime = Date.now();

    for (const item of pendingMedia) {
      try {
        db.prepare("UPDATE media SET status = 'processing' WHERE id = ?").run(item.id);

        const tempFilePath = item.storage_key_original; // For newly uploaded items, this holds the temp path
        const ext = path.extname(item.filename).toLowerCase();
        const isPhoto = item.type === 'photo';

        if (fs.existsSync(tempFilePath)) {
          if (isPhoto) {
            // 1. Generate derivatives
            const derivatives = await processPhoto(
              tempFilePath,
              item.event_id,
              item.filename,
              {
                enabled: Boolean(item.watermark_enabled),
                text: item.watermark_text || 'Studio Lumina',
              }
            );

            // 2. Update media record with keys and metadata
            db.prepare(`
              UPDATE media SET
                width = ?,
                height = ?,
                storage_key_original = ?,
                storage_key_preview = ?,
                storage_key_thumbnail = ?,
                camera_make = ?,
                camera_model = ?,
                date_taken = ?,
                status = 'ready'
              WHERE id = ?
            `).run(
              derivatives.width,
              derivatives.height,
              derivatives.storageKeyOriginal,
              derivatives.storageKeyPreview,
              derivatives.storageKeyThumbnail,
              derivatives.cameraMake,
              derivatives.cameraModel,
              derivatives.dateTaken,
              item.id
            );

            // 3. AI Face Detection and Embedding (if enabled for event)
            if (item.face_search_enabled) {
              try {
                await detectAndIndexPhoto(item.id, tempFilePath);
              } catch (faceErr) {
                console.error(`[AI Face Indexing Warning] Photo ${item.id}:`, faceErr.message);
              }
            }

          } else {
            // Video processing
            const derivatives = await processVideo(tempFilePath, item.event_id, item.filename);
            db.prepare(`
              UPDATE media SET
                storage_key_original = ?,
                storage_key_preview = ?,
                storage_key_thumbnail = ?,
                status = 'ready'
              WHERE id = ?
            `).run(
              derivatives.storageKeyOriginal,
              derivatives.storageKeyPreview,
              derivatives.storageKeyThumbnail,
              item.id
            );
          }

          // Clean up temp upload file
          try {
            await fs.promises.unlink(tempFilePath);
          } catch (e) {
            // Ignore if unlink failed
          }
        }

        // Update active job progress
        this.updateJobProgress(item.event_id);

        this.totalProcessedCount += 1;
      } catch (err) {
        this.totalFailedCount += 1;
        console.error(`[Queue Processing Error] Media ${item.id}:`, err);
        let errorCategory = 'INTERNAL_WORKER_ERROR';
        const msg = String(err.message || '').toLowerCase();
        if (msg.includes('unsupported') || msg.includes('signature') || msg.includes('magic bytes')) {
          errorCategory = 'FILE_CORRUPT';
        } else if (msg.includes('storage') || msg.includes('r2') || msg.includes('s3') || msg.includes('bucket')) {
          errorCategory = 'STORAGE_UNAVAILABLE';
        } else if (msg.includes('face') || msg.includes('yunet') || msg.includes('sface')) {
          errorCategory = 'AI_INDEX_ERROR';
        } else if (msg.includes('timeout')) {
          errorCategory = 'PROCESSING_TIMEOUT';
        }

        db.prepare("UPDATE media SET status = 'failed' WHERE id = ?").run(item.id);

        // Update processing job with error category and check for DLQ transition
        const job = db.prepare(`
          SELECT * FROM processing_jobs
          WHERE event_id = ? AND status IN ('pending', 'processing')
          ORDER BY created_at DESC LIMIT 1
        `).get(item.event_id);

        if (job) {
          const currentRetries = (job.retry_count || 0) + 1;
          const maxRetries = job.max_retries || 3;
          const newStatus = currentRetries >= maxRetries ? 'dead_letter' : 'failed';

          db.prepare(`
            UPDATE processing_jobs
            SET retry_count = ?, error_category = ?, error_message = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(currentRetries, errorCategory, err.message?.slice(0, 500) || 'Processing failure', newStatus, job.id);
        }
      } finally {
        // Guarantee temporary upload file is unlinked on both success and failure
        const tempFilePath = item.storage_key_original;
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (e) {}
        }
      }
    }

    this.lastProcessingDurationMs = Date.now() - batchStartTime;
    this.isProcessing = false;
  }

  /**
   * Recalculate job progress for an event
   */
  updateJobProgress(eventId) {
    const job = db.prepare(`
      SELECT * FROM processing_jobs
      WHERE event_id = ? AND status IN ('pending', 'processing')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(eventId);

    if (!job) return;

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('ready', 'failed') THEN 1 ELSE 0 END) as done
      FROM media
      WHERE event_id = ?
    `).get(eventId);

    const total = stats.total || 1;
    const done = stats.done || 0;
    const progress = Math.min(100, Math.round((done / total) * 100));
    const status = done >= total ? 'completed' : 'processing';

    db.prepare(`
      UPDATE processing_jobs
      SET progress = ?, processed_items = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(progress, done, status, job.id);
  }

  /**
   * Safe Bounded Idempotent Job Retry (Phase 45)
   */
  retryJob(jobId) {
    const job = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status === 'completed') {
      throw new Error(`Job ${jobId} is already completed`);
    }

    const currentRetries = job.retry_count || 0;
    const maxRetries = job.max_retries || 3;

    if (currentRetries > maxRetries + 2) {
      throw new Error(`Job ${jobId} has exceeded maximum safe retry attempts (${maxRetries})`);
    }

    // Reset failed media items for this event back to 'uploaded' if temp file exists
    const failedMedia = db.prepare("SELECT id, storage_key_original FROM media WHERE event_id = ? AND status = 'failed'").all(job.event_id);
    for (const m of failedMedia) {
      if (m.storage_key_original && fs.existsSync(m.storage_key_original)) {
        db.prepare("UPDATE media SET status = 'uploaded' WHERE id = ?").run(m.id);
      }
    }

    // Reset job state to 'pending'
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'pending', retry_count = retry_count + 1, error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(jobId);

    return {
      success: true,
      jobId,
      status: 'pending',
      retryCount: currentRetries + 1,
    };
  }

  /**
   * Cancel an active or failed job (Phase 45)
   */
  cancelJob(jobId) {
    const job = db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    db.prepare(`
      UPDATE processing_jobs
      SET status = 'cancelled', error_message = 'Cancelled by administrator', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(jobId);

    return {
      success: true,
      jobId,
      status: 'cancelled',
    };
  }

  /**
   * Return real-time queue depth, active concurrency, and processing telemetry
   */
  getMetrics() {
    let queueDepth = 0;
    let processingCount = 0;
    try {
      queueDepth = db.prepare("SELECT COUNT(*) as depth FROM media WHERE status = 'uploaded'").get()?.depth || 0;
      processingCount = db.prepare("SELECT COUNT(*) as processing FROM media WHERE status = 'processing'").get()?.processing || 0;
    } catch (_e) {}

    return {
      queueDepth,
      processingCount,
      activeConcurrency: this.concurrency,
      baseConcurrency: this.baseConcurrency,
      maxConcurrency: this.maxConcurrency,
      peakQueueDepth: this.peakQueueDepth,
      totalProcessed: this.totalProcessedCount,
      totalFailed: this.totalFailedCount,
      lastBatchDurationMs: this.lastProcessingDurationMs,
      isProcessing: this.isProcessing,
    };
  }
}

export const queue = new ProcessingQueue();
export default queue;
