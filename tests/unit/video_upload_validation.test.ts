import { describe, it, expect } from 'vitest';
import {
  validateMediaUploadItem,
} from '../../apps/api/src/services/mediaUploadService.js';
import {
  validateClientMediaFile,
  validateClientPhotoFile,
  MAX_VIDEO_SIZE_BYTES,
  MAX_PHOTO_SIZE_BYTES,
} from '../../apps/web/lib/uploadManager.js';
import {
  UnsupportedMediaTypeError,
  FileTooLargeError,
  ValidationError,
} from '@photography-saas/errors';

describe('Phase 12: Video Upload Validation Unit Tests', () => {
  describe('Server-side validateMediaUploadItem for Videos', () => {
    it('accepts valid MP4 video files', () => {
      const result = validateMediaUploadItem({
        filename: 'wedding_highlights.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 150 * 1024 * 1024,
      });

      expect(result.normalizedExt).toBe('mp4');
      expect(result.cleanOriginalName).toBe('wedding_highlights.mp4');
      expect(result.mediaType).toBe('video');
    });

    it('accepts valid QuickTime MOV video files', () => {
      const result = validateMediaUploadItem({
        filename: 'ceremony_raw.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 350 * 1024 * 1024,
      });

      expect(result.normalizedExt).toBe('mov');
      expect(result.cleanOriginalName).toBe('ceremony_raw.mov');
      expect(result.mediaType).toBe('video');
    });

    it('accepts valid WebM video files', () => {
      const result = validateMediaUploadItem({
        filename: 'drone_teaser.webm',
        mimeType: 'video/webm',
        sizeBytes: 80 * 1024 * 1024,
      });

      expect(result.normalizedExt).toBe('webm');
      expect(result.cleanOriginalName).toBe('drone_teaser.webm');
      expect(result.mediaType).toBe('video');
    });

    it('rejects video exceeding maximum allowed size (500 MB)', () => {
      expect(() => {
        validateMediaUploadItem({
          filename: 'huge_ceremony.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 550 * 1024 * 1024,
        });
      }).toThrowError(FileTooLargeError);
    });

    it('rejects video with 0 bytes or negative size', () => {
      expect(() => {
        validateMediaUploadItem({
          filename: 'corrupt.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 0,
        });
      }).toThrowError(ValidationError);

      expect(() => {
        validateMediaUploadItem({
          filename: 'negative.mp4',
          mimeType: 'video/mp4',
          sizeBytes: -100,
        });
      }).toThrowError(ValidationError);
    });

    it('rejects unsupported video containers (.avi, .mkv, .flv, .wmv)', () => {
      expect(() => {
        validateMediaUploadItem({
          filename: 'legacy.avi',
          mimeType: 'video/x-msvideo',
          sizeBytes: 10 * 1024 * 1024,
        });
      }).toThrowError(UnsupportedMediaTypeError);

      expect(() => {
        validateMediaUploadItem({
          filename: 'stream.mkv',
          mimeType: 'video/x-matroska',
          sizeBytes: 10 * 1024 * 1024,
        });
      }).toThrowError(UnsupportedMediaTypeError);
    });

    it('rejects mismatched extension and MIME type (e.g. mp4 extension with image/jpeg MIME)', () => {
      expect(() => {
        validateMediaUploadItem({
          filename: 'trick.mp4',
          mimeType: 'image/jpeg',
          sizeBytes: 10 * 1024 * 1024,
        });
      }).toThrowError(UnsupportedMediaTypeError);
    });

    it('rejects non-video and executable files (.exe, .sh, .svg)', () => {
      expect(() => {
        validateMediaUploadItem({
          filename: 'payload.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 1024,
        });
      }).toThrowError(UnsupportedMediaTypeError);

      expect(() => {
        validateMediaUploadItem({
          filename: 'vector.svg',
          mimeType: 'image/svg+xml',
          sizeBytes: 1024,
        });
      }).toThrowError(UnsupportedMediaTypeError);
    });

    it('correctly handles photos alongside videos in validateMediaUploadItem', () => {
      const photoResult = validateMediaUploadItem({
        filename: 'couple.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10 * 1024 * 1024,
      });
      expect(photoResult.mediaType).toBe('photo');
      expect(photoResult.normalizedExt).toBe('jpg');
    });
  });

  describe('Client-side validateClientMediaFile', () => {
    it('validates valid client video files', () => {
      const mockMp4 = new File([new ArrayBuffer(1000)], 'teaser.mp4', { type: 'video/mp4' });
      const res = validateClientMediaFile(mockMp4);
      expect(res.error).toBeNull();
      expect(res.mediaType).toBe('video');
    });

    it('validates valid client MOV files', () => {
      const mockMov = new File([new ArrayBuffer(2000)], 'cinematic.mov', { type: 'video/quicktime' });
      const res = validateClientMediaFile(mockMov);
      expect(res.error).toBeNull();
      expect(res.mediaType).toBe('video');
    });

    it('validates valid client WebM files', () => {
      const mockWebm = new File([new ArrayBuffer(3000)], 'clip.webm', { type: 'video/webm' });
      const res = validateClientMediaFile(mockWebm);
      expect(res.error).toBeNull();
      expect(res.mediaType).toBe('video');
    });

    it('rejects oversized video file on client', () => {
      const largeFile = {
        name: 'huge.mp4',
        size: 600 * 1024 * 1024,
        type: 'video/mp4',
      } as File;
      const res = validateClientMediaFile(largeFile);
      expect(res.error).toContain('exceeds maximum allowed size of 500 MB');
    });

    it('rejects unsupported client video format (.avi)', () => {
      const aviFile = new File([new ArrayBuffer(100)], 'test.avi', { type: 'video/x-msvideo' });
      const res = validateClientMediaFile(aviFile);
      expect(res.error).toContain('Unsupported extension ".avi"');
    });
  });
});
