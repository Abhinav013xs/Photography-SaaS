import { describe, it, expect } from 'vitest';
import {
  sanitizeDownloadFilename,
  MAX_BULK_DOWNLOAD_ITEMS,
  PRESIGNED_DOWNLOAD_TTL_SECONDS,
  ZIP_RETENTION_HOURS,
} from '../../apps/api/src/services/downloadService.js';
import {
  DownloadsDisabledError,
  DownloadJobNotFoundError,
  DownloadLimitExceededError,
  NoMediaSelectedError,
  MediaNotReadyForDownloadError,
} from '@photography-saas/errors';

describe('Phase 21: Download Validation & Security Unit Tests', () => {
  describe('Filename Sanitization & Header Injection Defense', () => {
    it('preserves clean filenames and extensions', () => {
      const sanitized = sanitizeDownloadFilename('wedding_ceremony_001.jpg');
      expect(sanitized).toBe('wedding_ceremony_001.jpg');
    });

    it('neutralizes directory traversal sequences', () => {
      const sanitized = sanitizeDownloadFilename('../../../etc/passwd', 'fallback', '.jpg');
      expect(sanitized).not.toContain('..');
      expect(sanitized).not.toContain('/');
      expect(sanitized).not.toContain('\\');
      expect(sanitized).toBe('passwd.jpg');
    });

    it('strips carriage return and newline characters to prevent HTTP response header injection', () => {
      const malicious = 'innocent_photo.jpg\r\nSet-Cookie: session=evil\r\n';
      const sanitized = sanitizeDownloadFilename(malicious);
      expect(sanitized).not.toContain('\r');
      expect(sanitized).not.toContain('\n');
      expect(sanitized).not.toContain('Set-Cookie');
    });

    it('replaces dangerous filesystem characters with safe underscores', () => {
      const dirty = 'photo:with*bad?chars<and>pipes|quotes".jpg';
      const sanitized = sanitizeDownloadFilename(dirty);
      expect(sanitized).not.toMatch(/[<>:"/\\|?*]/);
      expect(sanitized).toContain('.jpg');
    });

    it('falls back to default basename when original name is empty or only special characters', () => {
      const sanitized = sanitizeDownloadFilename('   ', 'fallback_photo', '.jpg');
      expect(sanitized).toBe('fallback_photo.jpg');
    });

    it('appends fallback extension if file extension is missing', () => {
      const sanitized = sanitizeDownloadFilename('high_res_photo', 'fallback', '.jpg');
      expect(sanitized).toBe('high_res_photo.jpg');
    });

    it('truncates excessively long filenames while preserving the extension', () => {
      const veryLong = 'a'.repeat(200) + '.jpg';
      const sanitized = sanitizeDownloadFilename(veryLong);
      expect(sanitized.length).toBeLessThanOrEqual(120);
      expect(sanitized.endsWith('.jpg')).toBe(true);
    });
  });

  describe('Download System Constants & Operational Limits', () => {
    it('enforces maximum 500 items per bulk ZIP download', () => {
      expect(MAX_BULK_DOWNLOAD_ITEMS).toBe(500);
    });

    it('restricts presigned download URL lifetime to 15 minutes (900s)', () => {
      expect(PRESIGNED_DOWNLOAD_TTL_SECONDS).toBe(900);
    });

    it('sets temporary archive retention window to 24 hours', () => {
      expect(ZIP_RETENTION_HOURS).toBe(24);
    });
  });

  describe('Custom Error Codes and HTTP Status Mapping', () => {
    it('maps DownloadsDisabledError to HTTP 403 Forbidden', () => {
      const err = new DownloadsDisabledError('Downloads are disabled');
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('DOWNLOADS_DISABLED');
    });

    it('maps DownloadJobNotFoundError to HTTP 404 Not Found', () => {
      const err = new DownloadJobNotFoundError('Job not found');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('DOWNLOAD_JOB_NOT_FOUND');
    });

    it('maps DownloadLimitExceededError to HTTP 400 Bad Request', () => {
      const err = new DownloadLimitExceededError('Exceeded limit');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('DOWNLOAD_LIMIT_EXCEEDED');
    });

    it('maps NoMediaSelectedError to HTTP 400 Bad Request', () => {
      const err = new NoMediaSelectedError('No media selected');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('NO_MEDIA_SELECTED');
    });

    it('maps MediaNotReadyForDownloadError to HTTP 400 Bad Request', () => {
      const err = new MediaNotReadyForDownloadError('Media processing');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('MEDIA_NOT_READY');
    });
  });
});
