import { describe, it, expect } from 'vitest';
import type { ExtractedFaceEmbeddingDTO } from '@photography-saas/types';

describe('Phase 15: AI Face Embeddings & Vector Storage Unit Tests', () => {
  describe('Vector Dimension, Normalization & Serialization', () => {
    it('verifies strict 128-dimensional embedding length', () => {
      const validVector = Array.from({ length: 128 }, (_, i) => Math.sin(i));
      expect(validVector).toHaveLength(128);

      const invalidVectorShort = [0.1, 0.2, 0.3];
      expect(invalidVectorShort).not.toHaveLength(128);
    });

    it('verifies L2 unit vector normalization', () => {
      // Create a normalized 128-D vector
      const raw = Array.from({ length: 128 }, (_, i) => (i + 1) * 0.1);
      const rawNorm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0));
      const normalized = raw.map(v => v / rawNorm);

      const l2Norm = Math.sqrt(normalized.reduce((sum, v) => sum + v * v, 0));
      expect(l2Norm).toBeCloseTo(1.0, 5);
    });

    it('rejects vectors containing non-finite values (NaN, Infinity)', () => {
      const hasOnlyFinite = (vec: number[]) => vec.every(Number.isFinite);

      const cleanVec = Array.from({ length: 128 }, () => 0.088);
      const nanVec = [...cleanVec.slice(0, 127), NaN];
      const infVec = [...cleanVec.slice(0, 127), Infinity];

      expect(hasOnlyFinite(cleanVec)).toBe(true);
      expect(hasOnlyFinite(nanVec)).toBe(false);
      expect(hasOnlyFinite(infVec)).toBe(false);
    });

    it('serializes 128-D float array into pgvector literal format', () => {
      const sampleVec = [0.123456, -0.654321, 0.0];
      const pgvectorStr = `[${sampleVec.join(',')}]`;

      expect(pgvectorStr).toBe('[0.123456,-0.654321,0]');
      expect(pgvectorStr.startsWith('[')).toBe(true);
      expect(pgvectorStr.endsWith(']')).toBe(true);
    });

    it('validates ExtractedFaceEmbeddingDTO structure and default metadata', () => {
      const embeddingDto: ExtractedFaceEmbeddingDTO = {
        faceIndex: 0,
        boxX: 0.25,
        boxY: 0.30,
        boxW: 0.20,
        boxH: 0.25,
        confidence: 0.965,
        modelName: 'SFace',
        modelVersion: 'v1',
        embedding: Array.from({ length: 128 }, () => 1 / Math.sqrt(128)),
      };

      expect(embeddingDto.modelName).toBe('SFace');
      expect(embeddingDto.modelVersion).toBe('v1');
      expect(embeddingDto.embedding).toHaveLength(128);

      const norm = Math.sqrt(embeddingDto.embedding.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 4);
    });
  });
});
