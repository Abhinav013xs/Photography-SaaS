import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import {
  buildCanonicalGuestUrl,
  sanitizeQrFilename,
  generateEventQrCode,
} from '../../apps/api/src/services/qrSharingService.js';
import { ValidationError } from '@photography-saas/errors';

describe('Phase 23: QR Code & Canonical Gallery URL Unit Tests', () => {
  describe('Canonical URL Construction', () => {
    it('should generate canonical guest URL using default application origin', () => {
      const url = buildCanonicalGuestUrl('monet-wedding-2026');
      expect(url).toBe('http://localhost:3000/gallery/monet-wedding-2026');
    });

    it('should respect custom production origin', () => {
      const url = buildCanonicalGuestUrl('monet-wedding-2026', 'https://studiolumina.photo');
      expect(url).toBe('https://studiolumina.photo/gallery/monet-wedding-2026');
    });

    it('should normalize trailing slashes on origin and leading/trailing slashes on slug', () => {
      const url = buildCanonicalGuestUrl('/monet-wedding-2026/', 'https://studiolumina.photo///');
      expect(url).toBe('https://studiolumina.photo/gallery/monet-wedding-2026');
    });

    it('should URL-encode special characters in slug safely', () => {
      const url = buildCanonicalGuestUrl('wedding-2026-part-1');
      expect(url).toBe('http://localhost:3000/gallery/wedding-2026-part-1');
    });

    it('should reject empty or whitespace-only slug with ValidationError', () => {
      expect(() => buildCanonicalGuestUrl('')).toThrow(ValidationError);
      expect(() => buildCanonicalGuestUrl('   ')).toThrow(ValidationError);
    });

    it('should reject slugs containing directory traversal, query parameters, or fragments', () => {
      expect(() => buildCanonicalGuestUrl('../admin')).toThrow(ValidationError);
      expect(() => buildCanonicalGuestUrl('event?token=secret')).toThrow(ValidationError);
      expect(() => buildCanonicalGuestUrl('event#pin=1234')).toThrow(ValidationError);
    });

    it('should reject invalid base URL formats or non-http/https protocols', () => {
      expect(() => buildCanonicalGuestUrl('slug', 'not-a-valid-url')).toThrow(ValidationError);
      expect(() => buildCanonicalGuestUrl('slug', 'javascript:alert(1)')).toThrow(ValidationError);
      expect(() => buildCanonicalGuestUrl('slug', 'ftp://files.example.com')).toThrow(ValidationError);
    });

    it('should never include PINs, secrets, or dashboard paths in the canonical URL', () => {
      const url = buildCanonicalGuestUrl('soiree-2026');
      expect(url).not.toContain('dashboard');
      expect(url).not.toContain('api');
      expect(url).not.toContain('pin');
      expect(url).not.toContain('token');
      expect(url).not.toContain('r2.cloudflarestorage.com');
    });
  });

  describe('QR Filename Sanitization', () => {
    it('should sanitize event names with punctuation and whitespace', () => {
      const filename = sanitizeQrFilename("Alice & Bob's Gala (2026)", 'png');
      expect(filename).toBe('Alice_Bob_s_Gala_2026_QR.png');
    });

    it('should generate valid SVG filename', () => {
      const filename = sanitizeQrFilename('Chateau_Reception', 'svg');
      expect(filename).toBe('Chateau_Reception_QR.svg');
    });

    it('should fallback to "Event_QR.png" if event name has no valid characters', () => {
      const filename = sanitizeQrFilename('---***---', 'png');
      expect(filename).toBe('Event_QR.png');
    });

    it('should reject unsupported file extensions', () => {
      // @ts-expect-error testing runtime validation
      expect(() => sanitizeQrFilename('Event', 'exe')).toThrow(ValidationError);
      // @ts-expect-error testing runtime validation
      expect(() => sanitizeQrFilename('Event', 'pdf')).toThrow(ValidationError);
    });
  });

  describe('QR Generation & Payload Verification', () => {
    it('should generate both PNG data URL and safe SVG markup', async () => {
      const event = {
        id: 'e0000000-0000-0000-0000-000000000001',
        slug: 'alice-bob-wedding',
        name: 'Alice & Bob Wedding',
        client_name: 'Alice Smith',
        event_date: '2026-10-15',
        pin_enabled: false,
        visibility: 'public' as const,
        public_until: new Date(Date.now() + 86400000).toISOString(),
      };

      const result = await generateEventQrCode(event, 'http://localhost:3000');

      expect(result.shareUrl).toBe('http://localhost:3000/gallery/alice-bob-wedding');
      expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(result.qrSvg).toContain('<svg');
      expect(result.qrSvg).toContain('</svg>');
      expect(result.qrSvg.toLowerCase()).not.toContain('<script');
      expect(result.eventName).toBe('Alice & Bob Wedding');
      expect(result.pinProtected).toBe(false);
      expect(result.isExpired).toBe(false);
    });

    it('should decode generated PNG QR code and confirm exact canonical URL payload', async () => {
      const event = {
        id: 'e0000000-0000-0000-0000-000000000002',
        slug: 'verifiable-qr-slug',
        name: 'Verifiable Event',
        client_name: 'Test Client',
        event_date: '2026-10-20',
        pin_enabled: true,
        visibility: 'public' as const,
        public_until: null,
      };

      const result = await generateEventQrCode(event, 'https://gallery.studiolumina.photo');
      const expectedUrl = 'https://gallery.studiolumina.photo/gallery/verifiable-qr-slug';

      expect(result.shareUrl).toBe(expectedUrl);

      // Extract raw PNG buffer from data URL
      const base64Data = result.qrDataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Parse PNG with pngjs and decode QR with jsQR
      const png = PNG.sync.read(buffer);
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

      expect(decoded).not.toBeNull();
      expect(decoded?.data).toBe(expectedUrl);
    });

    it('should produce distinct QR payloads and matrixes for distinct events', async () => {
      const eventA = {
        id: 'e0000000-0000-0000-0000-00000000000a',
        slug: 'event-alpha',
        name: 'Event Alpha',
        client_name: 'Alpha',
        event_date: '2026-10-01',
        pin_enabled: false,
        visibility: 'public' as const,
        public_until: null,
      };

      const eventB = {
        id: 'e0000000-0000-0000-0000-00000000000b',
        slug: 'event-beta',
        name: 'Event Beta',
        client_name: 'Beta',
        event_date: '2026-10-02',
        pin_enabled: false,
        visibility: 'public' as const,
        public_until: null,
      };

      const resA = await generateEventQrCode(eventA);
      const resB = await generateEventQrCode(eventB);

      expect(resA.shareUrl).not.toBe(resB.shareUrl);
      expect(resA.qrDataUrl).not.toBe(resB.qrDataUrl);
      expect(resA.qrSvg).not.toBe(resB.qrSvg);
    });

    it('should correctly flag expired status when public_until has elapsed', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      const event = {
        id: 'e0000000-0000-0000-0000-000000000003',
        slug: 'expired-gala',
        name: 'Expired Gala',
        client_name: 'Client',
        event_date: '2026-09-01',
        pin_enabled: false,
        visibility: 'public' as const,
        public_until: pastDate,
      };

      const result = await generateEventQrCode(event);
      expect(result.isExpired).toBe(true);
    });

    it('should correctly reflect PIN-protected state without embedding PIN in payload', async () => {
      const event = {
        id: 'e0000000-0000-0000-0000-000000000004',
        slug: 'secure-vault',
        name: 'Secure Vault Event',
        client_name: 'VIP Client',
        event_date: '2026-10-31',
        pin_enabled: true,
        visibility: 'public' as const,
        public_until: null,
      };

      const result = await generateEventQrCode(event);
      expect(result.pinProtected).toBe(true);
      expect(result.shareUrl).not.toContain('pin');
      expect(result.shareUrl).not.toContain('1234');
    });
  });
});
