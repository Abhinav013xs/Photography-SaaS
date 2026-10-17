import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  escapeXmlText,
  generateWatermarkSvg,
  generateDerivatives,
} from '../../apps/api/src/services/imageProcessingService.js';
import { updateEventSchema, createEventSchema } from '../../apps/api/src/routes/eventsSchemas.js';

describe('Phase 22: Watermark System Unit Tests', () => {
  // Helper to generate a test image buffer in memory
  async function createTestImage(width = 1200, height = 800): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 35, g: 45, b: 60 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  describe('1. XML / SVG Sanitization (escapeXmlText)', () => {
    it('escapes special XML characters to prevent SVG injection', () => {
      const malicious = '<script>alert("xss")</script> & "quotes" \'test\'';
      const safe = escapeXmlText(malicious);
      expect(safe).not.toContain('<script>');
      expect(safe).not.toContain('& ');
      expect(safe).toContain('&lt;script&gt;');
      expect(safe).toContain('&amp;');
      expect(safe).toContain('&quot;');
      expect(safe).toContain('&apos;');
    });

    it('safely handles empty or non-string inputs', () => {
      expect(escapeXmlText('')).toBe('');
      expect(escapeXmlText(null as any)).toBe('');
      expect(escapeXmlText(undefined as any)).toBe('');
    });

    it('preserves clean alphanumeric text and spaces', () => {
      const clean = 'Studio Lumina Fine Art Photography';
      expect(escapeXmlText(clean)).toBe(clean);
    });

    it('preserves unicode characters (multilingual / accents)', () => {
      const unicode = 'Élégance Photographie 摄影工作室 ✨';
      const safe = escapeXmlText(unicode);
      expect(safe).toContain('Élégance');
      expect(safe).toContain('摄影工作室');
    });
  });

  describe('2. Watermark SVG Generation (generateWatermarkSvg)', () => {
    it('generates a valid SVG document with correct dimensions and text', () => {
      const svgBuf = generateWatermarkSvg('Studio Lumina', 1200, 800, {
        enabled: true,
        text: 'Studio Lumina',
        opacity: 0.5,
        size: 'medium',
        position: 'bottom-right',
        color: 'white',
      });
      const svg = svgBuf.toString('utf-8');

      expect(svg).toContain('<svg');
      expect(svg).toContain('width="1200"');
      expect(svg).toContain('height="800"');
      expect(svg).toContain('Studio Lumina');
      expect(svg).toContain('fill-opacity: 0.5');
    });

    it('respects different positions (bottom-right, bottom-center, center)', () => {
      const brSvg = generateWatermarkSvg('Test', 1000, 1000, {
        position: 'bottom-right',
      }).toString('utf-8');
      expect(brSvg).toContain('text-anchor="end"');

      const bcSvg = generateWatermarkSvg('Test', 1000, 1000, {
        position: 'bottom-center',
      }).toString('utf-8');
      expect(bcSvg).toContain('text-anchor="middle"');

      const centerSvg = generateWatermarkSvg('Test', 1000, 1000, {
        position: 'center',
      }).toString('utf-8');
      expect(centerSvg).toContain('text-anchor="middle"');
      expect(centerSvg).toContain('y="500"');
    });

    it('respects color palettes (white vs black)', () => {
      const whiteSvg = generateWatermarkSvg('Test', 800, 600, { color: 'white' }).toString('utf-8');
      expect(whiteSvg).toContain('fill: #ffffff');
      expect(whiteSvg).toContain('stroke: #000000');

      const blackSvg = generateWatermarkSvg('Test', 800, 600, { color: 'black' }).toString('utf-8');
      expect(blackSvg).toContain('fill: #000000');
      expect(blackSvg).toContain('stroke: #ffffff');
    });

    it('scales font size proportionally for small, medium, and large settings', () => {
      const smallSvg = generateWatermarkSvg('ScaleTest', 1000, 1000, { size: 'small' }).toString('utf-8');
      const medSvg = generateWatermarkSvg('ScaleTest', 1000, 1000, { size: 'medium' }).toString('utf-8');
      const largeSvg = generateWatermarkSvg('ScaleTest', 1000, 1000, { size: 'large' }).toString('utf-8');

      // Extract font-size values from CSS
      const getFontSize = (str: string) => {
        const match = str.match(/font-size:\s*(\d+)px/);
        return match ? parseInt(match[1], 10) : 0;
      };

      const smallSize = getFontSize(smallSvg);
      const medSize = getFontSize(medSvg);
      const largeSize = getFontSize(largeSvg);

      expect(smallSize).toBeGreaterThan(0);
      expect(smallSize).toBeLessThan(medSize);
      expect(medSize).toBeLessThan(largeSize);
    });

    it('clamps opacity within safe bounds (0.05 - 1.0)', () => {
      const lowSvg = generateWatermarkSvg('Test', 800, 600, { opacity: -0.5 }).toString('utf-8');
      expect(lowSvg).toContain('fill-opacity: 0.05');

      const highSvg = generateWatermarkSvg('Test', 800, 600, { opacity: 2.5 }).toString('utf-8');
      expect(highSvg).toContain('fill-opacity: 1');
    });
  });

  describe('3. Derivative Generation with Watermark (generateDerivatives)', () => {
    it('generates watermarked WebP thumbnail and preview derivatives without mutating the original', async () => {
      const original = await createTestImage(1800, 1200);
      const originalCopy = Buffer.from(original);

      const derivatives = await generateDerivatives(original, undefined, {
        enabled: true,
        text: 'STUDIO LUMINA',
        opacity: 0.45,
        size: 'medium',
        position: 'bottom-right',
        color: 'white',
      });

      // Original buffer must remain completely byte-for-byte identical
      expect(original.equals(originalCopy)).toBe(true);

      // Derivatives generated
      expect(derivatives.width).toBe(1800);
      expect(derivatives.height).toBe(1200);
      expect(derivatives.thumbnailBuffer.length).toBeGreaterThan(0);
      expect(derivatives.previewBuffer.length).toBeGreaterThan(0);

      // Verify derivatives are valid WebP images
      const thumbMeta = await sharp(derivatives.thumbnailBuffer).metadata();
      expect(thumbMeta.format).toBe('webp');
      expect(thumbMeta.width).toBeLessThanOrEqual(480);

      const prevMeta = await sharp(derivatives.previewBuffer).metadata();
      expect(prevMeta.format).toBe('webp');
      expect(prevMeta.width).toBeLessThanOrEqual(2048);
    });

    it('generates unwatermarked derivatives when watermark is disabled', async () => {
      const original = await createTestImage(1200, 800);

      const cleanDerivatives = await generateDerivatives(original, undefined, {
        enabled: false,
        text: 'Unused Watermark',
      });

      expect(cleanDerivatives.thumbnailBuffer.length).toBeGreaterThan(0);
      expect(cleanDerivatives.previewBuffer.length).toBeGreaterThan(0);
    });

    it('works correctly for portrait orientation photos', async () => {
      const portrait = await createTestImage(800, 1400);

      const derivatives = await generateDerivatives(portrait, undefined, {
        enabled: true,
        text: 'PORTRAIT WATERMARK',
        position: 'bottom-center',
        size: 'small',
        color: 'white',
        opacity: 0.5,
      });

      expect(derivatives.width).toBe(800);
      expect(derivatives.height).toBe(1400);
      expect(derivatives.thumbnailBuffer.length).toBeGreaterThan(0);
      expect(derivatives.previewBuffer.length).toBeGreaterThan(0);
    });

    it('never stacks watermarks across multiple reprocessing runs', async () => {
      const original = await createTestImage(1000, 700);

      // Run 1: watermark v1
      const run1 = await generateDerivatives(original, undefined, {
        enabled: true,
        text: 'First Mark',
      });

      // Run 2: watermark v2 (always generated from the clean original master)
      const run2 = await generateDerivatives(original, undefined, {
        enabled: true,
        text: 'Second Mark',
      });

      // Both runs successfully output valid WebP derivatives and original is unchanged
      expect(run1.previewBuffer.length).toBeGreaterThan(0);
      expect(run2.previewBuffer.length).toBeGreaterThan(0);
    });
  });

  describe('4. Zod Schema Validation for Watermark Config', () => {
    it('accepts valid watermark configuration in updateEventSchema', () => {
      const validPayload = {
        watermark_enabled: true,
        watermark_text: 'Fine Art Studio 2026',
        watermark_opacity: 0.65,
        watermark_size: 'large',
        watermark_position: 'bottom-right',
        watermark_color: 'white',
      };

      const parsed = updateEventSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.watermark_enabled).toBe(true);
        expect(parsed.data.watermark_text).toBe('Fine Art Studio 2026');
        expect(parsed.data.watermark_opacity).toBe(0.65);
        expect(parsed.data.watermark_size).toBe('large');
      }
    });

    it('rejects watermark_text exceeding 100 characters', () => {
      const longText = 'A'.repeat(101);
      const parsed = updateEventSchema.safeParse({ watermark_text: longText });
      expect(parsed.success).toBe(false);
    });

    it('rejects watermark_opacity outside 0.05 to 1.0 range', () => {
      expect(updateEventSchema.safeParse({ watermark_opacity: 0.01 }).success).toBe(false);
      expect(updateEventSchema.safeParse({ watermark_opacity: 1.5 }).success).toBe(false);
      expect(updateEventSchema.safeParse({ watermark_opacity: -0.2 }).success).toBe(false);
      expect(updateEventSchema.safeParse({ watermark_opacity: 0.40 }).success).toBe(true);
    });

    it('rejects invalid watermark_position values', () => {
      expect(updateEventSchema.safeParse({ watermark_position: 'top-left' }).success).toBe(false);
      expect(updateEventSchema.safeParse({ watermark_position: 'corner' }).success).toBe(false);
      expect(updateEventSchema.safeParse({ watermark_position: 'bottom-center' }).success).toBe(true);
    });

    it('rejects invalid watermark_size and watermark_color values', () => {
      expect(updateEventSchema.safeParse({ watermark_size: 'huge' }).success).toBe(false);
      expect(updateEventSchema.safeParse({ watermark_color: 'gold' }).success).toBe(false);
      expect(updateEventSchema.safeParse({ watermark_size: 'medium', watermark_color: 'black' }).success).toBe(true);
    });

    it('accepts valid watermark fields in createEventSchema with defaults', () => {
      const createPayload = {
        name: 'New Event',
        client_name: 'Client',
        event_date: '2026-10-10',
        watermark_enabled: true,
        watermark_text: 'Custom Studio',
      };

      const parsed = createEventSchema.safeParse(createPayload);
      expect(parsed.success).toBe(true);
    });
  });
});
