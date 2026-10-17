import { describe, it, expect } from 'vitest';
import {
  buildStorageKey,
  parseStorageKey,
  isValidStorageKey,
  sanitizeStorageFilename,
  STORAGE_CATEGORIES,
} from '@photography-saas/types';

describe('Storage Key Conventions & Path Traversal Defense', () => {
  const validEventId = 'e0000000-0000-0000-0000-000000000001';

  describe('buildStorageKey', () => {
    it('should generate valid deterministic keys for all supported categories', () => {
      for (const category of STORAGE_CATEGORIES) {
        const key = buildStorageKey(validEventId, category, 'photo-001.jpg');
        expect(key).toBe(`events/${validEventId}/${category}/photo-001.jpg`);
      }
    });

    it('should generate valid keys for preview and thumbnail derivatives', () => {
      const previewKey = buildStorageKey(validEventId, 'previews', 'portrait-01.webp');
      const thumbKey = buildStorageKey(validEventId, 'thumbnails', 'portrait-01.webp');

      expect(previewKey).toBe(`events/${validEventId}/previews/portrait-01.webp`);
      expect(thumbKey).toBe(`events/${validEventId}/thumbnails/portrait-01.webp`);
    });

    it('should reject non-UUID event IDs', () => {
      expect(() => buildStorageKey('invalid-event-id', 'originals', 'photo.jpg')).toThrow(
        /must be a valid UUID/
      );
      expect(() => buildStorageKey('../events/123', 'originals', 'photo.jpg')).toThrow(
        /must be a valid UUID/
      );
      expect(() => buildStorageKey('', 'originals', 'photo.jpg')).toThrow(/must be a valid UUID/);
    });

    it('should reject unsupported storage categories', () => {
      // @ts-expect-error testing runtime validation of invalid category
      expect(() => buildStorageKey(validEventId, 'albums', 'photo.jpg')).toThrow(
        /Invalid storage category/
      );
      // @ts-expect-error testing runtime validation of invalid category
      expect(() => buildStorageKey(validEventId, 'temp', 'photo.jpg')).toThrow(
        /Invalid storage category/
      );
    });

    it('should reject path traversal in filenames', () => {
      expect(() => buildStorageKey(validEventId, 'originals', '../secret.env')).toThrow(
        /invalid path characters or traversal/
      );
      expect(() => buildStorageKey(validEventId, 'originals', 'subdir/photo.jpg')).toThrow(
        /invalid path characters or traversal/
      );
      expect(() => buildStorageKey(validEventId, 'originals', '..\\secret.env')).toThrow(
        /invalid path characters or traversal/
      );
      expect(() => buildStorageKey(validEventId, 'originals', 'photo\0.jpg')).toThrow(
        /invalid path characters or traversal/
      );
    });

    it('should reject empty or whitespace-only filenames', () => {
      expect(() => buildStorageKey(validEventId, 'originals', '')).toThrow(/non-empty/);
      expect(() => buildStorageKey(validEventId, 'originals', '   ')).toThrow(/length must be between/);
    });
  });

  describe('parseStorageKey', () => {
    it('should successfully parse valid deterministic storage keys', () => {
      const parsed = parseStorageKey(`events/${validEventId}/originals/dsc_0001.raw`);
      expect(parsed).toEqual({
        eventId: validEventId,
        category: 'originals',
        filename: 'dsc_0001.raw',
      });
    });

    it('should return null for malformed keys or wrong prefixes', () => {
      expect(parseStorageKey('media/123/originals/photo.jpg')).toBeNull();
      expect(parseStorageKey('events/photo.jpg')).toBeNull();
      expect(parseStorageKey(`events/${validEventId}/originals`)).toBeNull();
      expect(parseStorageKey(`events/${validEventId}/originals/sub/photo.jpg`)).toBeNull();
    });

    it('should return null for path traversal attempts', () => {
      expect(parseStorageKey(`events/${validEventId}/originals/../secret.txt`)).toBeNull();
      expect(parseStorageKey(`/events/${validEventId}/originals/photo.jpg`)).toBeNull();
      expect(parseStorageKey(`events/${validEventId}/originals/photo.jpg/`)).toBeNull();
      expect(parseStorageKey(`events/${validEventId}/originals/photo\\hack.jpg`)).toBeNull();
      expect(parseStorageKey(`events/${validEventId}/originals/photo\0.jpg`)).toBeNull();
    });

    it('should return null if event ID is not a valid UUID', () => {
      expect(parseStorageKey('events/not-a-uuid/originals/photo.jpg')).toBeNull();
    });

    it('should return null if category is not recognized', () => {
      expect(parseStorageKey(`events/${validEventId}/private_folder/photo.jpg`)).toBeNull();
    });
  });

  describe('isValidStorageKey', () => {
    it('should return true for valid keys', () => {
      expect(isValidStorageKey(`events/${validEventId}/originals/master.jpg`)).toBe(true);
      expect(isValidStorageKey(`events/${validEventId}/previews/preview.webp`)).toBe(true);
      expect(isValidStorageKey(`events/${validEventId}/thumbnails/thumb.webp`)).toBe(true);
      expect(isValidStorageKey(`events/${validEventId}/videos/clip.mp4`)).toBe(true);
      expect(isValidStorageKey(`events/${validEventId}/exports/full_gallery.zip`)).toBe(true);
    });

    it('should return false for arbitrary or invalid keys', () => {
      expect(isValidStorageKey('arbitrary/key.jpg')).toBe(false);
      expect(isValidStorageKey('')).toBe(false);
      // @ts-expect-error testing runtime non-string input
      expect(isValidStorageKey(null)).toBe(false);
      expect(isValidStorageKey('../../../etc/passwd')).toBe(false);
    });
  });

  describe('sanitizeStorageFilename', () => {
    it('should allow clean filenames with dots, dashes, underscores', () => {
      expect(sanitizeStorageFilename('photo-001_final.preview.webp')).toBe('photo-001_final.preview.webp');
    });

    it('should trim leading/trailing spaces', () => {
      expect(sanitizeStorageFilename('  photo.jpg  ')).toBe('photo.jpg');
    });
  });
});
