import sharp, { type Metadata } from 'sharp';
import { query } from '../infrastructure/database.js';
import { storageAdapter } from '../infrastructure/storageAdapter.js';
import { logger } from '../utils/logger.js';
import {
  MediaNotFoundError,
  CorruptImageError,
  DecompressionBombError,
  ImageProcessingError,
  StorageConfigError,
} from '@photography-saas/errors';
import {
  buildStorageKey,
  type ProcessPhotoResponseDTO,
  type ProcessBatchResponseDTO,
  type WatermarkConfig,
  type WatermarkPosition,
  type WatermarkSize,
  type WatermarkColor,
} from '@photography-saas/types';

/**
 * Image processing configuration defaults
 */
export const IMAGE_PROCESSING_CONFIG = {
  thumbnail: {
    maxWidth: 480,
    maxHeight: 480,
    quality: 80,
    format: 'webp' as const,
  },
  preview: {
    maxWidth: 1920,
    maxHeight: 1920,
    quality: 85,
    format: 'webp' as const,
  },
  maxPixels: 50_000_000, // 50 Megapixels ceiling for decompression bomb protection
  workerConcurrency: 2,
};

/**
 * Escapes XML/SVG special characters in text to prevent markup or script injection.
 */
export function escapeXmlText(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates an SVG watermark overlay Buffer dynamically scaled and positioned
 * to match exact target image dimensions.
 */
export function generateWatermarkSvg(
  text: string,
  width: number,
  height: number,
  config: Partial<WatermarkConfig> = {}
): Buffer {
  const sanitizedText = escapeXmlText(text.trim() || 'Studio Lumina');
  const opacity =
    typeof config.opacity === 'number' ? Math.max(0.05, Math.min(1.0, config.opacity)) : 0.35;
  const size: WatermarkSize = config.size || 'medium';
  const position: WatermarkPosition = config.position || 'bottom-right';
  const color: WatermarkColor = config.color || 'white';

  const minDim = Math.min(width, height);

  // Responsive font scaling relative to image dimensions
  let scale = 0.048;
  if (size === 'small') scale = 0.032;
  else if (size === 'large') scale = 0.072;

  const fontSize = Math.max(12, Math.round(minDim * scale));
  const letterSpacing = Math.max(1, Math.round(fontSize * 0.08));
  const margin = Math.max(12, Math.round(minDim * 0.035));

  let x: number;
  let y: number;
  let textAnchor: string;
  let dominantBaseline: string;

  switch (position) {
    case 'center':
      x = Math.round(width / 2);
      y = Math.round(height / 2);
      textAnchor = 'middle';
      dominantBaseline = 'central';
      break;
    case 'bottom-center':
      x = Math.round(width / 2);
      y = height - margin;
      textAnchor = 'middle';
      dominantBaseline = 'auto';
      break;
    case 'bottom-right':
    default:
      x = width - margin;
      y = height - margin;
      textAnchor = 'end';
      dominantBaseline = 'auto';
      break;
  }

  const isBlack = color === 'black';
  const fillColor = isBlack ? '#000000' : '#ffffff';
  const strokeColor = isBlack ? '#ffffff' : '#000000';
  const strokeOpacity = Math.min(1.0, opacity * 1.2);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .watermark {
      font-family: 'Plus Jakarta Sans', 'Inter', 'Segoe UI', -apple-system, sans-serif;
      font-size: ${fontSize}px;
      font-weight: 600;
      letter-spacing: ${letterSpacing}px;
      fill: ${fillColor};
      fill-opacity: ${opacity};
      stroke: ${strokeColor};
      stroke-width: 1px;
      stroke-opacity: ${strokeOpacity};
    }
  </style>
  <text x="${x}" y="${y}" text-anchor="${textAnchor}" dominant-baseline="${dominantBaseline}" class="watermark">${sanitizedText}</text>
</svg>`;

  return Buffer.from(svg);
}

/**
 * Validates that an image buffer begins with recognizable JPEG, PNG, or WebP magic bytes.
 */
export function validateImageMagicBytes(buffer: Buffer): 'jpeg' | 'png' | 'webp' {
  if (!buffer || buffer.length < 12) {
    throw new CorruptImageError('Buffer is too small to contain a valid image header');
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // WebP: RIFF (bytes 0..3) ... WEBP (bytes 8..11)
  if (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return 'webp';
  }

  throw new CorruptImageError(
    'Unsupported or invalid image file signature. Expected JPEG, PNG, or WebP.'
  );
}

export interface GeneratedDerivatives {
  thumbnailBuffer: Buffer;
  previewBuffer: Buffer;
  width: number;
  height: number;
}

/**
 * Validates and transforms an image buffer into optimized thumbnail and preview WebP derivatives.
 * Enforces orientation normalization, aspect ratio preservation, decompression bomb guards,
 * and strips unnecessary metadata.
 * When watermark config is provided and enabled, composites an SVG watermark onto derivatives.
 */
export async function generateDerivatives(
  buffer: Buffer,
  config = IMAGE_PROCESSING_CONFIG,
  watermark?: WatermarkConfig | null
): Promise<GeneratedDerivatives> {
  // 1. Verify binary magic bytes
  validateImageMagicBytes(buffer);

  // 2. Decode metadata safely
  let metadata: Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (err) {
    throw new CorruptImageError(
      `Failed to parse image metadata: ${err instanceof Error ? err.message : 'Corrupt image data'}`
    );
  }

  const origWidth = metadata.width ?? 0;
  const origHeight = metadata.height ?? 0;

  if (origWidth <= 0 || origHeight <= 0) {
    throw new CorruptImageError('Image metadata contains non-positive dimensions');
  }

  // 3. Decompression bomb guard
  const pixelCount = origWidth * origHeight;
  if (pixelCount > config.maxPixels) {
    throw new DecompressionBombError(
      `Image dimensions (${origWidth}x${origHeight} = ${(pixelCount / 1_000_000).toFixed(1)} MP) exceed maximum safety limit of ${(config.maxPixels / 1_000_000).toFixed(0)} MP`
    );
  }

  // 4. Generate thumbnail (480x480 max, webp q80, auto-orient, no upscale, strip metadata)
  let thumbnailBuffer: Buffer;
  try {
    const { data: rawThumbBuffer, info: thumbInfo } = await sharp(buffer)
      .rotate()
      .resize(config.thumbnail.maxWidth, config.thumbnail.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });

    let thumbPipeline = sharp(rawThumbBuffer);
    if (watermark?.enabled && watermark.text) {
      const wmSvg = generateWatermarkSvg(
        watermark.text,
        thumbInfo.width,
        thumbInfo.height,
        watermark
      );
      thumbPipeline = thumbPipeline.composite([{ input: wmSvg }]);
    }

    thumbnailBuffer = await thumbPipeline.webp({ quality: config.thumbnail.quality }).toBuffer();
  } catch (err) {
    throw new ImageProcessingError(
      `Failed generating thumbnail derivative: ${err instanceof Error ? err.message : 'Sharp transformation error'}`
    );
  }

  // 5. Generate preview (1920x1920 max, webp q85, auto-orient, no upscale, strip metadata)
  let previewBuffer: Buffer;
  try {
    const { data: rawPreviewBuffer, info: previewInfo } = await sharp(buffer)
      .rotate()
      .resize(config.preview.maxWidth, config.preview.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });

    let previewPipeline = sharp(rawPreviewBuffer);
    if (watermark?.enabled && watermark.text) {
      const wmSvg = generateWatermarkSvg(
        watermark.text,
        previewInfo.width,
        previewInfo.height,
        watermark
      );
      previewPipeline = previewPipeline.composite([{ input: wmSvg }]);
    }

    previewBuffer = await previewPipeline.webp({ quality: config.preview.quality }).toBuffer();
  } catch (err) {
    throw new ImageProcessingError(
      `Failed generating preview derivative: ${err instanceof Error ? err.message : 'Sharp transformation error'}`
    );
  }

  return {
    thumbnailBuffer,
    previewBuffer,
    width: origWidth,
    height: origHeight,
  };
}

interface MediaRow {
  id: string;
  event_id: string;
  storage_key_original: string;
  storage_key_thumbnail: string | null;
  storage_key_preview: string | null;
  status: string;
  file_size: string | number;
  mime_type: string;
  filename: string;
  thumbnail_size: string | number | null;
  preview_size: string | number | null;
  width: number | null;
  height: number | null;
  watermark_applied?: boolean | null;
  watermark_version?: number | null;
  event_status?: string | null;
  e_watermark_enabled?: boolean | null;
  e_watermark_text?: string | null;
  e_watermark_opacity?: number | null;
  e_watermark_size?: string | null;
  e_watermark_position?: string | null;
  e_watermark_color?: string | null;
  e_watermark_version?: number | null;
}

export interface ProcessPhotoOptions {
  forceReprocess?: boolean;
  expectedWatermarkVersion?: number;
}

/**
 * Processes an individual photo media record:
 * - Checks eligibility and idempotency against current event watermark version.
 * - Downloads clean untouched original from private R2 storage.
 * - Generates WebP thumbnail and preview derivatives (with watermark when enabled).
 * - Uploads derivatives to private R2 storage under deterministic keys.
 * - Updates media row with derivative sizes, dimensions, watermark metadata, and status = 'ready'.
 * - Enforces atomic version check preventing stale jobs from overwriting newer derivatives.
 * - Records errors cleanly with status = 'failed' without touching the original.
 */
export async function processPhoto(
  mediaId: string,
  eventIdHint?: string,
  options?: ProcessPhotoOptions
): Promise<ProcessPhotoResponseDTO> {
  const startTime = Date.now();

  // 1. Fetch media record joined with parent event watermark configuration
  const mediaRes = await query<MediaRow>(
    `SELECT m.id, m.event_id, m.storage_key_original, m.storage_key_thumbnail, m.storage_key_preview,
            m.status, m.file_size, m.mime_type, m.filename, m.thumbnail_size, m.preview_size, m.width, m.height,
            m.watermark_applied, m.watermark_version,
            e.status as event_status,
            e.watermark_enabled as e_watermark_enabled,
            e.watermark_text as e_watermark_text,
            COALESCE(e.watermark_opacity, 0.35) as e_watermark_opacity,
            COALESCE(e.watermark_size, 'medium') as e_watermark_size,
            COALESCE(e.watermark_position, 'bottom-right') as e_watermark_position,
            COALESCE(e.watermark_color, 'white') as e_watermark_color,
            COALESCE(e.watermark_version, 1) as e_watermark_version
     FROM media m
     JOIN events e ON e.id = m.event_id
     WHERE m.id = $1`,
    [mediaId]
  );

  if (mediaRes.rows.length === 0) {
    throw new MediaNotFoundError(`Media item "${mediaId}" not found for processing`);
  }

  const media = mediaRes.rows[0];
  const eventId = media.event_id;

  // Lifecycle check: skip if parent event is currently being deleted or deleted
  if (['deleting', 'deleted'].includes(media.event_status || '')) {
    logger.info('Skipping photo processing: parent event is being deleted', {
      service: 'image-processor',
      mediaId,
      eventId,
      status: media.event_status,
    });
    return {
      mediaId: media.id,
      status: 'failed',
      skipped: true,
      thumbnailKey: media.storage_key_thumbnail || '',
      previewKey: media.storage_key_preview || '',
      thumbnailSize: Number(media.thumbnail_size || 0),
      previewSize: Number(media.preview_size || 0),
      width: media.width || 0,
      height: media.height || 0,
    };
  }

  const targetWatermarkVersion = Number(media.e_watermark_version || 1);

  // Concurrency guard: Check if this job is superseded by a newer watermark version
  if (
    options?.expectedWatermarkVersion !== undefined &&
    options.expectedWatermarkVersion < targetWatermarkVersion
  ) {
    logger.info('Skipping stale photo processing job superseded by newer watermark version', {
      service: 'image-processor',
      mediaId,
      jobVersion: options.expectedWatermarkVersion,
      currentVersion: targetWatermarkVersion,
    });
    return {
      mediaId: media.id,
      status: media.status as any,
      skipped: true,
      thumbnailKey: media.storage_key_thumbnail || '',
      previewKey: media.storage_key_preview || '',
      thumbnailSize: Number(media.thumbnail_size || 0),
      previewSize: Number(media.preview_size || 0),
      width: media.width,
      height: media.height,
    };
  }

  const isWatermarkInSync = Number(media.watermark_version || 0) === targetWatermarkVersion;

  // Idempotency check: if already processed and ready with current watermark version, return existing metadata
  if (
    !options?.forceReprocess &&
    media.status === 'ready' &&
    media.storage_key_thumbnail &&
    media.storage_key_preview &&
    media.thumbnail_size &&
    media.preview_size &&
    isWatermarkInSync
  ) {
    return {
      mediaId: media.id,
      status: 'ready',
      thumbnailKey: media.storage_key_thumbnail,
      previewKey: media.storage_key_preview,
      thumbnailSize: Number(media.thumbnail_size),
      previewSize: Number(media.preview_size),
      width: media.width,
      height: media.height,
    };
  }

  // 2. Mark status as 'processing'
  await query(`UPDATE media SET status = 'processing', updated_at = NOW() WHERE id = $1`, [
    mediaId,
  ]);

  logger.info('Starting image derivative generation', {
    service: 'image-processor',
    mediaId,
    eventId,
    originalKey: media.storage_key_original,
    watermarkEnabled: Boolean(media.e_watermark_enabled),
    watermarkVersion: targetWatermarkVersion,
  });

  const thumbnailKey = buildStorageKey(eventId, 'thumbnails', `${mediaId}.webp`);
  const previewKey = buildStorageKey(eventId, 'previews', `${mediaId}.webp`);

  const watermarkConfig: WatermarkConfig = {
    enabled: Boolean(media.e_watermark_enabled),
    text: media.e_watermark_text || 'Studio Lumina',
    opacity: Number(media.e_watermark_opacity || 0.35),
    size: (media.e_watermark_size as WatermarkSize) || 'medium',
    position: (media.e_watermark_position as WatermarkPosition) || 'bottom-right',
    color: (media.e_watermark_color as WatermarkColor) || 'white',
  };

  try {
    // 3. Fetch clean original buffer from R2
    const originalBuffer = await storageAdapter.getObject(media.storage_key_original);

    // 4. Transform derivatives (with watermark applied if enabled)
    const derivatives = await generateDerivatives(
      originalBuffer,
      IMAGE_PROCESSING_CONFIG,
      watermarkConfig
    );

    // 5. Upload thumbnail derivative
    await storageAdapter.putObject(thumbnailKey, derivatives.thumbnailBuffer, 'image/webp', {
      'parent-media-id': mediaId,
      'derivative-type': 'thumbnail',
    });

    // 6. Upload preview derivative
    await storageAdapter.putObject(previewKey, derivatives.previewBuffer, 'image/webp', {
      'parent-media-id': mediaId,
      'derivative-type': 'preview',
    });

    const thumbnailSize = derivatives.thumbnailBuffer.length;
    const previewSize = derivatives.previewBuffer.length;

    if (thumbnailSize === 0 || previewSize === 0) {
      throw new ImageProcessingError('Generated derivative buffer has zero bytes');
    }

    const evCheck = await query<{ status: string }>(
      'SELECT status FROM events WHERE id = $1',
      [eventId]
    );
    if (evCheck.rows.length === 0 || ['deleting', 'trashed', 'deleted'].includes(evCheck.rows[0].status)) {
      logger.info('Aborting image processing commit: parent event was trashed or deleted', {
        service: 'image-processor',
        mediaId,
        eventId,
      });
      return {
        mediaId,
        status: 'failed',
        error: `Parent event is ${evCheck.rows[0]?.status || 'deleted'}`,
      };
    }

    // 7. Update media database row to 'ready' with version concurrency protection
    await query(
      `UPDATE media
       SET status = 'ready',
           storage_key_thumbnail = $1,
           storage_key_preview = $2,
           thumbnail_size = $3,
           preview_size = $4,
           width = $5,
           height = $6,
           watermark_applied = $7,
           watermark_version = $8,
           processed_at = NOW(),
           processing_error = NULL,
           updated_at = NOW()
       WHERE id = $9 AND (watermark_version <= $8 OR watermark_version IS NULL)`,
      [
        thumbnailKey,
        previewKey,
        thumbnailSize,
        previewSize,
        derivatives.width,
        derivatives.height,
        watermarkConfig.enabled,
        targetWatermarkVersion,
        mediaId,
      ]
    );

    const durationMs = Date.now() - startTime;
    logger.info('Image derivative processing completed successfully', {
      service: 'image-processor',
      mediaId,
      eventId,
      thumbnailKey,
      thumbnailSize,
      previewKey,
      previewSize,
      width: derivatives.width,
      height: derivatives.height,
      watermarkApplied: watermarkConfig.enabled,
      watermarkVersion: targetWatermarkVersion,
      durationMs,
    });

    return {
      mediaId,
      status: 'ready',
      thumbnailKey,
      previewKey,
      thumbnailSize,
      previewSize,
      width: derivatives.width,
      height: derivatives.height,
    };
  } catch (error: unknown) {
    if (error instanceof StorageConfigError) {
      // Storage credentials not configured (e.g. local development or test without R2 credentials).
      // Keep status as 'uploaded' so processing can occur once storage is available.
      await query(`UPDATE media SET status = 'uploaded', updated_at = NOW() WHERE id = $1`, [
        mediaId,
      ]);

      logger.debug('Storage is unconfigured; preserved media in uploaded status', {
        service: 'image-processor',
        mediaId,
        eventId,
      });

      return {
        mediaId,
        status: 'uploaded',
        error: error.message,
      };
    }

    const safeError =
      error instanceof Error ? error.message : 'Unknown error during image processing';

    // 8. Record failure safely in database without modifying or deleting the original
    await query(
      `UPDATE media
       SET status = 'failed',
           processing_error = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [safeError, mediaId]
    );

    const durationMs = Date.now() - startTime;
    logger.error('Image derivative processing failed', {
      service: 'image-processor',
      mediaId,
      eventId,
      error: safeError,
      durationMs,
    });

    return {
      mediaId,
      status: 'failed',
      error: safeError,
    };
  }
}

/**
 * Processes a batch of photos synchronously or for retry endpoints.
 */
export async function processPhotoBatch(
  mediaIds: string[],
  eventId: string
): Promise<ProcessBatchResponseDTO> {
  const processed: ProcessPhotoResponseDTO[] = [];
  const failed: Array<{ mediaId: string; error: string }> = [];

  for (const mediaId of mediaIds) {
    try {
      const result = await processPhoto(mediaId, eventId);
      processed.push(result);
    } catch (err) {
      failed.push({
        mediaId,
        error: err instanceof Error ? err.message : 'Failed to process photo',
      });
    }
  }

  return { processed, failed };
}

/**
 * Bounded Concurrency In-Process Processing Queue
 * Ensures background processing executes outside HTTP request/response loops,
 * avoids memory exhaustion with bounded concurrency, and deduplicates in-flight tasks.
 */
export class AsyncImageProcessingQueue {
  private queue: Array<{ mediaId: string; eventId: string }> = [];
  private queuedSet = new Set<string>();
  private activeCount = 0;
  private readonly concurrency: number;
  private drainResolvers: Array<() => void> = [];

  constructor(concurrency = IMAGE_PROCESSING_CONFIG.workerConcurrency) {
    this.concurrency = Math.max(1, concurrency);
  }

  /**
   * Non-blocking enqueue of a photo for derivative processing.
   * Silently deduplicates if the item is already queued or active.
   */
  enqueue(mediaId: string, eventId: string): void {
    if (this.queuedSet.has(mediaId)) {
      return;
    }
    this.queuedSet.add(mediaId);
    this.queue.push({ mediaId, eventId });
    this.processNext();
  }

  /**
   * Enqueues an entire batch of confirmed media items.
   */
  enqueueBatch(items: Array<{ mediaId: string; eventId: string }>): void {
    for (const item of items) {
      this.enqueue(item.mediaId, item.eventId);
    }
  }

  /**
   * Internal worker loop advancing queue tasks up to concurrency capacity.
   */
  private processNext(): void {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      if (this.activeCount === 0 && this.queue.length === 0) {
        const resolvers = [...this.drainResolvers];
        this.drainResolvers = [];
        for (const resolve of resolvers) {
          resolve();
        }
      }
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;

    (async () => {
      try {
        await processPhoto(item.mediaId, item.eventId);
      } catch (err) {
        logger.warn('Asynchronous image processing worker reported error', {
          service: 'image-processor',
          mediaId: item.mediaId,
          eventId: item.eventId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.activeCount--;
        this.queuedSet.delete(item.mediaId);
        this.processNext();
      }
    })();

    // Fill remaining concurrency slots
    if (this.activeCount < this.concurrency && this.queue.length > 0) {
      this.processNext();
    }
  }

  /**
   * Returns current queue diagnostics.
   */
  getStats() {
    return {
      pending: this.queue.length,
      active: this.activeCount,
      totalInFlight: this.queuedSet.size,
      concurrency: this.concurrency,
    };
  }

  /**
   * Waits until all pending and active tasks complete.
   * Useful for testing and graceful server shutdown.
   */
  waitForDrained(): Promise<void> {
    if (this.activeCount === 0 && this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  /**
   * Clears all pending tasks in the queue (active ones continue to completion).
   */
  clear(): void {
    this.queue = [];
    this.queuedSet.clear();
  }
}

/**
 * Singleton instance of the image processing queue
 */
export const imageProcessingQueue = new AsyncImageProcessingQueue();
