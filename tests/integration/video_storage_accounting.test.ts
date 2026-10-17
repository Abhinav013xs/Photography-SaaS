import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IMemoryDb } from 'pg-mem';
import { getStorageUsageSummary } from '../../apps/api/src/services/storageService.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
} from '../helpers/db_test_helper.js';

describe('Phase 12: Video Storage Accounting Integration Tests', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = createTestDatabase();
    setDatabasePool({
      query: async (text: string, params?: any[]) => {
        let p = 1;
        let sql = text;
        if (params && params.length > 0) {
          for (const val of params) {
            let strVal = 'NULL';
            if (val !== null && val !== undefined) {
              if (typeof val === 'number') strVal = String(val);
              else if (typeof val === 'boolean') strVal = val ? 'TRUE' : 'FALSE';
              else strVal = `'${String(val).replace(/'/g, "''")}'`;
            }
            sql = sql.replace(new RegExp(`\\$${p}(?!\\d)`, 'g'), strVal);
            p++;
          }
        }
        const res = db.public.many(sql);
        return { rows: res, rowCount: res.length };
      },
      end: async () => {},
    } as any);

    insertTestPhotographer(db, { id: 1 });
  });

  afterEach(() => {
    setDatabasePool(null as any);
  });

  it('accurately distinguishes original video, playback rendition, and poster image storage', async () => {
    const eventId = 'e0000000-0000-0000-0000-000000000001';
    insertTestEvent(db, { id: eventId, owner_id: 1, name: 'Cinematic Wedding' });

    // 1. Photo with thumbnail and preview
    insertTestMedia(db, {
      id: '10000000-0000-0000-0000-000000000001',
      event_id: eventId,
      type: 'photo',
      file_size: 10_000_000, // 10 MB
      thumbnail_size: 200_000, // 200 KB
      preview_size: 1_800_000, // 1.8 MB
      status: 'ready',
    });

    // 2. Video with original, poster, and playback rendition
    insertTestMedia(db, {
      id: '10000000-0000-0000-0000-000000000002',
      event_id: eventId,
      type: 'video',
      file_size: 100_000_000, // 100 MB original video
      thumbnail_size: 400_000, // 400 KB poster image
      preview_size: 25_000_000, // 25 MB playback rendition
      video_duration: 65.5,
      video_codec: 'h264',
      audio_codec: 'aac',
      status: 'ready',
    });

    const summary = await getStorageUsageSummary(1);

    expect(summary.source).toBe('application_media_records');
    expect(summary.breakdown.originalPhotosBytes).toBe(10_000_000);
    expect(summary.breakdown.derivedImagesBytes).toBe(2_000_000); // 200 KB + 1.8 MB
    expect(summary.breakdown.originalVideosBytes).toBe(100_000_000);
    expect(summary.breakdown.playbackRenditionBytes).toBe(25_000_000);
    expect(summary.breakdown.posterImageBytes).toBe(400_000);

    // Total videos storage = 100M + 25M + 400K = 125,400,000 bytes
    expect(summary.breakdown.videosBytes).toBe(125_400_000);

    // Grand total = 10M (photo orig) + 2M (photo der) + 125.4M (video total) = 137,400,000 bytes
    expect(summary.totalBytes).toBe(137_400_000);

    expect(summary.mediaCounts.photos).toBe(1);
    expect(summary.mediaCounts.videos).toBe(1);
    expect(summary.mediaCounts.total).toBe(2);
  });

  it('excludes failed video files from completed storage totals', async () => {
    const eventId = 'e0000000-0000-0000-0000-000000000002';
    insertTestEvent(db, { id: eventId, owner_id: 1, name: 'Event with Failed Video' });

    // Completed video
    insertTestMedia(db, {
      id: '10000000-0000-0000-0000-000000000011',
      event_id: eventId,
      type: 'video',
      file_size: 50_000_000,
      thumbnail_size: 300_000,
      preview_size: 10_000_000,
      status: 'ready',
    });

    // Failed video
    insertTestMedia(db, {
      id: '10000000-0000-0000-0000-000000000012',
      event_id: eventId,
      type: 'video',
      file_size: 80_000_000,
      thumbnail_size: null,
      preview_size: null,
      status: 'failed',
    });

    const summary = await getStorageUsageSummary(1);

    // Only completed video (50M + 10M + 300K = 60,300,000) should be included
    expect(summary.breakdown.originalVideosBytes).toBe(50_000_000);
    expect(summary.breakdown.playbackRenditionBytes).toBe(10_000_000);
    expect(summary.breakdown.posterImageBytes).toBe(300_000);
    expect(summary.breakdown.videosBytes).toBe(60_300_000);
    expect(summary.mediaCounts.videos).toBe(1);
  });
});
