import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { validateSelfieBuffer } from '../../apps/api/src/utils/selfieValidation.js';
import { validateQueryEmbeddingVector, DEFAULT_COSINE_DISTANCE_THRESHOLD } from '../../apps/api/src/services/faceSearchService.js';
import {
  InvalidSelfieError,
  DecompressionBombError,
  NoFaceDetectedError,
  MultipleFacesDetectedError,
} from '@photography-saas/errors';

describe('Phase 16: AI Face Search Unit Tests', () => {
  describe('Selfie Buffer & Magic Bytes Validation (validateSelfieBuffer)', () => {
    it('accepts a valid JPEG image buffer', async () => {
      const jpegBuffer = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 200, g: 150, b: 100 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await validateSelfieBuffer(jpegBuffer);
      expect(result.format).toBe('jpeg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
      expect(result.sizeBytes).toBe(jpegBuffer.length);
    });

    it('accepts a valid PNG image buffer', async () => {
      const pngBuffer = await sharp({
        create: {
          width: 150,
          height: 150,
          channels: 3,
          background: { r: 100, g: 100, b: 250 },
        },
      })
        .png()
        .toBuffer();

      const result = await validateSelfieBuffer(pngBuffer);
      expect(result.format).toBe('png');
      expect(result.mimeType).toBe('image/png');
      expect(result.width).toBe(150);
      expect(result.height).toBe(150);
    });

    it('accepts a valid WebP image buffer', async () => {
      const webpBuffer = await sharp({
        create: {
          width: 180,
          height: 180,
          channels: 3,
          background: { r: 50, g: 200, b: 150 },
        },
      })
        .webp()
        .toBuffer();

      const result = await validateSelfieBuffer(webpBuffer);
      expect(result.format).toBe('webp');
      expect(result.mimeType).toBe('image/webp');
      expect(result.width).toBe(180);
      expect(result.height).toBe(180);
    });

    it('strictly rejects SVG text content disguised as image', async () => {
      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>');
      await expect(validateSelfieBuffer(svgBuffer)).rejects.toThrow(InvalidSelfieError);
    });

    it('strictly rejects HTML and script payloads', async () => {
      const htmlBuffer = Buffer.from('<!DOCTYPE html><html><body><script>alert("hack")</script></body></html>');
      await expect(validateSelfieBuffer(htmlBuffer)).rejects.toThrow(InvalidSelfieError);
    });

    it('strictly rejects arbitrary binary/executable signatures', async () => {
      const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00');
      await expect(validateSelfieBuffer(exeBuffer)).rejects.toThrow(InvalidSelfieError);
    });

    it('rejects oversized files exceeding 10 MB limit', async () => {
      // 10.5 MB buffer
      const oversizedBuffer = Buffer.alloc(10.5 * 1024 * 1024, 0xff);
      await expect(validateSelfieBuffer(oversizedBuffer)).rejects.toThrow(InvalidSelfieError);
    });

    it('rejects empty or excessively tiny buffers', async () => {
      const tinyBuffer = Buffer.from([0xff, 0xd8]);
      await expect(validateSelfieBuffer(tinyBuffer)).rejects.toThrow(InvalidSelfieError);
      await expect(validateSelfieBuffer(Buffer.alloc(0))).rejects.toThrow(InvalidSelfieError);
    });

    it('rejects decompression bomb images exceeding 25 megapixels', async () => {
      // Create high-dimension image metadata
      const hugeBuffer = await sharp({
        create: {
          width: 5100,
          height: 5100, // 26 Megapixels > 25MP limit
          channels: 3,
          background: { r: 10, g: 10, b: 10 },
        },
      })
        .jpeg({ quality: 10 })
        .toBuffer();

      await expect(validateSelfieBuffer(hugeBuffer)).rejects.toThrow(DecompressionBombError);
    });
  });

  describe('Query Embedding Vector Validation (validateQueryEmbeddingVector)', () => {
    it('accepts valid 128-D unit-normalized vector', () => {
      const raw = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1));
      const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
      const validVector = raw.map(v => v / norm);

      expect(() => validateQueryEmbeddingVector(validVector)).not.toThrow();
    });

    it('rejects vector with incorrect dimensions (not 128-D)', () => {
      const shortVector = [0.1, 0.2, 0.3];
      expect(() => validateQueryEmbeddingVector(shortVector)).toThrow(
        /Invalid face embedding vector dimension/
      );

      const longVector = Array.from({ length: 256 }, () => 0.1);
      expect(() => validateQueryEmbeddingVector(longVector)).toThrow(
        /Invalid face embedding vector dimension/
      );
    });

    it('rejects vector containing NaN or non-finite values', () => {
      const clean = Array.from({ length: 128 }, () => 1 / Math.sqrt(128));
      const nanVec = [...clean.slice(0, 127), NaN];
      const infVec = [...clean.slice(0, 127), Infinity];

      expect(() => validateQueryEmbeddingVector(nanVec)).toThrow(
        /Query embedding contains non-finite value/
      );
      expect(() => validateQueryEmbeddingVector(infVec)).toThrow(
        /Query embedding contains non-finite value/
      );
    });

    it('rejects unnormalized vector whose norm deviates significantly from 1.0', () => {
      // Norm of 10.0
      const unnormalizedVec = Array.from({ length: 128 }, () => 10 / Math.sqrt(128));
      expect(() => validateQueryEmbeddingVector(unnormalizedVec)).toThrow(
        /Query embedding is not properly unit-normalized/
      );
    });
  });

  describe('Distance Threshold & Match Score Math', () => {
    it('verifies calibrated default threshold reflects SFace FAR 0.001 benchmark', () => {
      expect(DEFAULT_COSINE_DISTANCE_THRESHOLD).toBe(0.363);
      // Cosine similarity at threshold
      const similarityAtThreshold = 1 - DEFAULT_COSINE_DISTANCE_THRESHOLD;
      expect(similarityAtThreshold).toBeCloseTo(0.637, 3);
    });

    it('correctly maps cosine distance to similarity score in [0, 1] range', () => {
      const distToSimilarity = (dist: number) =>
        Math.max(0, Math.min(1, Number((1 - dist).toFixed(4))));

      expect(distToSimilarity(0.0)).toBe(1.0); // Exact match
      expect(distToSimilarity(0.2)).toBe(0.8);
      expect(distToSimilarity(0.363)).toBe(0.637);
      expect(distToSimilarity(1.0)).toBe(0.0); // Orthogonal
      expect(distToSimilarity(1.5)).toBe(0.0); // Bounded at 0
    });
  });

  describe('Face Count Policy Error Semantics', () => {
    it('constructs NoFaceDetectedError with HTTP 422 and distinct code', () => {
      const err = new NoFaceDetectedError();
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('NO_FACE_DETECTED');
      expect(err.message).toContain('No face detected');
    });

    it('constructs MultipleFacesDetectedError with HTTP 422 and distinct code', () => {
      const err = new MultipleFacesDetectedError();
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('MULTIPLE_FACES_DETECTED');
      expect(err.message).toContain('Multiple faces detected');
    });
  });
});
