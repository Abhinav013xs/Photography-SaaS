/**
 * ===================================================================
 * STUDIO LUMINA — PHASE 35: PERFORMANCE & SCALABILITY INTEGRATION TESTS
 * ===================================================================
 * Verifies system performance contracts, vector memory invariants,
 * upload throughput, R2 cost formulas, and failure resilience.
 */

import { describe, it, expect } from 'vitest';
import { runUploadBenchmark } from '../performance/upload_benchmark.js';
import { runVectorDatabaseBenchmark } from '../performance/vector_database_benchmark.js';
import { runFaceSearchBenchmark } from '../performance/face_search_benchmark.js';
import {
  generateDerivatives,
  IMAGE_PROCESSING_CONFIG,
} from '../../apps/api/src/services/imageProcessingService.js';
import sharp from 'sharp';

describe('Phase 35: Real-World Performance, Scalability & Cost Invariants', () => {
  it('1. Direct R2 upload presigning processes 100+ items with sub-millisecond per-item latency', () => {
    const metrics = runUploadBenchmark();
    const direct100 = metrics.find((m) => m.batchSize === 100 && m.architecture === 'DIRECT_R2_PRESIGNED');
    expect(direct100).toBeDefined();
    expect(direct100!.throughputOpsPerSec).toBeGreaterThan(2_500);
    expect(direct100!.p50Ms).toBeLessThan(1.0); // Sub-millisecond
    expect(direct100!.errorRatePercent).toBe(0);
  });

  it('2. Sharp derivative generation scales predictably and adheres to max pixel ceilings', async () => {
    const samplePhoto = await sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 3,
        background: { r: 120, g: 150, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    const derivatives = await generateDerivatives(samplePhoto, IMAGE_PROCESSING_CONFIG, {
      enabled: true,
      text: 'Studio Lumina',
      opacity: 0.35,
      size: 'small',
      position: 'bottom-right',
      color: 'white',
    });

    expect(derivatives.thumbnailBuffer.length).toBeGreaterThan(0);
    expect(derivatives.previewBuffer.length).toBeGreaterThan(0);
    expect(derivatives.width).toBe(1280);
    expect(derivatives.height).toBe(720);
    // WebP derivative compression efficiency
    expect(derivatives.thumbnailBuffer.length).toBeLessThan(derivatives.previewBuffer.length);
  }, 60000);

  it('3. Vector database storage models adhere to 128-D pgvector + HNSW memory bounds', () => {
    const metrics = runVectorDatabaseBenchmark();
    expect(metrics.length).toBe(5);

    const m100k = metrics.find((m) => m.embeddingCount === 100_000);
    expect(m100k).toBeDefined();
    // 100k raw 128-D vectors = 48.8 MB
    expect(m100k!.rawVectorBytesMb).toBeCloseTo(48.8, 1);
    // Total storage with HNSW index should be ~252.5 MB (less than 300 MB)
    expect(m100k!.totalStorageMb).toBeLessThan(300);
    // Filtered query latency remains sub-15ms
    expect(m100k!.eventQueryLatencyP95Ms).toBeLessThan(15);
  });

  it('4. Face search concurrency benchmark enforces multi-event isolation with zero leakage', async () => {
    const report = await runFaceSearchBenchmark();
    expect(report.multiEventIsolationVerified).toBe(true);

    // Verify all tiers succeeded with 0 errors
    for (const tier of report.concurrencyTiers) {
      expect(tier.failedRequests).toBe(0);
      expect(tier.crossEventLeakageCount).toBe(0);
      expect(tier.p50Ms).toBeLessThan(500); // Sub-500ms response time
    }
  });

  it('5. Cloudflare R2 cost formulas accurately calculate Class A and Class B operations', () => {
    // Cloudflare R2 standard pricing (2026):
    // Storage: $0.015 / GB-month (first 10 GB free)
    // Class A operations (PUT, LIST): $4.50 / million (first 1 million free)
    // Class B operations (GET): $0.36 / million (first 10 million free)
    // Egress: $0.00 / GB

    const calculateR2Cost = (
      storageGb: number,
      classAOps: number,
      classBOps: number
    ) => {
      const billableStorageGb = Math.max(0, storageGb - 10);
      const billableClassA = Math.max(0, classAOps - 1_000_000);
      const billableClassB = Math.max(0, classBOps - 10_000_000);

      const storageCost = billableStorageGb * 0.015;
      const classACost = (billableClassA / 1_000_000) * 4.5;
      const classBCost = (billableClassB / 1_000_000) * 0.36;

      return {
        storageCost,
        classACost,
        classBCost,
        total: storageCost + classACost + classBCost,
      };
    };

    // Profile B: 110 GB storage, 15,000 Class A, 120,000 Class B
    const profileB = calculateR2Cost(110, 15_000, 120_000);
    // Billable storage: 100 GB * $0.015 = $1.50
    // Class A: 0 (under 1M free tier)
    // Class B: 0 (under 10M free tier)
    expect(profileB.storageCost).toBeCloseTo(1.5, 2);
    expect(profileB.classACost).toBe(0);
    expect(profileB.classBCost).toBe(0);
    expect(profileB.total).toBeCloseTo(1.5, 2);

    // Profile D (High volume): 1,500 GB storage, 2,500,000 Class A, 25,000,000 Class B
    const profileD = calculateR2Cost(1500, 2_500_000, 25_000_000);
    // Billable storage: 1,490 * 0.015 = $22.35
    // Class A: 1.5M * $4.50 = $6.75
    // Class B: 15M * $0.36 = $5.40
    // Total = $34.50
    expect(profileD.storageCost).toBeCloseTo(22.35, 2);
    expect(profileD.classACost).toBeCloseTo(6.75, 2);
    expect(profileD.classBCost).toBeCloseTo(5.4, 2);
    expect(profileD.total).toBeCloseTo(34.5, 2);
  });
});
