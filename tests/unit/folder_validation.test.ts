import { describe, it, expect } from 'vitest';
import {
  validateAndNormalizeFolderName,
  MAX_FOLDER_NAME_LENGTH,
} from '../../apps/api/src/services/folderService.js';
import { ValidationError } from '@photography-saas/errors';

describe('Folder Name Validation & Normalization Unit Tests', () => {
  it('should trim leading and trailing whitespace from valid names', () => {
    expect(validateAndNormalizeFolderName('  Ceremony  ')).toBe('Ceremony');
    expect(validateAndNormalizeFolderName('\tReception & Dinner\n')).toBe('Reception & Dinner');
    expect(validateAndNormalizeFolderName('Couple Portraits')).toBe('Couple Portraits');
  });

  it('should reject non-string input with ValidationError', () => {
    expect(() => validateAndNormalizeFolderName(null)).toThrow(ValidationError);
    expect(() => validateAndNormalizeFolderName(undefined)).toThrow(ValidationError);
    expect(() => validateAndNormalizeFolderName(123)).toThrow(ValidationError);
    expect(() => validateAndNormalizeFolderName({})).toThrow(ValidationError);
  });

  it('should reject empty or whitespace-only folder names with ValidationError', () => {
    expect(() => validateAndNormalizeFolderName('')).toThrow(ValidationError);
    expect(() => validateAndNormalizeFolderName('   ')).toThrow(ValidationError);
    expect(() => validateAndNormalizeFolderName('\t\n')).toThrow(ValidationError);
  });

  it('should accept folder names up to 255 characters', () => {
    const validMax = 'A'.repeat(MAX_FOLDER_NAME_LENGTH);
    expect(validateAndNormalizeFolderName(validMax)).toBe(validMax);
  });

  it('should reject folder names exceeding 255 characters with ValidationError', () => {
    const tooLong = 'A'.repeat(MAX_FOLDER_NAME_LENGTH + 1);
    expect(() => validateAndNormalizeFolderName(tooLong)).toThrow(ValidationError);
    expect(() => validateAndNormalizeFolderName(`  ${tooLong}  `)).toThrow(ValidationError);
  });

  it('should preserve unicode and editorial characters in folder names', () => {
    const names = [
      'Haldi & Mehndi — Day 1',
      'The Afterparty (VIP Lounge)',
      'Sangeet / Dance Night',
      'Événement & Cérémonie',
      '70’s Golden Hour & Sunset',
    ];

    for (const name of names) {
      expect(validateAndNormalizeFolderName(name)).toBe(name);
    }
  });
});
