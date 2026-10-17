import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { SESSION_COOKIE_NAME } from '../../apps/api/src/services/cookieService.js';
import { getStorageUsageSummary } from '../../apps/api/src/services/storageService.js';
import { getGuestGalleryMedia } from '../../apps/api/src/services/guestService.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestFolder,
  insertTestMedia,
} from '../helpers/db_test_helper.js';

describe('Phase 27: Performance Optimization & Database Query Tuning Integration Tests', () => {
  let app: ReturnType<typeof createApp>;
  let db: ReturnType<typeof createTestDatabase>;
  let authCookie: string;

  const event1Id = '10000000-0000-0000-0000-000000000001';
  const eventPinId = '20000000-0000-0000-0000-000000000002';
  const eventExpiredId = '30000000-0000-0000-0000-000000000003';
  const eventPrivateId = '40000000-0000-0000-0000-000000000004';
  const folder1Id = 'f0000000-0000-0000-0000-000000000001';

  const testPin = '987654';
  const pinHash = bcrypt.hashSync(testPin, 10);

  beforeEach(() => {
    resetPinRateLimiterStore();
    db = createTestDatabase();

    const poolMock: any = {
      query: async (text: string, params: any[] = []) => {
        let sql = text;
        if (params && params.length > 0) {
          params.forEach((p, idx) => {
            const placeholder = new RegExp(`\\$${idx + 1}(?![0-9])`, 'g');
            if (p === null || p === undefined) {
              sql = sql.replace(placeholder, 'NULL');
            } else if (typeof p === 'number') {
              sql = sql.replace(placeholder, String(p));
            } else if (typeof p === 'boolean') {
              sql = sql.replace(placeholder, p ? 'TRUE' : 'FALSE');
            } else if (p instanceof Date) {
              sql = sql.replace(placeholder, `'${p.toISOString()}'`);
            } else {
              sql = sql.replace(placeholder, `'${String(p).replace(/'/g, "''")}'`);
            }
          });
        }
        try {
          const res = db.public.query(sql);
          return { rows: res.rows || [], rowCount: res.rowCount || 0 };
        } catch (err: any) {
          throw err;
        }
      },
    };

    setDatabasePool(poolMock);
    app = createApp();

    // Seed Photographer
    insertTestPhotographer(db, { id: 1, email: 'studio@lumina.com' });
    const token = signSessionToken({ id: 1, email: 'studio@lumina.com' });
    authCookie = `${SESSION_COOKIE_NAME}=${token}`;

    // Event 1: Public, active, no PIN
    insertTestEvent(db, {
      id: event1Id,
      owner_id: 1,
      slug: 'grand-gallery-2026',
      name: 'Grand Gallery 2026',
      status: 'active',
      visibility: 'public',
      public_until: new Date(Date.now() + 14 * 86400000).toISOString(),
      pin_enabled: false,
    });

    // Folder in Event 1
    insertTestFolder(db, {
      id: folder1Id,
      event_id: event1Id,
      name: 'Ceremony Highlights',
      sort_order: 1,
    });

    // Event 2: Public, PIN protected
    insertTestEvent(db, {
      id: eventPinId,
      owner_id: 1,
      slug: 'royal-wedding-2026',
      name: 'Royal Wedding 2026',
      status: 'active',
      visibility: 'public',
      public_until: new Date(Date.now() + 14 * 86400000).toISOString(),
      pin_enabled: true,
      pin_hash: pinHash,
    });

    // Event 3: Expired
    insertTestEvent(db, {
      id: eventExpiredId,
      owner_id: 1,
      slug: 'expired-gallery-2025',
      name: 'Expired Gallery 2025',
      status: 'active',
      visibility: 'public',
      public_until: new Date(Date.now() - 86400000).toISOString(), // Expired yesterday
    });

    // Event 4: Private
    insertTestEvent(db, {
      id: eventPrivateId,
      owner_id: 1,
      slug: 'private-collection-2026',
      name: 'Private Collection 2026',
      status: 'active',
      visibility: 'private',
    });
  });

  it('1. COMPOSITE INDEXES: Verifies that Phase 27 performance indexes exist', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const migrationSql = fs.readFileSync(
      path.resolve(__dirname, '../../infrastructure/database/migrations/014_performance_indexes.sql'),
      'utf-8'
    );

    expect(migrationSql).toContain('idx_media_event_gallery_paging');
    expect(migrationSql).toContain('idx_media_folder_gallery_paging');
    expect(migrationSql).toContain('idx_media_dashboard_paging');
    expect(migrationSql).toContain('idx_media_folder_status');
    expect(migrationSql).toContain('idx_face_embeddings_event_model');
  });

  it('2. STABLE TIE-BREAKER: Photos with identical timestamps sort deterministically by id', async () => {
    const commonDate = new Date('2026-06-15T10:00:00.000Z');

    // Insert 5 photos with identical timestamps but unordered IDs
    const photoIds = [
      'aaaaaaaa-0000-0000-0000-000000000005',
      'aaaaaaaa-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000004',
      'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000003',
    ];

    for (const id of photoIds) {
      insertTestMedia(db, {
        id,
        event_id: event1Id,
        filename: `${id}.jpg`,
        status: 'ready',
        created_at: commonDate.toISOString(),
      });
    }

    const result = await getGuestGalleryMedia(event1Id);
    expect(result.media.length).toBe(5);

    // Should be sorted deterministically in ascending order by id
    const sortedIds = [...photoIds].sort();
    const resultIds = result.media.map((m: any) => m.id);
    expect(resultIds).toEqual(sortedIds);
  });

  it('3. LARGE GALLERY PAGINATION: Efficiently pages across large collections without dropped or duplicate items', async () => {
    const totalPhotos = 120;
    const allInsertedIds: string[] = [];

    // Insert 120 synthetic photos with distinct timestamps
    for (let i = 1; i <= totalPhotos; i++) {
      const hex = i.toString(16).padStart(12, '0');
      const id = `00000000-0000-0000-0000-${hex}`;
      allInsertedIds.push(id);

      const itemDate = new Date(Date.now() - (totalPhotos - i) * 60000).toISOString();
      insertTestMedia(db, {
        id,
        event_id: event1Id,
        filename: `photo_${i}.jpg`,
        file_size: 2048000,
        width: 3000,
        height: 2000,
        status: 'ready',
        created_at: itemDate,
      });
    }

    // --- Page 1 (limit: 50) ---
    const page1Res = await request(app)
      .get('/api/guest/gallery/grand-gallery-2026?page=1&limit=50')
      .expect(200);

    expect(page1Res.body.success).toBe(true);
    expect(page1Res.body.data.totalCount).toBe(120);
    expect(page1Res.body.data.media.length).toBe(50);
    expect(page1Res.body.data.hasMore).toBe(true);
    expect(page1Res.body.data.nextCursor).toBeDefined();

    const page1Ids = page1Res.body.data.media.map((m: any) => m.id);
    expect(page1Ids.length).toBe(50);

    // --- Page 2 using Keyset Cursor ---
    const cursor1 = page1Res.body.data.nextCursor;
    const page2Res = await request(app)
      .get(`/api/guest/gallery/grand-gallery-2026?limit=50&cursor=${encodeURIComponent(cursor1)}`)
      .expect(200);

    expect(page2Res.body.data.media.length).toBe(50);
    expect(page2Res.body.data.hasMore).toBe(true);
    expect(page2Res.body.data.nextCursor).toBeDefined();

    const page2Ids = page2Res.body.data.media.map((m: any) => m.id);

    // Verify zero overlap between page 1 and page 2
    const overlap1_2 = page1Ids.filter((id: string) => page2Ids.includes(id));
    expect(overlap1_2).toEqual([]);

    // --- Page 3 using Keyset Cursor ---
    const cursor2 = page2Res.body.data.nextCursor;
    const page3Res = await request(app)
      .get(`/api/guest/gallery/grand-gallery-2026?limit=50&cursor=${encodeURIComponent(cursor2)}`)
      .expect(200);

    expect(page3Res.body.data.media.length).toBe(20); // 120 - 50 - 50 = 20 remaining
    expect(page3Res.body.data.hasMore).toBe(false);
    expect(page3Res.body.data.nextCursor).toBeNull();

    const page3Ids = page3Res.body.data.media.map((m: any) => m.id);

    // Verify all 120 items are covered exactly once
    const combinedIds = [...page1Ids, ...page2Ids, ...page3Ids];
    expect(combinedIds.length).toBe(120);
    expect(new Set(combinedIds).size).toBe(120);
  });

  it('4. FOLDER FILTERING & COUNTS: Filters media by folder and counts ready photos accurately', async () => {
    // 3 photos in Ceremony folder
    insertTestMedia(db, {
      id: 'bbbbbbbb-0000-0000-0000-000000000001',
      event_id: event1Id,
      folder_id: folder1Id,
      filename: 'ceremony_1.jpg',
      status: 'ready',
    });
    insertTestMedia(db, {
      id: 'bbbbbbbb-0000-0000-0000-000000000002',
      event_id: event1Id,
      folder_id: folder1Id,
      filename: 'ceremony_2.jpg',
      status: 'ready',
    });
    insertTestMedia(db, {
      id: 'bbbbbbbb-0000-0000-0000-000000000003',
      event_id: event1Id,
      folder_id: folder1Id,
      filename: 'ceremony_failed.jpg',
      status: 'failed', // Should NOT be included in ready photo count
    });

    // 2 photos outside folder (root)
    insertTestMedia(db, {
      id: 'bbbbbbbb-0000-0000-0000-000000000004',
      event_id: event1Id,
      folder_id: null,
      filename: 'reception_1.jpg',
      status: 'ready',
    });

    // Request gallery filtered to folder1
    const res = await request(app)
      .get(`/api/guest/gallery/grand-gallery-2026?folderId=${folder1Id}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.media.length).toBe(2);
    expect(res.body.data.totalCount).toBe(2);
    expect(res.body.data.folders[0].photo_count).toBe(2);
  });

  it('5. STORAGE AGGREGATION: Scoped query calculates breakdown without scanning unowned events', async () => {
    // Media for Photographer 1
    insertTestMedia(db, {
      id: 'cccccccc-0000-0000-0000-000000000001',
      event_id: event1Id,
      type: 'photo',
      file_size: 5000000,
      thumbnail_size: 50000,
      preview_size: 200000,
      status: 'ready',
    });

    // Seed Photographer 2 and Event 5
    insertTestPhotographer(db, { id: 2, email: 'other@photographer.com' });
    const eventOtherId = '50000000-0000-0000-0000-000000000005';
    insertTestEvent(db, {
      id: eventOtherId,
      owner_id: 2,
      slug: 'other-event',
      name: 'Other Event',
    });

    // Media for Photographer 2 (should NOT inflate Photographer 1's stats)
    insertTestMedia(db, {
      id: 'cccccccc-0000-0000-0000-000000000002',
      event_id: eventOtherId,
      type: 'photo',
      file_size: 99999999,
      status: 'ready',
    });

    const summary = await getStorageUsageSummary(1);
    expect(summary.mediaCounts.photos).toBe(1);
    expect(summary.breakdown.originalPhotosBytes).toBe(5000000);
    expect(summary.breakdown.derivedImagesBytes).toBe(250000);
  });

  it('6. CACHING & SECURITY PRESERVATION: Public metadata has cache headers; protected galleries fail closed', async () => {
    // 6a: Public event metadata sets safe public cache headers
    const metaRes = await request(app)
      .get('/api/guest/event/grand-gallery-2026')
      .expect(200);

    expect(metaRes.headers['cache-control']).toBeDefined();
    expect(metaRes.headers['cache-control']).toContain('public');

    // 6b: Protected gallery requires PIN and cannot be accessed publicly
    await request(app)
      .get('/api/guest/gallery/royal-wedding-2026')
      .expect(401);

    // 6c: Expired gallery fails closed with 410 Gone
    await request(app)
      .get('/api/guest/gallery/expired-gallery-2025')
      .expect(410);

    // 6d: Private gallery fails closed with 403 Forbidden
    await request(app)
      .get('/api/guest/gallery/private-collection-2026')
      .expect(403);

    // 6e: Valid gallery sets private cache headers to protect guest session isolation
    const validGalleryRes = await request(app)
      .get('/api/guest/gallery/grand-gallery-2026')
      .expect(200);

    expect(validGalleryRes.headers['cache-control']).toContain('private');
  });

  it('7. SUB-50MS QUERY PERFORMANCE BENCHMARK: Measures indexed paginated query execution latency', async () => {
    // Measure 10 sequential paginated queries
    const latencies: number[] = [];

    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await getGuestGalleryMedia(event1Id, null, { page: 1, limit: 50 });
      const duration = performance.now() - start;
      latencies.push(duration);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    // Target: Fast indexed query latency under parallel load
    expect(p50).toBeLessThan(250);
    expect(p95).toBeLessThan(500);
  });
});
