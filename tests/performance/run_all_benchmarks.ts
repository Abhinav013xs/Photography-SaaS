/**
 * ===================================================================
 * STUDIO LUMINA — PHASE 35: UNIFIED PERFORMANCE BENCHMARK HARNESS
 * ===================================================================
 * Orchestrates all micro-benchmarks:
 *   1. Upload Benchmark (Direct R2 vs Proxy)
 *   2. Worker Throughput Benchmark (Sharp + Face Pipeline across 1-4 workers)
 *   3. Guest Face Search Concurrency Benchmark (1-100 concurrent requests)
 *   4. Vector Database Scalability Benchmark (10K-1M embeddings)
 */

import { runUploadBenchmark } from './upload_benchmark.js';
import { runWorkerThroughputBenchmark } from './worker_throughput_benchmark.js';
import { runFaceSearchBenchmark } from './face_search_benchmark.js';
import { runVectorDatabaseBenchmark } from './vector_database_benchmark.js';

export async function runAllBenchmarks() {
  console.log('===================================================================');
  console.log('STUDIO LUMINA — PHASE 35 FULL PERFORMANCE & SCALABILITY BENCHMARK');
  console.log('===================================================================');
  console.log(`Execution Timestamp: ${new Date().toISOString()}`);
  console.log(`Node Runtime:        ${process.version} (${process.arch})`);
  console.log(`Initial Heap Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
  console.log('-------------------------------------------------------------------');

  console.log('\n[1/4] EXECUTING PHOTO UPLOAD BENCHMARK...');
  const uploadMetrics = runUploadBenchmark();
  console.table(uploadMetrics);

  console.log('\n[2/4] EXECUTING WORKER THROUGHPUT BENCHMARK (1-4 WORKERS)...');
  const workerMetrics = await runWorkerThroughputBenchmark();
  console.table(workerMetrics);

  console.log('\n[3/4] EXECUTING GUEST FACE SEARCH & CONCURRENCY BENCHMARK (1-100 C)...');
  const searchReport = await runFaceSearchBenchmark();
  console.log('--- Search Pipeline Stage Latencies ---');
  console.table(searchReport.stageLatencies);
  console.log('--- Staged Concurrency Scaling Results ---');
  console.table(searchReport.concurrencyTiers);
  console.log(`Multi-Event Isolation Enforced: ${searchReport.multiEventIsolationVerified ? 'VERIFIED (0 LEAKS)' : 'FAILED'}`);

  console.log('\n[4/4] EXECUTING PGVECTOR DATABASE SCALABILITY BENCHMARK (10K - 1M)...');
  const vectorMetrics = runVectorDatabaseBenchmark();
  console.table(vectorMetrics);

  console.log('\n===================================================================');
  console.log('BENCHMARK RUN COMPLETED SUCCESSFULLY');
  console.log(`Final Heap Memory:   ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
  console.log('===================================================================');

  return {
    uploadMetrics,
    workerMetrics,
    searchReport,
    vectorMetrics,
  };
}

if (process.argv[1]?.endsWith('run_all_benchmarks.ts')) {
  runAllBenchmarks().catch((err) => {
    console.error('Benchmark execution failed:', err);
    process.exit(1);
  });
}
