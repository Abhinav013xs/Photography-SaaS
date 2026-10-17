import { describe, it, expect } from 'vitest';
import { redactUrlForLogs } from '../../apps/api/src/infrastructure/storageAdapter.js';
import { buildStorageKey, parseStorageKey } from '@photography-saas/types';

describe('Storage Security & Secret Redaction', () => {
  describe('redactUrlForLogs', () => {
    it('should strip AWS Signature V4 security parameters from signed URLs', () => {
      const rawSignedUrl =
        'https://my-account.r2.cloudflarestorage.com/my-bucket/events/e0000000-0000-0000-0000-000000000001/originals/photo.jpg' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261009%2Fauto%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20261009T100000Z' +
        '&X-Amz-Expires=900' +
        '&X-Amz-Signature=d25f7a6b98e72c84218903cde8572b8347890123456789abcdef0123456789ab' +
        '&X-Amz-SignedHeaders=host';

      const redacted = redactUrlForLogs(rawSignedUrl);

      expect(redacted).not.toContain('d25f7a6b98e72c84218903cde8572b8347890123456789abcdef0123456789ab');
      expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(redacted).toContain('X-Amz-Signature=%5BREDACTED%5D');
      expect(redacted).toContain('X-Amz-Credential=%5BREDACTED%5D');
      expect(redacted).toContain('/events/e0000000-0000-0000-0000-000000000001/originals/photo.jpg');
    });

    it('should strip generic tokens and signatures', () => {
      const rawUrl = 'https://r2.example.com/asset.jpg?token=secret123&sig=supersecret&foo=bar';
      const redacted = redactUrlForLogs(rawUrl);

      expect(redacted).not.toContain('secret123');
      expect(redacted).not.toContain('supersecret');
      expect(redacted).toContain('foo=bar');
    });

    it('should handle invalid URLs safely without throwing', () => {
      expect(redactUrlForLogs('not-a-valid-url')).toBe('[REDACTED_URL]');
    });
  });

  describe('Path Traversal & Injection Defenses', () => {
    const validEventId = 'e0000000-0000-0000-0000-000000000001';

    it('should prevent directory traversal attacks in storage key creation', () => {
      const maliciousFilenames = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\cmd.exe',
        'photo.jpg/../../malicious',
        'sub/dir/photo.jpg',
        'file\0.jpg',
        '..',
        '.',
      ];

      for (const badFile of maliciousFilenames) {
        expect(() => buildStorageKey(validEventId, 'originals', badFile)).toThrow();
        expect(parseStorageKey(`events/${validEventId}/originals/${badFile}`)).toBeNull();
      }
    });

    it('should prevent event ID parameter tampering', () => {
      const maliciousEventIds = [
        '../e0000000-0000-0000-0000-000000000001',
        'e0000000-0000-0000-0000-000000000001/sub',
        'e0000000-0000-0000-0000-000000000001\\sub',
        '1; DROP TABLE events; --',
      ];

      for (const badId of maliciousEventIds) {
        expect(() => buildStorageKey(badId, 'originals', 'photo.jpg')).toThrow();
        expect(parseStorageKey(`events/${badId}/originals/photo.jpg`)).toBeNull();
      }
    });
  });
});
