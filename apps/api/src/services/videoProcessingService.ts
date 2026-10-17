import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { query } from '../infrastructure/database.js';
import { storageAdapter } from '../infrastructure/storageAdapter.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '@photography-saas/config';
import {
  MediaNotFoundError,
  StorageConfigError,
  CorruptVideoError,
  VideoDurationExceededError,
  VideoDimensionsExceededError,
  VideoProcessingError,
} from '@photography-saas/errors';
import {
  buildStorageKey,
  type ProcessVideoResponseDTO,
  type VideoProbeMetadata,
} from '@photography-saas/types';

export const processExecutor = {
  execFile: async (
    file: string,
    args: readonly string[],
    options?: any
  ): Promise<{ stdout: string; stderr: string }> => {
    const res = (await (promisify(execFile) as any)(file, args, options)) as {
      stdout: string | Buffer;
      stderr: string | Buffer;
    };
    return {
      stdout: typeof res.stdout === 'string' ? res.stdout : res.stdout.toString('utf8'),
      stderr: typeof res.stderr === 'string' ? res.stderr : res.stderr.toString('utf8'),
    };
  },
};

/**
 * Video processing configuration defaults and safety limits
 */
export const VIDEO_PROCESSING_CONFIG = {
  maxSizeBytes: 500 * 1024 * 1024, // 500 MB
  maxDurationSeconds: 1800, // 30 minutes
  maxWidth: 3840, // 4K UHD ceiling
  maxHeight: 2160,
  maxFps: 120,
  posterTimestampSeconds: 1.0,
  playbackMaxWidth: 1920,
  playbackMaxHeight: 1080,
  workerConcurrency: 1, // Strictly isolated single-worker concurrency
  timeoutMs: 120_000, // 2 minutes execution timeout
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
};

export interface VideoProbeResult extends VideoProbeMetadata {
  formatName: string;
}

/**
 * Resolves configured or default binary paths for FFmpeg and FFprobe.
 */
function getBinaryPaths() {
  const config = getConfig();
  return {
    ffmpeg: config.video?.ffmpegPath || VIDEO_PROCESSING_CONFIG.ffmpegPath,
    ffprobe: config.video?.ffprobePath || VIDEO_PROCESSING_CONFIG.ffprobePath,
    timeoutMs: config.video?.timeoutMs || VIDEO_PROCESSING_CONFIG.timeoutMs,
  };
}

/**
 * Defensive FFprobe inspector: parses container, streams, duration, dimensions, and codecs.
 * Uses safe execFile with argument arrays to prevent shell injection.
 */
export async function probeVideo(
  filePath: string,
  overrides?: Partial<typeof VIDEO_PROCESSING_CONFIG>
): Promise<VideoProbeResult> {
  const { ffprobe, timeoutMs } = getBinaryPaths();
  const cfg = { ...VIDEO_PROCESSING_CONFIG, ...overrides };

  if (!fs.existsSync(filePath)) {
    throw new CorruptVideoError(`Video input file not found: ${filePath}`);
  }

  const args = [
    '-v',
    'error',
    '-show_entries',
    'stream=index,codec_type,codec_name,width,height,r_frame_rate,duration,bit_rate',
    '-show_entries',
    'format=duration,size,bit_rate,format_name',
    '-of',
    'json',
    filePath,
  ];

  let stdout = '';
  try {
    const res = await processExecutor.execFile(ffprobe, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CorruptVideoError(`Failed to probe video file with ffprobe: ${msg}`);
  }

  let probeData: any;
  try {
    probeData = JSON.parse(stdout);
  } catch (parseErr) {
    throw new CorruptVideoError('Failed to parse ffprobe JSON output');
  }

  const streams: any[] = Array.isArray(probeData.streams) ? probeData.streams : [];
  const format = probeData.format || {};

  // Locate video stream
  const videoStream = streams.find((s) => s.codec_type === 'video');
  if (!videoStream) {
    throw new CorruptVideoError('File contains no valid video stream');
  }

  const width = parseInt(videoStream.width, 10);
  const height = parseInt(videoStream.height, 10);
  if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
    throw new CorruptVideoError('Video stream contains invalid or non-positive dimensions');
  }

  if (width > cfg.maxWidth || height > cfg.maxHeight) {
    throw new VideoDimensionsExceededError(
      `Video dimensions (${width}x${height}) exceed maximum allowed dimensions (${cfg.maxWidth}x${cfg.maxHeight})`
    );
  }

  // Parse duration (stream duration takes precedence, fallback to format duration)
  let duration = parseFloat(videoStream.duration || format.duration || '0');
  if (isNaN(duration) || duration <= 0) {
    throw new CorruptVideoError('Could not determine positive video duration');
  }

  if (duration > cfg.maxDurationSeconds) {
    throw new VideoDurationExceededError(
      `Video duration (${duration.toFixed(1)}s) exceeds maximum allowed limit of ${cfg.maxDurationSeconds}s`
    );
  }

  // Locate audio stream (optional)
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  const audioCodec: string | null = audioStream?.codec_name || null;

  // Frame rate parsing
  let frameRate: number | null = null;
  if (videoStream.r_frame_rate) {
    const parts = String(videoStream.r_frame_rate).split('/');
    if (parts.length === 2) {
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      if (den > 0) {
        frameRate = Math.round((num / den) * 100) / 100;
      }
    } else {
      frameRate = parseFloat(videoStream.r_frame_rate) || null;
    }
  }

  const bitrate = videoStream.bit_rate
    ? parseInt(videoStream.bit_rate, 10)
    : format.bit_rate
      ? parseInt(format.bit_rate, 10)
      : null;

  return {
    duration: Math.round(duration * 100) / 100,
    width,
    height,
    videoCodec: String(videoStream.codec_name || 'unknown').toLowerCase(),
    audioCodec: audioCodec ? String(audioCodec).toLowerCase() : null,
    bitrate: bitrate && !isNaN(bitrate) ? bitrate : null,
    frameRate: frameRate && !isNaN(frameRate) ? frameRate : null,
    formatName: String(format.format_name || ''),
  };
}

/**
 * Extracts a high-quality poster frame from a video using safe FFmpeg execution.
 * Handles very short videos safely (e.g. videos under 1 second).
 */
export async function extractPosterFrame(
  inputPath: string,
  outputPath: string,
  duration: number,
  overrides?: Partial<typeof VIDEO_PROCESSING_CONFIG>
): Promise<{ posterBuffer: Buffer; width: number; height: number }> {
  const { ffmpeg, timeoutMs } = getBinaryPaths();
  const cfg = { ...VIDEO_PROCESSING_CONFIG, ...overrides };

  // Calculate safe seek timestamp: if video is very short, seek to midpoint
  const seekTime =
    duration <= 1.0
      ? Math.max(0.05, duration / 2)
      : Math.min(cfg.posterTimestampSeconds, duration / 2);

  // Attempt WebP extraction first (supported natively by ffmpeg 8.0.1)
  const isWebpOutput = outputPath.endsWith('.webp');
  const args = [
    '-y',
    '-ss',
    seekTime.toFixed(2),
    '-i',
    inputPath,
    '-vframes',
    '1',
    '-vf',
    `scale='min(${cfg.playbackMaxWidth},iw)':-2`,
  ];

  if (isWebpOutput) {
    args.push('-c:v', 'libwebp', '-quality', '80');
  } else {
    args.push('-c:v', 'mjpeg', '-q:v', '2');
  }

  args.push(outputPath);

  try {
    await processExecutor.execFile(ffmpeg, args, {
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (err: unknown) {
    // If libwebp encoder failed, retry with jpeg fallback
    if (isWebpOutput) {
      const fallbackPath = outputPath.replace(/\.webp$/, '.jpg');
      const fallbackArgs = [
        '-y',
        '-ss',
        seekTime.toFixed(2),
        '-i',
        inputPath,
        '-vframes',
        '1',
        '-vf',
        `scale='min(${cfg.playbackMaxWidth},iw)':-2`,
        '-c:v',
        'mjpeg',
        '-q:v',
        '2',
        fallbackPath,
      ];
      try {
        await processExecutor.execFile(ffmpeg, fallbackArgs, { timeout: timeoutMs });
        outputPath = fallbackPath;
      } catch (fallbackErr: unknown) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        throw new VideoProcessingError(`Failed to extract poster frame from video: ${msg}`);
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      throw new VideoProcessingError(`Failed to extract poster frame from video: ${msg}`);
    }
  }

  if (!fs.existsSync(outputPath)) {
    throw new VideoProcessingError('Poster frame generation did not produce an output file');
  }

  const posterBuffer = await fs.promises.readFile(outputPath);
  if (posterBuffer.length === 0) {
    throw new VideoProcessingError('Generated poster frame is empty (0 bytes)');
  }

  return {
    posterBuffer,
    width: Math.min(cfg.playbackMaxWidth, 1920),
    height: Math.min(cfg.playbackMaxHeight, 1080),
  };
}

/**
 * Transcodes or web-optimizes video into a web-compatible H.264 / AAC MP4 rendition.
 * Downscales to 1080p without upscaling, places moov atom at beginning via +faststart,
 * and handles silent videos (no audio track) safely.
 */
export async function generatePlaybackRendition(
  inputPath: string,
  outputPath: string,
  hasAudio: boolean,
  overrides?: Partial<typeof VIDEO_PROCESSING_CONFIG>
): Promise<{ sizeBytes: number }> {
  const { ffmpeg, timeoutMs } = getBinaryPaths();
  const cfg = { ...VIDEO_PROCESSING_CONFIG, ...overrides };

  const args = [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-level',
    '4.0',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '23',
    '-preset',
    'fast',
    '-maxrate',
    '4M',
    '-bufsize',
    '8M',
    '-vf',
    `scale='min(${cfg.playbackMaxWidth},iw)':-2`,
    '-movflags',
    '+faststart',
  ];

  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  } else {
    args.push('-an');
  }

  args.push(outputPath);

  try {
    await processExecutor.execFile(ffmpeg, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new VideoProcessingError(`Playback rendition transcoding failed: ${msg}`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new VideoProcessingError('Playback rendition did not produce an output file');
  }

  const stats = await fs.promises.stat(outputPath);
  if (stats.size === 0) {
    throw new VideoProcessingError('Playback rendition is empty (0 bytes)');
  }

  return { sizeBytes: stats.size };
}

export const videoPipeline = {
  probeVideo,
  extractPosterFrame,
  generatePlaybackRendition,
};

interface VideoMediaRow {
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
  video_duration: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  width: number | null;
  height: number | null;
  type: string;
  event_status?: string | null;
}

/**
 * Complete video processing pipeline:
 * 1. Checks eligibility and idempotency.
 * 2. Streams original from R2 into isolated temporary scratch directory.
 * 3. Probes media container, streams, codecs, and duration with FFprobe.
 * 4. Extracts WebP poster frame with FFmpeg and uploads to R2 thumbnails.
 * 5. Generates web-optimized H.264/AAC MP4 playback rendition and uploads to R2 previews.
 * 6. Updates PostgreSQL media row to status = 'ready' with complete metadata.
 * 7. Safely cleans up temporary scratch directory in finally block.
 * 8. Records normalized errors with status = 'failed' without touching the original.
 */
export async function processVideo(
  mediaId: string,
  eventIdHint?: string
): Promise<ProcessVideoResponseDTO> {
  const startTime = Date.now();

  // 1. Fetch media record joined with parent event status
  const mediaRes = await query<VideoMediaRow>(
    `SELECT m.id, m.event_id, m.storage_key_original, m.storage_key_thumbnail, m.storage_key_preview,
            m.status, m.file_size, m.mime_type, m.filename, m.thumbnail_size, m.preview_size,
            m.video_duration, m.video_codec, m.audio_codec, m.width, m.height, m.type,
            e.status as event_status
     FROM media m
     JOIN events e ON e.id = m.event_id
     WHERE m.id = $1`,
    [mediaId]
  );

  if (mediaRes.rows.length === 0) {
    throw new MediaNotFoundError(`Media item "${mediaId}" not found for video processing`);
  }

  const media = mediaRes.rows[0];
  const eventId = media.event_id;

  // Lifecycle check: skip if parent event is currently being deleted or deleted
  if (['deleting', 'deleted'].includes(media.event_status || '')) {
    logger.info('Skipping video processing: parent event is being deleted', {
      service: 'video-processor',
      mediaId,
      eventId,
      status: media.event_status,
    });
    return {
      mediaId: media.id,
      status: 'failed',
      posterKey: media.storage_key_thumbnail || '',
      playbackKey: media.storage_key_preview || '',
      posterSize: Number(media.thumbnail_size || 0),
      playbackSize: Number(media.preview_size || 0),
      duration: media.video_duration || 0,
      width: media.width || 0,
      height: media.height || 0,
      videoCodec: media.video_codec || '',
      audioCodec: media.audio_codec || '',
    };
  }

  // Idempotency: if already processed and ready, return existing metadata
  if (
    media.status === 'ready' &&
    media.storage_key_thumbnail &&
    media.storage_key_preview &&
    media.thumbnail_size &&
    media.preview_size
  ) {
    return {
      mediaId: media.id,
      status: 'ready',
      posterKey: media.storage_key_thumbnail,
      playbackKey: media.storage_key_preview,
      posterSize: Number(media.thumbnail_size),
      playbackSize: Number(media.preview_size),
      duration: media.video_duration,
      width: media.width,
      height: media.height,
      videoCodec: media.video_codec,
      audioCodec: media.audio_codec,
    };
  }

  // 2. Mark status as 'processing'
  await query(`UPDATE media SET status = 'processing', updated_at = NOW() WHERE id = $1`, [
    mediaId,
  ]);

  logger.info('Starting video processing workflow', {
    service: 'video-processor',
    mediaId,
    eventId,
    originalKey: media.storage_key_original,
  });

  // Prepare isolated temporary scratch directory
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `studio_lumina_vid_${mediaId}_`)
  );

  const posterKey = buildStorageKey(eventId, 'thumbnails', `${mediaId}.webp`);
  const playbackKey = buildStorageKey(eventId, 'previews', `${mediaId}.mp4`);

  try {
    // 3. Download original from R2 into temporary scratch file
    const originalBuffer = await storageAdapter.getObject(media.storage_key_original);
    const originalExt = path.extname(media.storage_key_original) || '.mp4';
    const inputPath = path.join(tempDir, `input${originalExt}`);
    await fs.promises.writeFile(inputPath, originalBuffer);

    // 4. Probe video container, streams, codecs, dimensions, and duration
    const probe = await videoPipeline.probeVideo(inputPath);

    // 5. Extract poster image frame
    const posterPath = path.join(tempDir, 'poster.webp');
    const posterResult = await videoPipeline.extractPosterFrame(
      inputPath,
      posterPath,
      probe.duration
    );

    // Upload poster derivative to R2
    await storageAdapter.putObject(posterKey, posterResult.posterBuffer, 'image/webp', {
      'parent-media-id': mediaId,
      'derivative-type': 'poster',
    });
    const posterSize = posterResult.posterBuffer.length;

    // 6. Generate web-optimized playback rendition
    const renditionPath = path.join(tempDir, 'rendition.mp4');
    const renditionResult = await videoPipeline.generatePlaybackRendition(
      inputPath,
      renditionPath,
      probe.audioCodec !== null
    );

    // Read rendition buffer and upload to R2
    const renditionBuffer = await fs.promises.readFile(renditionPath);
    await storageAdapter.putObject(playbackKey, renditionBuffer, 'video/mp4', {
      'parent-media-id': mediaId,
      'derivative-type': 'playback-rendition',
    });
    const playbackSize = renditionResult.sizeBytes;

    if (posterSize === 0 || playbackSize === 0) {
      throw new VideoProcessingError('Generated video derivatives have zero bytes');
    }

    const evCheck = await query<{ status: string }>(
      'SELECT status FROM events WHERE id = $1',
      [eventId]
    );
    if (evCheck.rows.length === 0 || ['deleting', 'trashed', 'deleted'].includes(evCheck.rows[0].status)) {
      logger.info('Aborting video processing commit: parent event was trashed or deleted', {
        service: 'video-processor',
        mediaId,
        eventId,
      });
      return {
        mediaId,
        status: 'failed',
        error: `Parent event is ${evCheck.rows[0]?.status || 'deleted'}`,
      };
    }

    // 7. Update PostgreSQL row with complete metadata and mark status = 'ready'
    await query(
      `UPDATE media
       SET status = 'ready',
           storage_key_thumbnail = $1,
           storage_key_preview = $2,
           thumbnail_size = $3,
           preview_size = $4,
           video_duration = $5,
           width = $6,
           height = $7,
           video_codec = $8,
           audio_codec = $9,
           processed_at = NOW(),
           processing_error = NULL,
           updated_at = NOW()
       WHERE id = $10`,
      [
        posterKey,
        playbackKey,
        posterSize,
        playbackSize,
        probe.duration,
        probe.width,
        probe.height,
        probe.videoCodec,
        probe.audioCodec,
        mediaId,
      ]
    );

    const durationMs = Date.now() - startTime;
    logger.info('Video processing completed successfully', {
      service: 'video-processor',
      mediaId,
      eventId,
      posterKey,
      posterSize,
      playbackKey,
      playbackSize,
      videoDuration: probe.duration,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      width: probe.width,
      height: probe.height,
      durationMs,
    });

    return {
      mediaId,
      status: 'ready',
      posterKey,
      playbackKey,
      posterSize,
      playbackSize,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
    };
  } catch (error: unknown) {
    if (error instanceof StorageConfigError) {
      // Storage unconfigured (local dev/test without credentials)
      await query(`UPDATE media SET status = 'uploaded', updated_at = NOW() WHERE id = $1`, [
        mediaId,
      ]);
      return {
        mediaId,
        status: 'uploaded',
        error: error.message,
      };
    }

    const safeError = error instanceof Error ? error.message : 'Unknown video processing error';

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
    logger.error('Video processing failed', {
      service: 'video-processor',
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
  } finally {
    // Guaranteed cleanup of temporary scratch directory
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Bounded Concurrency In-Process Video Processing Queue
 * Concurrency is strictly bounded (default: 1) to ensure resource-intensive
 * FFmpeg jobs never starve photo processing or future AI workloads.
 * Includes in-flight deduplication and graceful drain handling.
 */
export class AsyncVideoProcessingQueue {
  private queue: Array<{ mediaId: string; eventId: string }> = [];
  private queuedSet = new Set<string>();
  private activeCount = 0;
  private readonly concurrency: number;
  private drainResolvers: Array<() => void> = [];

  constructor(concurrency = VIDEO_PROCESSING_CONFIG.workerConcurrency) {
    this.concurrency = Math.max(1, concurrency);
  }

  /**
   * Non-blocking enqueue of a video for background processing.
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
   * Enqueues an entire batch of confirmed video items.
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
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      this.activeCount++;

      processVideo(task.mediaId, task.eventId)
        .catch((err) => {
          logger.error('Unhandled background video processing failure', {
            service: 'video-queue',
            mediaId: task.mediaId,
            eventId: task.eventId,
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          this.activeCount--;
          this.queuedSet.delete(task.mediaId);

          if (this.queue.length === 0 && this.activeCount === 0) {
            this.resolveDrain();
          } else {
            this.processNext();
          }
        });
    }
  }

  private resolveDrain(): void {
    const resolvers = [...this.drainResolvers];
    this.drainResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }

  /**
   * Waits for all currently queued and active video tasks to complete.
   * Used in tests and graceful shutdown.
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && this.activeCount === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  clear(): void {
    this.queue = [];
    this.queuedSet.clear();
  }
}

/**
 * Singleton background video processing queue with isolated concurrency = 1.
 */
export const videoProcessingQueue = new AsyncVideoProcessingQueue();
