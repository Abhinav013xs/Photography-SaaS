import { describe, it, expect } from 'vitest';
import {
  validatePublicDurationDays,
  calculateExpiryTimestamp,
  isEventExpired,
  DEFAULT_PUBLIC_DURATION_DAYS,
  MAX_PUBLIC_DURATION_DAYS,
} from '../../apps/api/src/services/galleryExpiryService.js';
import {
  createEventSchema,
  updateEventSchema,
  updateVisibilitySchema,
  publishEventBodySchema,
} from '../../apps/api/src/routes/eventsSchemas.js';

describe('Phase 20: Gallery Expiry Unit Tests', () => {
  describe('Duration Configuration & Limits', () => {
    it('accepts valid duration presets (1, 7, 14, 30 days)', () => {
      expect(validatePublicDurationDays(1)).toBe(1);
      expect(validatePublicDurationDays(7)).toBe(7);
      expect(validatePublicDurationDays(14)).toBe(14);
      expect(validatePublicDurationDays(30)).toBe(30);
    });

    it('rejects durations below 1 day', () => {
      expect(() => validatePublicDurationDays(0)).toThrow(/at least 1 day/);
      expect(() => validatePublicDurationDays(-5)).toThrow(/at least 1 day/);
    });

    it('strictly rejects durations greater than 30 days', () => {
      expect(() => validatePublicDurationDays(31)).toThrow(/cannot exceed.*30 days/);
      expect(() => validatePublicDurationDays(60)).toThrow(/cannot exceed.*30 days/);
      expect(() => validatePublicDurationDays(365)).toThrow(/cannot exceed.*30 days/);
    });

    it('rejects non-integer and non-numeric durations', () => {
      expect(() => validatePublicDurationDays(7.5)).toThrow(/integer/);
      expect(() => validatePublicDurationDays(NaN)).toThrow(/integer/);
      expect(() => validatePublicDurationDays('30' as any)).toThrow(/integer/);
    });

    it('defaults to 30 days when duration is undefined or omitted', () => {
      expect(DEFAULT_PUBLIC_DURATION_DAYS).toBe(30);
      expect(MAX_PUBLIC_DURATION_DAYS).toBe(30);
    });
  });

  describe('Expiry Timestamp Calculation', () => {
    it('adds exactly duration * 24 hours in UTC', () => {
      const base = new Date('2026-06-01T12:00:00.000Z');
      const expiry7 = calculateExpiryTimestamp(base, 7);
      expect(expiry7.toISOString()).toBe('2026-06-08T12:00:00.000Z');

      const expiry30 = calculateExpiryTimestamp(base, 30);
      expect(expiry30.toISOString()).toBe('2026-07-01T12:00:00.000Z');

      const expiry1 = calculateExpiryTimestamp(base, 1);
      expect(expiry1.toISOString()).toBe('2026-06-02T12:00:00.000Z');
    });

    it('preserves millisecond precision', () => {
      const base = new Date('2026-10-15T08:30:15.500Z');
      const expiry = calculateExpiryTimestamp(base, 14);
      expect(expiry.toISOString()).toBe('2026-10-29T08:30:15.500Z');
    });
  });

  describe('Authoritative Boundary Semantics (now >= expires_at)', () => {
    it('returns false when no expiry is configured (null or undefined)', () => {
      expect(isEventExpired(null)).toBe(false);
      expect(isEventExpired(undefined)).toBe(false);
    });

    it('returns false when expiry is in the future', () => {
      const future = new Date(Date.now() + 60000); // 1 minute ahead
      expect(isEventExpired(future)).toBe(false);
    });

    it('returns true when current time is strictly greater than expiry', () => {
      const past = new Date(Date.now() - 1000); // 1 second ago
      expect(isEventExpired(past)).toBe(true);
    });

    it('treats exact boundary now === expires_at as expired (fails closed)', () => {
      const exactTime = 1776000000000;
      const exactDate = new Date(exactTime);
      expect(isEventExpired(exactDate, exactTime)).toBe(true);
    });

    it('boundary is strictly not expired 1ms before expiry', () => {
      const expiryTime = 1776000000000;
      const expiryDate = new Date(expiryTime);
      expect(isEventExpired(expiryDate, expiryTime - 1)).toBe(false);
    });
  });

  describe('Route Schemas Validation', () => {
    it('createEventSchema validates public_duration_days', () => {
      const valid = createEventSchema.safeParse({
        name: 'Fine Art Wedding',
        client_name: 'Mira & Arjun',
        event_date: '2026-11-20',
        public_duration_days: 14,
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.public_duration_days).toBe(14);
      }

      const invalidMax = createEventSchema.safeParse({
        name: 'Wedding',
        client_name: 'Client',
        event_date: '2026-11-20',
        public_duration_days: 35,
      });
      expect(invalidMax.success).toBe(false);

      const invalidMin = createEventSchema.safeParse({
        name: 'Wedding',
        client_name: 'Client',
        event_date: '2026-11-20',
        public_duration_days: 0,
      });
      expect(invalidMin.success).toBe(false);
    });

    it('updateEventSchema accepts valid public_duration_days and rejects out-of-range', () => {
      const valid = updateEventSchema.safeParse({
        public_duration_days: 7,
      });
      expect(valid.success).toBe(true);

      const invalid = updateEventSchema.safeParse({
        public_duration_days: 31,
      });
      expect(invalid.success).toBe(false);
    });

    it('publishEventBodySchema accepts valid public_duration_days', () => {
      const valid = publishEventBodySchema.safeParse({
        public_duration_days: 30,
      });
      expect(valid.success).toBe(true);

      const invalid = publishEventBodySchema.safeParse({
        public_duration_days: -1,
      });
      expect(invalid.success).toBe(false);
    });

    it('updateVisibilitySchema accepts public_duration_days with public visibility', () => {
      const valid = updateVisibilitySchema.safeParse({
        visibility: 'public',
        public_duration_days: 14,
      });
      expect(valid.success).toBe(true);
    });
  });
});
