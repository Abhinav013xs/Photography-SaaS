import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import storage from '../storage/r2.js';

/**
 * Creates SVG watermark overlay
 */
function createWatermarkSvg(text, width, height) {
  // Elegant editorial watermark
  const safeText = (text || 'Studio Lumina')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  const fontSize = Math.max(16, Math.round(width * 0.025));
  const paddingX = Math.round(fontSize * 1.5);
  const paddingY = Math.round(fontSize * 1.5);

  return Buffer.from(`
    <svg width="${width}" height="${height}">
      <style>
        .watermark-text {
          fill: rgba(255, 255, 255, 0.45);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
          font-size: ${fontSize}px;
          font-weight: 500;
          letter-spacing: 0.15em;
          text-anchor: end;
          filter: drop-shadow(0px 1px 2px rgba(0,0,0,0.7));
        }
      </style>
      <text x="${width - paddingX}" y="${height - paddingY}" class="watermark-text">
        ${safeText.toUpperCase()}
      </text>
    </svg>
  `);
}

/**
 * Process a photo:
 * 1. Parse EXIF & dimensions
 * 2. Save original
 * 3. Generate thumbnail (max 400px WebP)
 * 4. Generate preview (max 1600px WebP, watermarked if configured)
 */
export async function processPhoto(filePath, eventId, filename, watermarkConfig = { enabled: false, text: 'Studio Lumina' }) {
  // Enforce 50MP ceiling to guard against decompression bombs
  const image = sharp(filePath, { limitInputPixels: 50_000_000 });
  const metadata = await image.metadata();

  const width = metadata.width || 0;
  const height = metadata.height || 0;

  // Extract EXIF data if available
  let cameraMake = null;
  let cameraModel = null;
  let dateTaken = null;

  if (metadata.exif) {
    try {
      const parsedExif = await image.metadata();
      // Sharp handles orientation auto-rotation
    } catch (e) {
      // EXIF parse error safe ignore
    }
  }

  // 1. Upload/store original
  const ext = path.extname(filename).toLowerCase();
  const baseName = path.basename(filename, ext);
  const originalKey = storage.getKey(eventId, 'originals', `${baseName}${ext}`);
  await storage.putObject(originalKey, filePath, `image/${ext.replace('.', '') || 'jpeg'}`);

  // 2. Generate Thumbnail (max 400px width/height, WebP, quality 80)
  const thumbBuffer = await sharp(filePath, { limitInputPixels: 50_000_000 })
    .rotate() // Auto-orient based on EXIF
    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const thumbKey = storage.getKey(eventId, 'thumbnails', `${baseName}.webp`);
  await storage.putObject(thumbKey, thumbBuffer, 'image/webp');

  // 3. Generate Preview (max 1600px width/height, WebP, quality 85)
  let previewPipeline = sharp(filePath, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true });

  if (watermarkConfig.enabled) {
    // Determine preview dimensions for watermark placement
    const previewMeta = await previewPipeline.metadata();
    const pWidth = previewMeta.width || 1200;
    const pHeight = previewMeta.height || 800;
    const watermarkSvg = createWatermarkSvg(watermarkConfig.text, pWidth, pHeight);

    previewPipeline = previewPipeline.composite([
      { input: watermarkSvg, top: 0, left: 0 }
    ]);
  }

  const previewBuffer = await previewPipeline.webp({ quality: 85 }).toBuffer();
  const previewKey = storage.getKey(eventId, 'previews', `${baseName}.webp`);
  await storage.putObject(previewKey, previewBuffer, 'image/webp');

  return {
    width,
    height,
    storageKeyOriginal: originalKey,
    storageKeyPreview: previewKey,
    storageKeyThumbnail: thumbKey,
    cameraMake,
    cameraModel,
    dateTaken,
  };
}

/**
 * Process a video:
 * 1. Save original to storage
 * 2. Generate placeholder poster
 */
export async function processVideo(filePath, eventId, filename) {
  const ext = path.extname(filename).toLowerCase();
  const baseName = path.basename(filename, ext);
  const videoKey = storage.getKey(eventId, 'videos', `${baseName}${ext}`);
  
  await storage.putObject(videoKey, filePath, 'video/mp4');

  // Create an elegant video poster thumbnail placeholder using Sharp
  const posterSvg = Buffer.from(`
    <svg width="600" height="400" viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
      <rect width="600" height="400" fill="#141414"/>
      <circle cx="300" cy="200" r="44" fill="rgba(255,255,255,0.15)"/>
      <polygon points="290,180 320,200 290,220" fill="#ffffff"/>
      <text x="300" y="270" font-family="-apple-system, sans-serif" font-size="14" font-weight="500" fill="#a0a0a0" text-anchor="middle" letter-spacing="0.1em">VIDEO ASSET</text>
    </svg>
  `);

  const posterBuffer = await sharp(posterSvg).webp({ quality: 80 }).toBuffer();
  const thumbKey = storage.getKey(eventId, 'thumbnails', `${baseName}_poster.webp`);
  await storage.putObject(thumbKey, posterBuffer, 'image/webp');

  return {
    storageKeyOriginal: videoKey,
    storageKeyPreview: videoKey,
    storageKeyThumbnail: thumbKey,
    duration: 0,
  };
}
