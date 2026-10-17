import { describe, it, expect } from 'vitest';
import {
  validatePhotoUploadItem,
} from '../../apps/api/src/services/mediaUploadService.js';
import {
  validateClientPhotoFile,
  formatBytes,
  MAX_PHOTO_SIZE_BYTES,
} from '../../apps/web/lib/uploadManager.js';
import {
  UnsupportedMediaTypeError,
  FileTooLargeError,
  ValidationError,
} from '@photography-saas/errors';

describe('Phase 10: Photo Upload Validation Unit Tests', () => {
  describe('Server-side validatePhotoUploadItem', () => {
    it('accepts valid JPEG files', () => {
      const result = validatePhotoUploadItem({
        filename: 'wedding_portrait.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 15 * 1024 * 1024,
      });

      expect(result.normalizedExt).toBe('jpg');
      expect(result.cleanOriginalName).toBe('wedding_portrait.jpg');
    });

    it('accepts valid JPEG with .jpeg extension and normalizes to jpg', () => {
      const result = validatePhotoUploadItem({
        filename: 'ceremony_shot.jpeg',
        mimeType: 'image/jpeg',
        sizeBytes: 12 * 1024 * 1024,
      });

      expect(result.normalizedExt).toBe('jpg');
      expect(result.cleanOriginalName).toBe('ceremony_shot.jpeg');
    });

    it('accepts valid PNG files', () => {
      const result = validatePhotoUploadItem({
        filename: 'studio_logo_overlay.png',
        mimeType: 'image/png',
        sizeBytes: 5 * 1024 * 1024,
      });

      expect(result.normalizedExt).toBe('png');
      expect(result.cleanOriginalName).toBe('studio_logo_overlay.png');
    });

    it('accepts valid WebP files', () => {
      const result = validatePhotoUploadItem({
        filename: 'landscape.webp',
        mimeType: 'image/webp',
        sizeBytes: 8 * 1024 * 1024,
      });

      expect(result.normalizedExt).toBe('webp');
      expect(result.cleanOriginalName).toBe('landscape.webp');
    });

    it('sanitizes filename and strips path traversal prefixes', () => {
      const result = validatePhotoUploadItem({
        filename: '../../../../etc/passwd/secret_photo.JPG',
        mimeType: 'image/jpeg',
        sizeBytes: 10 * 1024 * 1024,
      });

      expect(result.cleanOriginalName).toBe('secret_photo.JPG');
      expect(result.normalizedExt).toBe('jpg');
    });

    it('strictly rejects vector SVG files with a descriptive error', () => {
      expect(() =>
        validatePhotoUploadItem({
          filename: 'graphic.svg',
          mimeType: 'image/svg+xml',
          sizeBytes: 1024,
        })
      ).toThrow(UnsupportedMediaTypeError);

      try {
        validatePhotoUploadItem({
          filename: 'graphic.svg',
          mimeType: 'image/svg+xml',
          sizeBytes: 1024,
        });
      } catch (err: any) {
        expect(err.message).toContain('Vector SVG files are not supported as photography assets');
      }
    });

    it('strictly rejects HEIC/HEIF files with an actionable guidance message', () => {
      expect(() =>
        validatePhotoUploadItem({
          filename: 'iphone_photo.heic',
          mimeType: 'image/heic',
          sizeBytes: 5 * 1024 * 1024,
        })
      ).toThrow(UnsupportedMediaTypeError);

      try {
        validatePhotoUploadItem({
          filename: 'iphone_photo.heic',
          mimeType: 'image/heic',
          sizeBytes: 5 * 1024 * 1024,
        });
      } catch (err: any) {
        expect(err.message).toContain('HEIC/HEIF is not currently supported');
      }
    });

    it('rejects arbitrary unsupported formats like TIFF, GIF, or PDF', () => {
      expect(() =>
        validatePhotoUploadItem({
          filename: 'document.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        })
      ).toThrow(UnsupportedMediaTypeError);

      expect(() =>
        validatePhotoUploadItem({
          filename: 'animation.gif',
          mimeType: 'image/gif',
          sizeBytes: 1024,
        })
      ).toThrow(UnsupportedMediaTypeError);
    });

    it('rejects files exceeding the 100 MB maximum threshold', () => {
      const oversizedBytes = 101 * 1024 * 1024; // 101 MB
      expect(() =>
        validatePhotoUploadItem({
          filename: 'gigantic_raw_export.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: oversizedBytes,
        })
      ).toThrow(FileTooLargeError);
    });

    it('rejects zero or negative file sizes', () => {
      expect(() =>
        validatePhotoUploadItem({
          filename: 'empty.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 0,
        })
      ).toThrow(ValidationError);

      expect(() =>
        validatePhotoUploadItem({
          filename: 'negative.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: -100,
        })
      ).toThrow(ValidationError);
    });

    it('rejects files without extensions', () => {
      expect(() =>
        validatePhotoUploadItem({
          filename: 'unknown_binary',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
        })
      ).toThrow(UnsupportedMediaTypeError);
    });
  });

  describe('Client-side validateClientPhotoFile', () => {
    it('returns null for valid JPEG file', () => {
      const file = new File(['fake-bytes'], 'wedding.jpg', { type: 'image/jpeg' });
      expect(validateClientPhotoFile(file)).toBeNull();
    });

    it('returns error message for SVG file', () => {
      const file = new File(['fake-bytes'], 'vector.svg', { type: 'image/svg+xml' });
      const error = validateClientPhotoFile(file);
      expect(error).toContain('Vector SVG files are not supported');
    });

    it('returns guidance message for HEIC file', () => {
      const file = new File(['fake-bytes'], 'camera.heic', { type: 'image/heic' });
      const error = validateClientPhotoFile(file);
      expect(error).toContain('HEIC/HEIF is not currently supported');
    });

    it('returns error for empty file', () => {
      const file = new File([], 'empty.jpg', { type: 'image/jpeg' });
      const error = validateClientPhotoFile(file);
      expect(error).toContain('File is empty');
    });
  });

  describe('Byte formatting helper', () => {
    it('formats 0 bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats kilobytes correctly', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('formats megabytes correctly', () => {
      expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
    });

    it('formats gigabytes correctly', () => {
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
    });
  });
});
