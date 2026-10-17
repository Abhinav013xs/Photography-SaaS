import sharp from 'sharp';
import {
  InvalidSelfieError,
  DecompressionBombError,
  CorruptImageError,
} from '@photography-saas/errors';

export interface ValidatedSelfieInfo {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  format: 'jpeg' | 'png' | 'webp';
  width: number;
  height: number;
  sizeBytes: number;
}

const MAX_SELFIE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MIN_SELFIE_SIZE_BYTES = 100; // 100 bytes minimum
const MAX_SELFIE_PIXELS = 25_000_000; // 25 Megapixels (e.g., 5000 x 5000)

/**
 * Validates untrusted query selfie binary buffer:
 * - Checks buffer length bounds.
 * - Inspects magic bytes (JPEG, PNG, WebP only; rejects SVG, HTML, Executables).
 * - Decodes image metadata via Sharp to check dimensions and pixel limits.
 */
export async function validateSelfieBuffer(buffer: Buffer): Promise<ValidatedSelfieInfo> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new InvalidSelfieError('Selfie payload is empty or not a valid binary buffer');
  }

  if (buffer.length < MIN_SELFIE_SIZE_BYTES) {
    throw new InvalidSelfieError('Selfie image file is too small to be a valid photo');
  }

  if (buffer.length > MAX_SELFIE_SIZE_BYTES) {
    throw new InvalidSelfieError(
      `Selfie file size (${(buffer.length / (1024 * 1024)).toFixed(1)} MB) exceeds 10 MB limit`
    );
  }

  // 1. Magic bytes validation
  let detectedMime: ValidatedSelfieInfo['mimeType'] | null = null;
  let detectedFormat: ValidatedSelfieInfo['format'] | null = null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    detectedMime = 'image/jpeg';
    detectedFormat = 'jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  else if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    detectedMime = 'image/png';
    detectedFormat = 'png';
  }
  // WebP: RIFF ... WEBP
  else if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    detectedMime = 'image/webp';
    detectedFormat = 'webp';
  }

  if (!detectedMime || !detectedFormat) {
    throw new InvalidSelfieError(
      'Unsupported selfie image format. Only JPEG, PNG, and WebP are accepted. SVG and other formats are strictly rejected.'
    );
  }

  // 2. Metadata & pixel count verification via Sharp
  try {
    const metadata = await sharp(buffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new CorruptImageError('Selfie image dimensions could not be decoded.');
    }

    const pixels = metadata.width * metadata.height;
    if (pixels > MAX_SELFIE_PIXELS) {
      throw new DecompressionBombError(
        `Selfie dimensions (${metadata.width}x${metadata.height}) exceed maximum allowed ceiling of 25 megapixels.`
      );
    }

    return {
      mimeType: detectedMime,
      format: detectedFormat,
      width: metadata.width,
      height: metadata.height,
      sizeBytes: buffer.length,
    };
  } catch (error) {
    if (error instanceof DecompressionBombError || error instanceof InvalidSelfieError) {
      throw error;
    }
    throw new CorruptImageError(
      `Corrupt or unreadable selfie image: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
