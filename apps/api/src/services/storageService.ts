import { query } from '../infrastructure/database.js';
import { getConfig } from '@photography-saas/config';
import {
  getR2BucketName,
  isR2StorageConfigured,
} from '../infrastructure/r2Client.js';
import { checkStorageHealth } from '../infrastructure/storageAdapter.js';
import type {
  StorageUsageSummary,
  StorageEventSummary,
  StorageBreakdown,
  StorageMediaCounts,
  StorageR2Info,
} from '@photography-saas/types';
import { log } from '../middleware/logger.js';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface EventStorageRow {
  event_id: string;
  event_name: string;
  event_slug: string;
  event_status: string;
  su_original_bytes: string | null;
  su_preview_bytes: string | null;
  su_thumbnail_bytes: string | null;
  su_video_bytes: string | null;
  su_total_bytes: string | null;
  su_last_calculated_at: Date | null;
  photo_count: number | null;
  video_count: number | null;
  media_photo_bytes: string | null;
  media_video_bytes: string | null;
  media_derived_bytes: string | null;
  media_video_rendition_bytes: string | null;
  media_video_poster_bytes: string | null;
  media_total_bytes: string | null;
  media_latest_created_at: Date | null;
}

/**
 * Builds safe Cloudflare navigation URLs based on configured Account ID and Bucket Name.
 * Never leaks access keys, secret keys, or private tokens.
 */
export function buildCloudflareUrls(
  accountId?: string | null,
  bucketName?: string | null
): { managementUrl: string; billingUrl: string } {
  const safeAccountId = accountId?.trim();
  const isHexAccountId = safeAccountId && /^[0-9a-fA-F]{32}$/.test(safeAccountId);

  if (isHexAccountId) {
    const managementUrl = bucketName
      ? `https://dash.cloudflare.com/${safeAccountId}/r2/default/buckets/${encodeURIComponent(bucketName)}`
      : `https://dash.cloudflare.com/${safeAccountId}/r2/overview`;
    const billingUrl = `https://dash.cloudflare.com/${safeAccountId}/billing`;

    return { managementUrl, billingUrl };
  }

  // Safe fallback if Account ID is not configured or non-standard format
  return {
    managementUrl: 'https://dash.cloudflare.com',
    billingUrl: 'https://dash.cloudflare.com',
  };
}

/**
 * Calculates application-tracked storage usage and Cloudflare management status
 * for the authenticated photographer.
 */
export async function getStorageUsageSummary(
  ownerId: number
): Promise<StorageUsageSummary> {
  const config = getConfig();

  // Query events, storage_usage, and aggregated media records
  const sql = `
    SELECT 
      e.id AS event_id,
      e.name AS event_name,
      e.slug AS event_slug,
      e.status AS event_status,
      su.original_bytes AS su_original_bytes,
      su.preview_bytes AS su_preview_bytes,
      su.thumbnail_bytes AS su_thumbnail_bytes,
      su.video_bytes AS su_video_bytes,
      su.total_bytes AS su_total_bytes,
      su.last_calculated_at AS su_last_calculated_at,
      COALESCE(m_agg.photo_count, 0)::INT AS photo_count,
      COALESCE(m_agg.video_count, 0)::INT AS video_count,
      COALESCE(m_agg.photo_bytes, 0)::BIGINT AS media_photo_bytes,
      COALESCE(m_agg.video_bytes, 0)::BIGINT AS media_video_bytes,
      COALESCE(m_agg.derived_bytes, 0)::BIGINT AS media_derived_bytes,
      COALESCE(m_agg.video_rendition_bytes, 0)::BIGINT AS media_video_rendition_bytes,
      COALESCE(m_agg.video_poster_bytes, 0)::BIGINT AS media_video_poster_bytes,
      COALESCE(m_agg.total_bytes, 0)::BIGINT AS media_total_bytes,
      m_agg.max_created_at AS media_latest_created_at
    FROM events e
    LEFT JOIN storage_usage su ON su.event_id = e.id
    LEFT JOIN (
      SELECT 
        m.event_id,
        COUNT(CASE WHEN m.type = 'photo' AND m.status != 'failed' THEN 1 END) AS photo_count,
        COUNT(CASE WHEN m.type = 'video' AND m.status != 'failed' THEN 1 END) AS video_count,
        SUM(CASE WHEN m.type = 'photo' AND m.status != 'failed' THEN m.file_size ELSE 0 END) AS photo_bytes,
        SUM(CASE WHEN m.type = 'video' AND m.status != 'failed' THEN m.file_size ELSE 0 END) AS video_bytes,
        SUM(CASE WHEN m.type = 'photo' AND m.status != 'failed' THEN COALESCE(m.thumbnail_size, 0) + COALESCE(m.preview_size, 0) ELSE 0 END) AS derived_bytes,
        SUM(CASE WHEN m.type = 'video' AND m.status != 'failed' THEN COALESCE(m.preview_size, 0) ELSE 0 END) AS video_rendition_bytes,
        SUM(CASE WHEN m.type = 'video' AND m.status != 'failed' THEN COALESCE(m.thumbnail_size, 0) ELSE 0 END) AS video_poster_bytes,
        SUM(CASE WHEN m.status != 'failed' THEN m.file_size + COALESCE(m.thumbnail_size, 0) + COALESCE(m.preview_size, 0) ELSE 0 END) AS total_bytes,
        MAX(m.created_at) AS max_created_at
      FROM media m
      WHERE m.event_id IN (SELECT id FROM events WHERE owner_id = $1)
      GROUP BY m.event_id
    ) m_agg ON m_agg.event_id = e.id
    WHERE e.owner_id = $1
    ORDER BY e.created_at DESC;
  `;

  const result = await query<EventStorageRow>(sql, [ownerId]);
  const rows = result.rows;

  let totalOriginalPhotos = 0;
  let totalDerivedImages = 0;
  let totalOriginalVideos = 0;
  let totalPlaybackRenditions = 0;
  let totalPosterImages = 0;
  let totalVideos = 0;
  let totalPhotosCount = 0;
  let totalVideosCount = 0;

  let usedStorageTable = false;
  let isStale = false;
  let latestTimestamp: Date | null = null;
  const now = new Date();

  const events: StorageEventSummary[] = [];

  for (const row of rows) {
    const suTotal = row.su_total_bytes ? Number(row.su_total_bytes) : 0;
    const mediaTotal = row.media_total_bytes ? Number(row.media_total_bytes) : 0;
    const photoCount = row.photo_count ?? 0;
    const videoCount = row.video_count ?? 0;

    totalPhotosCount += photoCount;
    totalVideosCount += videoCount;

    let eventOriginalBytes = 0;
    let eventDerivedBytes = 0;
    let eventVideoBytes = 0;
    let eventTotalBytes = 0;
    let eventCalculatedAt: string | null = null;

    if (row.su_last_calculated_at) {
      usedStorageTable = true;
      const suOriginal = Number(row.su_original_bytes ?? 0);
      const suPreview = Number(row.su_preview_bytes ?? 0);
      const suThumb = Number(row.su_thumbnail_bytes ?? 0);
      const suVideo = Number(row.su_video_bytes ?? 0);

      eventOriginalBytes = suOriginal;
      eventDerivedBytes = suPreview + suThumb;
      eventVideoBytes = suVideo;
      eventTotalBytes = suTotal;
      eventCalculatedAt = row.su_last_calculated_at.toISOString();

      if (!latestTimestamp || row.su_last_calculated_at > latestTimestamp) {
        latestTimestamp = row.su_last_calculated_at;
      }

      // Check for staleness: older than 24 hours
      if (now.getTime() - row.su_last_calculated_at.getTime() > STALE_THRESHOLD_MS) {
        isStale = true;
      }

      // Check if media was added after last calculation
      if (
        row.media_latest_created_at &&
        row.media_latest_created_at > row.su_last_calculated_at
      ) {
        isStale = true;
      }
    } else {
      // Direct media calculation fallback
      const photoBytes = Number(row.media_photo_bytes ?? 0);
      const videoBytes = Number(row.media_video_bytes ?? 0);
      const derivedBytes = Number(row.media_derived_bytes ?? 0);
      const videoRenditionBytes = Number(row.media_video_rendition_bytes ?? 0);
      const videoPosterBytes = Number(row.media_video_poster_bytes ?? 0);

      const totalEventVideoBytes = videoBytes + videoRenditionBytes + videoPosterBytes;

      eventOriginalBytes = photoBytes;
      eventDerivedBytes = derivedBytes;
      eventVideoBytes = totalEventVideoBytes;
      eventTotalBytes = photoBytes + derivedBytes + totalEventVideoBytes;

      totalOriginalVideos += videoBytes;
      totalPlaybackRenditions += videoRenditionBytes;
      totalPosterImages += videoPosterBytes;

      if (row.media_latest_created_at) {
        eventCalculatedAt = row.media_latest_created_at.toISOString();
        if (!latestTimestamp || row.media_latest_created_at > latestTimestamp) {
          latestTimestamp = row.media_latest_created_at;
        }
      }
    }

    totalOriginalPhotos += eventOriginalBytes;
    totalDerivedImages += eventDerivedBytes;
    totalVideos += eventVideoBytes;

    events.push({
      eventId: row.event_id,
      eventName: row.event_name,
      slug: row.event_slug,
      status: row.event_status,
      totalBytes: eventTotalBytes,
      originalBytes: eventOriginalBytes,
      derivedBytes: eventDerivedBytes,
      videoBytes: eventVideoBytes,
      photoCount,
      videoCount,
      lastCalculatedAt: eventCalculatedAt,
    });
  }

  const grandTotalBytes = totalOriginalPhotos + totalDerivedImages + totalVideos;

  const breakdown: StorageBreakdown = {
    originalPhotosBytes: totalOriginalPhotos,
    derivedImagesBytes: totalDerivedImages,
    videosBytes: totalVideos,
    otherBytes: 0,
    originalVideosBytes: totalOriginalVideos,
    playbackRenditionBytes: totalPlaybackRenditions,
    posterImageBytes: totalPosterImages,
  };

  const mediaCounts: StorageMediaCounts = {
    photos: totalPhotosCount,
    videos: totalVideosCount,
    total: totalPhotosCount + totalVideosCount,
  };

  // Cloudflare R2 Connectivity & URLs
  const r2Configured = isR2StorageConfigured();
  let bucketName: string | null = null;
  let r2Status: StorageR2Info['status'] = 'unconfigured';

  if (r2Configured) {
    try {
      bucketName = getR2BucketName();
      const health = await checkStorageHealth();
      r2Status = health.status === 'healthy' ? 'healthy' : 'error';
    } catch {
      r2Status = 'error';
    }
  } else {
    bucketName = config.r2.bucketName ?? null;
  }

  const { managementUrl, billingUrl } = buildCloudflareUrls(
    config.r2.accountId,
    bucketName
  );

  const r2Info: StorageR2Info = {
    configured: r2Configured,
    bucketName,
    status: r2Status,
    managementUrl,
    billingUrl,
  };

  const calculatedAtStr = latestTimestamp ? latestTimestamp.toISOString() : now.toISOString();

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Storage usage calculated for photographer ${ownerId}: ${grandTotalBytes} bytes across ${events.length} events`,
    details: {
      ownerId,
      totalBytes: grandTotalBytes,
      source: usedStorageTable ? 'application_metadata' : 'application_media_records',
      isStale,
      r2Configured,
    },
  });

  return {
    source: usedStorageTable ? 'application_metadata' : 'application_media_records',
    totalBytes: grandTotalBytes,
    breakdown,
    mediaCounts,
    calculatedAt: calculatedAtStr,
    isStale,
    r2: r2Info,
    events,
  };
}
