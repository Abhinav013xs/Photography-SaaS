import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  validateImageMagicBytes,
  generateDerivatives,
  IMAGE_PROCESSING_CONFIG,
} from '../../apps/api/src/services/imageProcessingService.js';
import {
  CorruptImageError,
  DecompressionBombError,
} from '@photography-saas/errors';

describe('Phase 11: Image Transformation & Security Unit Tests', () => {
  // Helper to generate a valid test JPEG image in memory
  async function createTestJpeg(width = 800, height = 600): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 218, g: 165, b: 32 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  // Helper to generate a valid test PNG image in memory
  async function createTestPng(width = 1200, height = 800): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 50, g: 100, b: 150, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  }

  // Helper to generate a valid test WebP image in memory
  async function createTestWebp(width = 640, height = 480): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 10, g: 11, b: 13 },
      },
    })
      .webp({ quality: 85 })
      .toBuffer();
  }

  describe('1. Magic Bytes Validation (validateImageMagicBytes)', () => {
    it('detects and approves valid JPEG magic bytes', async () => {
      const jpegBuffer = await createTestJpeg(100, 100);
      expect(validateImageMagicBytes(jpegBuffer)).toBe('jpeg');
    });

    it('detects and approves valid PNG magic bytes', async () => {
      const pngBuffer = await createTestPng(100, 100);
      expect(validateImageMagicBytes(pngBuffer)).toBe('png');
    });

    it('detects and approves valid WebP magic bytes', async () => {
      const webpBuffer = await createTestWebp(100, 100);
      expect(validateImageMagicBytes(webpBuffer)).toBe('webp');
    });

    it('rejects corrupt or arbitrary non-image text file disguised as image', () => {
      const textBuffer = Buffer.from('<?php echo "malicious"; ?>', 'utf-8');
      expect(() => validateImageMagicBytes(textBuffer)).toThrow(CorruptImageError);
    });

    it('rejects empty or very short buffers', () => {
      const tinyBuffer = Buffer.from([0x01, 0x02]);
      expect(() => validateImageMagicBytes(tinyBuffer)).toThrow(CorruptImageError);
    });

    it('rejects unsupported image format signatures (e.g. BMP/TIFF)', () => {
      // BMP magic bytes 'BM' (0x42, 0x4D)
      const bmpHeader = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(() => validateImageMagicBytes(bmpHeader)).toThrow(CorruptImageError);
    });
  });

  describe('2. Derivative Generation (generateDerivatives)', () => {
    it('transforms valid JPEG into thumbnail and preview WebP derivatives', async () => {
      const jpegBuffer = await createTestJpeg(2400, 1600);
      const originalCopy = Buffer.from(jpegBuffer);

      const result = await generateDerivatives(jpegBuffer);

      expect(result.width).toBe(2400);
      expect(result.height).toBe(1600);
      expect(result.thumbnailBuffer.length).toBeGreaterThan(0);
      expect(result.previewBuffer.length).toBeGreaterThan(0);

      // Verify original buffer was not mutated
      expect(jpegBuffer.equals(originalCopy)).toBe(true);

      // Inspect thumbnail derivative metadata
      const thumbMeta = await sharp(result.thumbnailBuffer).metadata();
      expect(thumbMeta.format).toBe('webp');
      expect(thumbMeta.width).toBeLessThanOrEqual(IMAGE_PROCESSING_CONFIG.thumbnail.maxWidth);
      expect(thumbMeta.height).toBeLessThanOrEqual(IMAGE_PROCESSING_CONFIG.thumbnail.maxHeight);

      // Inspect preview derivative metadata
      const previewMeta = await sharp(result.previewBuffer).metadata();
      expect(previewMeta.format).toBe('webp');
      expect(previewMeta.width).toBeLessThanOrEqual(IMAGE_PROCESSING_CONFIG.preview.maxWidth);
      expect(previewMeta.height).toBeLessThanOrEqual(IMAGE_PROCESSING_CONFIG.preview.maxHeight);
    });

    it('transforms valid PNG into optimized WebP derivatives', async () => {
      const pngBuffer = await createTestPng(1600, 1200);
      const result = await generateDerivatives(pngBuffer);

      const thumbMeta = await sharp(result.thumbnailBuffer).metadata();
      expect(thumbMeta.format).toBe('webp');
      const previewMeta = await sharp(result.previewBuffer).metadata();
      expect(previewMeta.format).toBe('webp');
    });

    it('transforms valid WebP input into optimized derivatives', async () => {
      const webpBuffer = await createTestWebp(1000, 800);
      const result = await generateDerivatives(webpBuffer);

      const thumbMeta = await sharp(result.thumbnailBuffer).metadata();
      expect(thumbMeta.format).toBe('webp');
      const previewMeta = await sharp(result.previewBuffer).metadata();
      expect(previewMeta.format).toBe('webp');
    });

    it('preserves aspect ratio accurately', async () => {
      // 3:1 aspect ratio banner (3000 x 1000)
      const wideBuffer = await createTestJpeg(3000, 1000);
      const result = await generateDerivatives(wideBuffer);

      const thumbMeta = await sharp(result.thumbnailBuffer).metadata();
      // thumbnail max is 480x480. For 3:1 aspect ratio, width should be 480, height should be 160
      expect(thumbMeta.width).toBe(480);
      expect(thumbMeta.height).toBe(160);

      const previewMeta = await sharp(result.previewBuffer).metadata();
      // preview max is 1920x1920. For 3:1 aspect ratio, width should be 1920, height should be 640
      expect(previewMeta.width).toBe(1920);
      expect(previewMeta.height).toBe(640);
    });

    it('does not enlarge smaller images (withoutEnlargement)', async () => {
      // Small image (200x150)
      const smallBuffer = await createTestJpeg(200, 150);
      const result = await generateDerivatives(smallBuffer);

      const thumbMeta = await sharp(result.thumbnailBuffer).metadata();
      expect(thumbMeta.width).toBe(200);
      expect(thumbMeta.height).toBe(150);

      const previewMeta = await sharp(result.previewBuffer).metadata();
      expect(previewMeta.width).toBe(200);
      expect(previewMeta.height).toBe(150);
    });

    it('handles image orientation normalization consistently', async () => {
      // Generate image with EXIF orientation tag 6 (90 degrees rotate)
      const orientedBuffer = await sharp({
        create: {
          width: 400,
          height: 200,
          channels: 3,
          background: { r: 100, g: 150, b: 200 },
        },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();

      const result = await generateDerivatives(orientedBuffer);
      const thumbMeta = await sharp(result.thumbnailBuffer).metadata();
      // Auto-rotated orientation 6 flips width and height
      expect(thumbMeta.width).toBe(200);
      expect(thumbMeta.height).toBe(400);
    });
  });

  describe('3. Resource & Decompression Bomb Security Guards', () => {
    it('rejects images exceeding max pixel count with DecompressionBombError', async () => {
      const buffer = await createTestJpeg(600, 400); // 240,000 pixels

      // Configure a strict maxPixels threshold lower than the image pixels
      const strictConfig = {
        ...IMAGE_PROCESSING_CONFIG,
        maxPixels: 100_000,
      };

      await expect(generateDerivatives(buffer, strictConfig)).rejects.toThrow(
        DecompressionBombError
      );
    });

    it('fails safely with CorruptImageError on corrupted truncated image data', async () => {
      const validBuffer = await createTestJpeg(500, 500);
      // Truncate to make header valid but stream corrupt
      const truncatedBuffer = validBuffer.subarray(0, 50);

      await expect(generateDerivatives(truncatedBuffer)).rejects.toThrow(CorruptImageError);
    });
  });
});
