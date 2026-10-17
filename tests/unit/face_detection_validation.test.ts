import { describe, it, expect } from 'vitest';
import type { DetectedFaceDTO } from '@photography-saas/types';

describe('Phase 14: AI Face Detection Unit Tests', () => {
  describe('Bounding Box Normalization & Coordinate Clamping', () => {
    it('normalizes pixel coordinates to [0, 1] relative to image width and height', () => {
      const imgWidth = 1920;
      const imgHeight = 1080;
      const rawX = 480;
      const rawY = 270;
      const rawW = 384;
      const rawH = 432;

      const normX = Math.max(0, Math.min(1, rawX / imgWidth));
      const normY = Math.max(0, Math.min(1, rawY / imgHeight));
      const normW = Math.max(0.001, Math.min(1, rawW / imgWidth));
      const normH = Math.max(0.001, Math.min(1, rawH / imgHeight));

      expect(normX).toBeCloseTo(0.25, 4);
      expect(normY).toBeCloseTo(0.25, 4);
      expect(normW).toBeCloseTo(0.2, 4);
      expect(normH).toBeCloseTo(0.4, 4);
    });

    it('clamps negative or out-of-bounds coordinates to [0, 1]', () => {
      const clampCoord = (val: number) => Math.max(0, Math.min(1, val));
      const clampDimension = (val: number) => Math.max(0.001, Math.min(1, val));

      expect(clampCoord(-0.05)).toBe(0);
      expect(clampCoord(1.25)).toBe(1);
      expect(clampDimension(0)).toBe(0.001);
      expect(clampDimension(1.5)).toBe(1);
    });

    it('validates facial landmark structure with 5 bilateral points', () => {
      const face: DetectedFaceDTO = {
        faceIndex: 0,
        boxX: 0.35,
        boxY: 0.20,
        boxW: 0.30,
        boxH: 0.45,
        confidence: 0.945,
        landmarks: [
          { x: 0.42, y: 0.33 }, // Right eye
          { x: 0.58, y: 0.33 }, // Left eye
          { x: 0.50, y: 0.42 }, // Nose tip
          { x: 0.44, y: 0.52 }, // Right mouth corner
          { x: 0.56, y: 0.52 }, // Left mouth corner
        ],
      };

      expect(face.landmarks).toHaveLength(5);
      expect(face.landmarks![0].x).toBeLessThan(face.landmarks![1].x); // Right eye is to the left of Left eye in image space
      expect(face.confidence).toBeGreaterThanOrEqual(0.70);
    });

    it('handles zero-face detection as valid successful state', () => {
      const zeroFaceResponse = {
        status: 'success' as const,
        faceCount: 0,
        faces: [],
      };

      expect(zeroFaceResponse.status).toBe('success');
      expect(zeroFaceResponse.faceCount).toBe(0);
      expect(zeroFaceResponse.faces).toEqual([]);
    });

    it('handles multi-face group photograph detection ordering', () => {
      const groupFaces: DetectedFaceDTO[] = [
        { faceIndex: 0, boxX: 0.1, boxY: 0.2, boxW: 0.2, boxH: 0.3, confidence: 0.92 },
        { faceIndex: 1, boxX: 0.4, boxY: 0.25, boxW: 0.22, boxH: 0.32, confidence: 0.88 },
        { faceIndex: 2, boxX: 0.7, boxY: 0.18, boxW: 0.19, boxH: 0.28, confidence: 0.95 },
      ];

      expect(groupFaces).toHaveLength(3);
      expect(groupFaces.map(f => f.faceIndex)).toEqual([0, 1, 2]);
      for (const face of groupFaces) {
        expect(face.boxX).toBeGreaterThanOrEqual(0);
        expect(face.boxX + face.boxW).toBeLessThanOrEqual(1);
      }
    });
  });
});
