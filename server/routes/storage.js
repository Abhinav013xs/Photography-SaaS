import express from 'express';
import db from '../db.js';
import storage from '../storage/r2.js';
import { authenticatePhotographer } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/storage/overview
 * Real storage metrics, breakdown by photos, videos, derivatives, and per-event
 */
router.get('/overview', authenticatePhotographer, (req, res) => {
  // Aggregate media sizes
  const mediaStats = db.prepare(`
    SELECT
      COUNT(id) as total_media,
      COALESCE(SUM(CASE WHEN type = 'photo' THEN file_size ELSE 0 END), 0) as photo_bytes,
      COALESCE(COUNT(CASE WHEN type = 'photo' THEN 1 END), 0) as photo_count,
      COALESCE(SUM(CASE WHEN type = 'video' THEN file_size ELSE 0 END), 0) as video_bytes,
      COALESCE(COUNT(CASE WHEN type = 'video' THEN 1 END), 0) as video_count
    FROM media
  `).get();

  // Estimate derivative sizes (thumbnails ~ 35KB, previews ~ 180KB per ready photo)
  const readyPhotos = db.prepare(`SELECT COUNT(id) as c FROM media WHERE type = 'photo' AND status = 'ready'`).get();
  const estimatedDerivativesBytes = (readyPhotos.c || 0) * (35 * 1024 + 180 * 1024);

  const totalBytes = (mediaStats.photo_bytes || 0) + (mediaStats.video_bytes || 0) + estimatedDerivativesBytes;

  // Event-level breakdown
  const eventBreakdown = db.prepare(`
    SELECT
      e.id,
      e.name,
      e.client_name,
      e.status,
      COUNT(m.id) as media_count,
      COALESCE(SUM(m.file_size), 0) as original_bytes
    FROM events e
    LEFT JOIN media m ON m.event_id = e.id
    GROUP BY e.id
    ORDER BY original_bytes DESC
  `).all();

  const cloudflareConfig = {
    isConfigured: storage.isR2,
    bucketName: storage.bucketName,
    accountId: storage.accountId ? `${storage.accountId.slice(0, 6)}...` : 'Not Set',
    dashboardUrl: storage.accountId 
      ? `https://dash.cloudflare.com/${storage.accountId}/r2/default/buckets/${storage.bucketName}`
      : 'https://dash.cloudflare.com/?to=/:account/r2',
    billingUrl: 'https://dash.cloudflare.com/?to=/:account/billing',
  };

  return res.json({
    metrics: {
      totalBytes,
      photoBytes: mediaStats.photo_bytes || 0,
      photoCount: mediaStats.photo_count || 0,
      videoBytes: mediaStats.video_bytes || 0,
      videoCount: mediaStats.video_count || 0,
      derivativesBytes: estimatedDerivativesBytes,
      totalEvents: eventBreakdown.length,
    },
    eventBreakdown,
    cloudflare: cloudflareConfig,
  });
});

export default router;
