import { describe, it, expect } from 'vitest';
import {
  QUEUE_CONFIG,
  validatePhotoJobPayload,
  validateVideoJobPayload,
} from '../../apps/api/src/services/queue/queueConfig.js';
import { getBullMQConnectionOptions } from '../../apps/api/src/services/queue/queueConnection.js';
import {
  ValidationError,
  MediaNotFoundError,
  CorruptImageError,
  DecompressionBombError,
  CorruptVideoError,
  VideoDurationExceededError,
  VideoDimensionsExceededError,
} from '@photography-saas/errors';

describe('Phase 13: Background Queue Configuration & Job Validation Unit Tests', () => {
  const VALID_MEDIA_ID = '10000000-0000-0000-0000-000000000001';
  const VALID_EVENT_ID = 'e0000000-0000-0000-0000-000000000001';

  describe('1. Workload Separation & Queue Configuration (QUEUE_CONFIG)', () => {
    it('enforces distinct queue names for photo and video workloads', () => {
      expect(QUEUE_CONFIG.names.PHOTO).toBe('photo-processing');
      expect(QUEUE_CONFIG.names.VIDEO).toBe('video-processing');
      expect(QUEUE_CONFIG.names.PHOTO).not.toBe(QUEUE_CONFIG.names.VIDEO);
    });

    it('configures bounded photo concurrency and 3 exponential retries', () => {
      expect(QUEUE_CONFIG.photo.concurrency).toBe(4);
      expect(QUEUE_CONFIG.photo.attempts).toBe(3);
      expect(QUEUE_CONFIG.photo.backoff.type).toBe('exponential');
      expect(QUEUE_CONFIG.photo.backoff.delay).toBe(2000);
    });

    it('strictly isolates video processing to concurrency = 1 with 2 retries', () => {
      expect(QUEUE_CONFIG.video.concurrency).toBe(1);
      expect(QUEUE_CONFIG.video.attempts).toBe(2);
      expect(QUEUE_CONFIG.video.backoff.type).toBe('exponential');
      expect(QUEUE_CONFIG.video.backoff.delay).toBe(5000);
    });

    it('configures retention periods preventing unbounded Redis memory consumption', () => {
      // Completed jobs kept 24 hours
      expect(QUEUE_CONFIG.photo.removeOnComplete.age).toBe(86400);
      expect(QUEUE_CONFIG.video.removeOnComplete.age).toBe(86400);
      // Failed jobs kept 7 days for diagnostics
      expect(QUEUE_CONFIG.photo.removeOnFail.age).toBe(7 * 86400);
      expect(QUEUE_CONFIG.video.removeOnFail.age).toBe(7 * 86400);
    });

    it('sets shutdown grace period to 10 seconds', () => {
      expect(QUEUE_CONFIG.shutdown.gracePeriodMs).toBe(10000);
    });
  });

  describe('2. Photo Job Payload Validation (validatePhotoJobPayload)', () => {
    it('accepts a valid photo processing payload', () => {
      const payload = {
        mediaId: VALID_MEDIA_ID,
        eventId: VALID_EVENT_ID,
        version: 1,
        timestamp: 1672531199000,
      };

      const validated = validatePhotoJobPayload(payload);
      expect(validated.mediaId).toBe(VALID_MEDIA_ID);
      expect(validated.eventId).toBe(VALID_EVENT_ID);
      expect(validated.version).toBe(1);
      expect(validated.timestamp).toBe(1672531199000);
    });

    it('defaults optional version to 1 and provides a timestamp if omitted', () => {
      const payload = {
        mediaId: VALID_MEDIA_ID,
        eventId: VALID_EVENT_ID,
      };

      const before = Date.now();
      const validated = validatePhotoJobPayload(payload);
      const after = Date.now();

      expect(validated.version).toBe(1);
      expect(validated.timestamp).toBeGreaterThanOrEqual(before);
      expect(validated.timestamp).toBeLessThanOrEqual(after);
    });

    it('rejects non-object or null payloads', () => {
      expect(() => validatePhotoJobPayload(null)).toThrow(ValidationError);
      expect(() => validatePhotoJobPayload('invalid-string')).toThrow(ValidationError);
      expect(() => validatePhotoJobPayload(12345)).toThrow(ValidationError);
    });

    it('rejects invalid or missing mediaId', () => {
      expect(() =>
        validatePhotoJobPayload({ mediaId: 'not-a-uuid', eventId: VALID_EVENT_ID })
      ).toThrow(ValidationError);

      expect(() =>
        validatePhotoJobPayload({ eventId: VALID_EVENT_ID })
      ).toThrow(ValidationError);
    });

    it('rejects invalid or missing eventId', () => {
      expect(() =>
        validatePhotoJobPayload({ mediaId: VALID_MEDIA_ID, eventId: 'bad-uuid' })
      ).toThrow(ValidationError);

      expect(() =>
        validatePhotoJobPayload({ mediaId: VALID_MEDIA_ID })
      ).toThrow(ValidationError);
    });
  });

  describe('3. Video Job Payload Validation (validateVideoJobPayload)', () => {
    it('accepts a valid video processing payload', () => {
      const payload = {
        mediaId: VALID_MEDIA_ID,
        eventId: VALID_EVENT_ID,
        version: 1,
      };

      const validated = validateVideoJobPayload(payload);
      expect(validated.mediaId).toBe(VALID_MEDIA_ID);
      expect(validated.eventId).toBe(VALID_EVENT_ID);
      expect(validated.version).toBe(1);
    });

    it('rejects malformed video job payloads', () => {
      expect(() => validateVideoJobPayload({})).toThrow(ValidationError);
      expect(() =>
        validateVideoJobPayload({ mediaId: 'not-valid', eventId: VALID_EVENT_ID })
      ).toThrow(ValidationError);
      expect(() =>
        validateVideoJobPayload({ mediaId: VALID_MEDIA_ID, eventId: 'bad' })
      ).toThrow(ValidationError);
    });
  });

  describe('4. BullMQ Redis Connection Options (getBullMQConnectionOptions)', () => {
    it('ensures maxRetriesPerRequest is null and enableReadyCheck is false', () => {
      const options = getBullMQConnectionOptions();
      expect(options.maxRetriesPerRequest).toBeNull();
      expect(options.enableReadyCheck).toBe(false);
      expect(options.lazyConnect).toBe(true);
    });
  });
});
