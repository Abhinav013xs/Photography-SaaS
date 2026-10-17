import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IMemoryDb } from 'pg-mem';
import {
  buildCloudflareUrls,
  getStorageUsageSummary,
} from '../../apps/api/src/services/storageService.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
  insertTestStorageUsage,
} from '../helpers/db_test_helper.js';

describe('Storage Usage & Cloudflare Management Unit Tests (Phase 9)', () => {
  describe('buildCloudflareUrls', () => {
    it('should generate bucket-specific management URL and billing URL for valid 32-character hex account ID', () => {
      const accountId = '0123456789abcdef0123456789abcdef';
      const bucketName = 'studio-lumina-media';

      const urls = buildCloudflareUrls(accountId, bucketName);

      expect(urls.managementUrl).toBe(
        'https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/r2/default/buckets/studio-lumina-media'
      );
      expect(urls.billingUrl).toBe(
        'https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/billing'
      );
    });

    it('should encode special characters in bucket name safely', () => {
      const accountId = '0123456789abcdef0123456789abcdef';
      const bucketName = 'my gallery bucket';

      const urls = buildCloudflareUrls(accountId, bucketName);

      expect(urls.managementUrl).toBe(
        'https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/r2/default/buckets/my%20gallery%20bucket'
      );
    });

    it('should fall back to R2 overview URL when bucket name is omitted', () => {
      const accountId = '0123456789ABCDEF0123456789ABCDEF';

      const urls = buildCloudflareUrls(accountId, null);

      expect(urls.managementUrl).toBe(
        'https://dash.cloudflare.com/0123456789ABCDEF0123456789ABCDEF/r2/overview'
      );
      expect(urls.billingUrl).toBe(
        'https://dash.cloudflare.com/0123456789ABCDEF0123456789ABCDEF/billing'
      );
    });

    it('should fall back safely to base dashboard URL if account ID is missing or invalid', () => {
      const invalidAccountIds = [
        null,
        undefined,
        '',
        'short-id',
        'not-hex-characters-here-0123456789',
        'https://evil.com/phish',
        '../traversal',
      ];

      for (const id of invalidAccountIds) {
        const urls = buildCloudflareUrls(id, 'some-bucket');
        expect(urls.managementUrl).toBe('https://dash.cloudflare.com');
        expect(urls.billingUrl).toBe('https://dash.cloudflare.com');
      }
    });
  });

  describe('getStorageUsageSummary Calculation', () => {
    let db: IMemoryDb;
    let pool: any;

    beforeEach(() => {
      db = createTestDatabase();
      pool = db.adapters.createPg().Pool;
      setDatabasePool(new pool());

      insertTestPhotographer(db, { id: 1 });
      insertTestPhotographer(db, { id: 2, email: 'other@studio.photo' });
    });

    afterEach(() => {
      setDatabasePool(null);
    });

    it('should return zero usage when photographer has no events', async () => {
      const summary = await getStorageUsageSummary(1);

      expect(summary.totalBytes).toBe(0);
      expect(summary.breakdown.originalPhotosBytes).toBe(0);
      expect(summary.breakdown.derivedImagesBytes).toBe(0);
      expect(summary.breakdown.videosBytes).toBe(0);
      expect(summary.mediaCounts.photos).toBe(0);
      expect(summary.mediaCounts.videos).toBe(0);
      expect(summary.mediaCounts.total).toBe(0);
      expect(summary.events).toHaveLength(0);
      expect(summary.isStale).toBe(false);
    });

    it('should calculate usage from storage_usage table when populated', async () => {
      const eventAId = 'e0000000-0000-0000-0000-000000000001';
      insertTestEvent(db, { id: eventAId, owner_id: 1, name: 'Wedding A' });

      insertTestStorageUsage(db, {
        event_id: eventAId,
        original_bytes: 10000000,
        preview_bytes: 800000,
        thumbnail_bytes: 200000,
        video_bytes: 5000000,
        total_bytes: 16000000,
        last_calculated_at: new Date(),
      });

      const summary = await getStorageUsageSummary(1);

      expect(summary.source).toBe('application_metadata');
      expect(summary.totalBytes).toBe(16000000);
      expect(summary.breakdown.originalPhotosBytes).toBe(10000000);
      expect(summary.breakdown.derivedImagesBytes).toBe(1000000); // 800,000 + 200,000
      expect(summary.breakdown.videosBytes).toBe(5000000);
      expect(summary.events).toHaveLength(1);
      expect(summary.events[0].eventName).toBe('Wedding A');
      expect(summary.events[0].totalBytes).toBe(16000000);
      expect(summary.isStale).toBe(false);
    });

    it('should calculate usage directly from media records when storage_usage row is missing', async () => {
      const eventBId = 'e0000000-0000-0000-0000-000000000002';
      insertTestEvent(db, { id: eventBId, owner_id: 1, name: 'Reception B' });

      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000001',
        event_id: eventBId,
        type: 'photo',
        file_size: 4000000,
      });

      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000002',
        event_id: eventBId,
        type: 'photo',
        file_size: 6000000,
      });

      insertTestMedia(db, {
        id: '10000000-0000-0000-0000-000000000003',
        event_id: eventBId,
        type: 'video',
        file_size: 25000000,
      });

      const summary = await getStorageUsageSummary(1);

      expect(summary.source).toBe('application_media_records');
      expect(summary.totalBytes).toBe(35000000); // 4M + 6M + 25M
      expect(summary.breakdown.originalPhotosBytes).toBe(10000000);
      expect(summary.breakdown.derivedImagesBytes).toBe(0);
      expect(summary.breakdown.videosBytes).toBe(25000000);
      expect(summary.mediaCounts.photos).toBe(2);
      expect(summary.mediaCounts.videos).toBe(1);
      expect(summary.mediaCounts.total).toBe(3);
      expect(summary.events[0].photoCount).toBe(2);
      expect(summary.events[0].videoCount).toBe(1);
    });

    it('should flag isStale = true when last calculation is older than 24 hours', async () => {
      const eventId = 'e0000000-0000-0000-0000-000000000001';
      insertTestEvent(db, { id: eventId, owner_id: 1 });

      const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
      insertTestStorageUsage(db, {
        event_id: eventId,
        original_bytes: 5000000,
        total_bytes: 5000000,
        last_calculated_at: staleDate,
      });

      const summary = await getStorageUsageSummary(1);

      expect(summary.isStale).toBe(true);
    });

    it('should enforce strict photographer isolation and exclude other photographers events', async () => {
      // Event owned by photographer 1
      const event1 = 'e0000000-0000-0000-0000-000000000001';
      insertTestEvent(db, { id: event1, owner_id: 1, name: 'Photographer 1 Wedding' });
      insertTestStorageUsage(db, {
        event_id: event1,
        total_bytes: 10000000,
        original_bytes: 10000000,
      });

      // Event owned by photographer 2
      const event2 = 'e0000000-0000-0000-0000-000000000002';
      insertTestEvent(db, { id: event2, owner_id: 2, name: 'Photographer 2 Wedding' });
      insertTestStorageUsage(db, {
        event_id: event2,
        total_bytes: 500000000,
        original_bytes: 500000000,
      });

      // Querying photographer 1 must only see photographer 1's 10,000,000 bytes
      const summary1 = await getStorageUsageSummary(1);
      expect(summary1.totalBytes).toBe(10000000);
      expect(summary1.events).toHaveLength(1);
      expect(summary1.events[0].eventName).toBe('Photographer 1 Wedding');

      // Querying photographer 2 must only see photographer 2's 500,000,000 bytes
      const summary2 = await getStorageUsageSummary(2);
      expect(summary2.totalBytes).toBe(500000000);
      expect(summary2.events).toHaveLength(1);
      expect(summary2.events[0].eventName).toBe('Photographer 2 Wedding');
    });

    it('should never include raw R2 secret credentials in summary response', async () => {
      const summary = await getStorageUsageSummary(1);
      const json = JSON.stringify(summary);

      expect(json).not.toContain('secretAccessKey');
      expect(json).not.toContain('R2_SECRET_ACCESS_KEY');
      expect(json).not.toContain('accessKeyId');
      expect(json).not.toContain('aws_secret');
    });
  });
});
