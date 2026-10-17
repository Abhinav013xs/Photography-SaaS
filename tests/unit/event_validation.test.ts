import { describe, it, expect } from 'vitest';
import {
  validatePublicWindow,
  hashEventPin,
} from '../../apps/api/src/services/eventService.js';
import {
  ValidationError,
  PublicWindowExceededError,
} from '@photography-saas/errors';
import bcrypt from 'bcryptjs';

describe('Event Validation & Business Rules Unit Tests', () => {
  describe('30-Day Public Gallery Window Enforcement', () => {
    it('should allow valid public windows of 7 days, 14 days, and 30 days', () => {
      const now = new Date('2026-10-01T00:00:00.000Z');
      const in7Days = new Date('2026-10-08T00:00:00.000Z');
      const in30Days = new Date('2026-10-31T00:00:00.000Z');

      expect(() => validatePublicWindow(now, in7Days)).not.toThrow();
      expect(() => validatePublicWindow(now, in30Days)).not.toThrow();
    });

    it('should reject public windows exceeding 30 days with PublicWindowExceededError', () => {
      const start = '2026-10-01T00:00:00.000Z';
      const until31Days = '2026-11-02T00:00:00.000Z'; // 32 days later

      expect(() => validatePublicWindow(start, until31Days)).toThrow(PublicWindowExceededError);
    });

    it('should reject reversed dates where public_until is before public_start', () => {
      const start = '2026-10-15T00:00:00.000Z';
      const before = '2026-10-10T00:00:00.000Z';

      expect(() => validatePublicWindow(start, before)).toThrow(ValidationError);
    });

    it('should reject when only one of public_start or public_until is provided', () => {
      expect(() => validatePublicWindow('2026-10-01T00:00:00.000Z', null)).toThrow(ValidationError);
      expect(() => validatePublicWindow(null, '2026-10-30T00:00:00.000Z')).toThrow(ValidationError);
    });

    it('should allow both dates to be null or undefined (private gallery default)', () => {
      expect(() => validatePublicWindow(null, null)).not.toThrow();
      expect(() => validatePublicWindow(undefined, undefined)).not.toThrow();
    });
  });

  describe('PIN Validation & Bcrypt Hashing', () => {
    it('should securely hash valid 4-digit and 8-digit numeric PINs', async () => {
      const pin4 = '1234';
      const hash4 = await hashEventPin(pin4);
      expect(hash4).toBeDefined();
      expect(hash4).toMatch(/^\$2[ab]\$/);
      expect(await bcrypt.compare(pin4, hash4)).toBe(true);

      const pin8 = '98765432';
      const hash8 = await hashEventPin(pin8);
      expect(hash8).toBeDefined();
      expect(await bcrypt.compare(pin8, hash8)).toBe(true);
    });

    it('should reject PINs shorter than 4 digits with ValidationError', async () => {
      await expect(hashEventPin('123')).rejects.toThrow(ValidationError);
      await expect(hashEventPin('')).rejects.toThrow(ValidationError);
    });

    it('should reject PINs longer than 8 digits with ValidationError', async () => {
      await expect(hashEventPin('123456789')).rejects.toThrow(ValidationError);
    });

    it('should reject non-numeric PINs with ValidationError', async () => {
      await expect(hashEventPin('12a4')).rejects.toThrow(ValidationError);
      await expect(hashEventPin('abcd')).rejects.toThrow(ValidationError);
      await expect(hashEventPin('12 34')).rejects.toThrow(ValidationError);
    });
  });
});
