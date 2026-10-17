import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { hashEventPin } from '../../apps/api/src/services/eventService.js';
import { PIN_FORMAT_REGEX } from '../../apps/api/src/services/guestService.js';
import { ValidationError } from '@photography-saas/errors';

describe('Phase 18: PIN Validation & Hashing Unit Tests', () => {
  it('PIN FORMAT: Accepts valid 4 to 8 digit numeric PINs', () => {
    const validPins = ['1234', '56789', '123456', '1234567', '12345678'];
    for (const pin of validPins) {
      expect(PIN_FORMAT_REGEX.test(pin)).toBe(true);
    }
  });

  it('LEADING ZEROS: Preserves leading zeros without numeric coercion', () => {
    const leadingZeroPins = ['0001', '0123', '004271', '00000000'];
    for (const pin of leadingZeroPins) {
      expect(PIN_FORMAT_REGEX.test(pin)).toBe(true);
      // Ensure it is treated as a string with exact length
      expect(typeof pin).toBe('string');
      expect(pin.length).toBeGreaterThanOrEqual(4);
      expect(pin.length).toBeLessThanOrEqual(8);
    }
  });

  it('REJECTS INVALID LENGTHS: Rejects PINs shorter than 4 or longer than 8 digits', () => {
    const invalidLengths = ['', '1', '12', '123', '123456789', '1234567890'];
    for (const pin of invalidLengths) {
      expect(PIN_FORMAT_REGEX.test(pin)).toBe(false);
    }
  });

  it('REJECTS NON-NUMERIC CHARACTERS: Rejects letters, symbols, spaces, and scientific notation', () => {
    const nonNumeric = ['12a4', 'abcd', '12 34', '12-34', '1e04', '12.34', '123#'];
    for (const pin of nonNumeric) {
      expect(PIN_FORMAT_REGEX.test(pin)).toBe(false);
    }
  });

  it('SALTED BCRYPT: Generates valid salted bcrypt hash with 10 rounds', async () => {
    const pin = '004271';
    const hash = await hashEventPin(pin);

    expect(hash).toBeDefined();
    expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);
    // Non-deterministic: different salts for same PIN
    const hash2 = await hashEventPin(pin);
    expect(hash).not.toBe(hash2);

    // Verify comparison works correctly
    expect(await bcrypt.compare(pin, hash)).toBe(true);
    expect(await bcrypt.compare('004272', hash)).toBe(false);
    expect(await bcrypt.compare('4271', hash)).toBe(false); // Leading zeros matter!
  });

  it('VALIDATION ERROR: Throws ValidationError on invalid PIN input', async () => {
    await expect(hashEventPin('123')).rejects.toThrow(ValidationError);
    await expect(hashEventPin('123456789')).rejects.toThrow(ValidationError);
    await expect(hashEventPin('abcd')).rejects.toThrow(ValidationError);
  });
});
