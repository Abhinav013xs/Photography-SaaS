#!/usr/bin/env tsx
/**
 * Production Smoke Check Tool
 * Performs rapid non-destructive health, database, storage, queue,
 * and security sanity audits against the running application instance.
 *
 * Usage:
 *   npx tsx scripts/production-smoke-check.ts [--url http://localhost:3001]
 */

import http from 'http';
import https from 'https';
import db from '../server/db.js';

interface SmokeCheckResult {
  check: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  durationMs: number;
  details?: Record<string, unknown> | string;
}

function fetchUrl(targetUrl: string, timeoutMs = 5000): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(targetUrl, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Connection timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let baseUrl = 'http://localhost:3001';
  const urlIdx = args.indexOf('--url');
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    baseUrl = args[urlIdx + 1].replace(/\/$/, '');
  }

  console.log('=====================================================');
  console.log('  Studio Lumina — Production Post-Deployment Smoke Check');
  console.log(`  Target Instance: ${baseUrl}`);
  console.log(`  Timestamp:       ${new Date().toISOString()}`);
  console.log('=====================================================\n');

  const results: SmokeCheckResult[] = [];

  // Check 1: Liveness Probe (/api/health)
  const healthStart = Date.now();
  try {
    const res = await fetchUrl(`${baseUrl}/api/health`);
    const duration = Date.now() - healthStart;
    if (res.statusCode === 200) {
      const parsed = JSON.parse(res.body);
      if (parsed.status === 'healthy' && parsed.requestId) {
        results.push({
          check: 'Liveness Probe (/api/health)',
          status: 'PASS',
          durationMs: duration,
          details: { status: parsed.status, requestId: parsed.requestId },
        });
      } else {
        results.push({
          check: 'Liveness Probe (/api/health)',
          status: 'FAIL',
          durationMs: duration,
          details: `Unexpected response payload: ${res.body.slice(0, 100)}`,
        });
      }
    } else {
      results.push({
        check: 'Liveness Probe (/api/health)',
        status: 'FAIL',
        durationMs: duration,
        details: `HTTP ${res.statusCode}: ${res.body.slice(0, 100)}`,
      });
    }
  } catch (err) {
    results.push({
      check: 'Liveness Probe (/api/health)',
      status: 'FAIL',
      durationMs: Date.now() - healthStart,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Check 2: Readiness Probe (/api/ready)
  const readyStart = Date.now();
  try {
    const res = await fetchUrl(`${baseUrl}/api/ready`);
    const duration = Date.now() - readyStart;
    if (res.statusCode === 200) {
      const parsed = JSON.parse(res.body);
      if (parsed.ready === true && parsed.database === 'connected') {
        results.push({
          check: 'Readiness Probe (/api/ready)',
          status: 'PASS',
          durationMs: duration,
          details: { database: parsed.database, storage: parsed.storage, queueActive: parsed.queue?.isProcessing !== undefined },
        });
      } else {
        results.push({
          check: 'Readiness Probe (/api/ready)',
          status: 'FAIL',
          durationMs: duration,
          details: `Not ready state: ${JSON.stringify(parsed)}`,
        });
      }
    } else {
      results.push({
        check: 'Readiness Probe (/api/ready)',
        status: 'FAIL',
        durationMs: duration,
        details: `HTTP ${res.statusCode}: ${res.body.slice(0, 100)}`,
      });
    }
  } catch (err) {
    results.push({
      check: 'Readiness Probe (/api/ready)',
      status: 'FAIL',
      durationMs: Date.now() - readyStart,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Check 3: Queue Telemetry Probe (/api/queue/metrics)
  const queueStart = Date.now();
  try {
    const res = await fetchUrl(`${baseUrl}/api/queue/metrics`);
    const duration = Date.now() - queueStart;
    if (res.statusCode === 200) {
      const parsed = JSON.parse(res.body);
      if (parsed.success && parsed.metrics?.activeConcurrency !== undefined) {
        results.push({
          check: 'Queue Telemetry Probe (/api/queue/metrics)',
          status: 'PASS',
          durationMs: duration,
          details: {
            concurrency: parsed.metrics.activeConcurrency,
            queueDepth: parsed.metrics.queueDepth,
            totalProcessed: parsed.metrics.totalProcessed,
          },
        });
      } else {
        results.push({
          check: 'Queue Telemetry Probe (/api/queue/metrics)',
          status: 'FAIL',
          durationMs: duration,
          details: `Invalid metrics structure: ${res.body.slice(0, 100)}`,
        });
      }
    } else {
      results.push({
        check: 'Queue Telemetry Probe (/api/queue/metrics)',
        status: 'FAIL',
        durationMs: duration,
        details: `HTTP ${res.statusCode}: ${res.body.slice(0, 100)}`,
      });
    }
  } catch (err) {
    results.push({
      check: 'Queue Telemetry Probe (/api/queue/metrics)',
      status: 'FAIL',
      durationMs: Date.now() - queueStart,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Check 4: Database Responsiveness & Integrity
  const dbStart = Date.now();
  try {
    const row = db.prepare('SELECT 1 as alive, COUNT(*) as eventCount FROM events').get() as { alive: number; eventCount: number };
    const duration = Date.now() - dbStart;
    if (row && row.alive === 1 && duration < 50) {
      results.push({
        check: 'Database Query Responsiveness & Schema Check',
        status: 'PASS',
        durationMs: duration,
        details: { eventCount: row.eventCount, latency: `${duration}ms` },
      });
    } else {
      results.push({
        check: 'Database Query Responsiveness & Schema Check',
        status: duration >= 50 ? 'WARN' : 'FAIL',
        durationMs: duration,
        details: `High latency or unexpected return: ${duration}ms, alive=${row?.alive}`,
      });
    }
  } catch (err) {
    results.push({
      check: 'Database Query Responsiveness & Schema Check',
      status: 'FAIL',
      durationMs: Date.now() - dbStart,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Check 5: Security Header & Request ID Propagation
  const secStart = Date.now();
  try {
    const testReqId = 'smoke-test-' + Math.random().toString(36).substring(2, 9);
    const res = await new Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
      const parsed = new URL(`${baseUrl}/api/health`);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          headers: { 'x-request-id': testReqId },
        },
        (r) => {
          resolve({ statusCode: r.statusCode || 0, headers: r.headers });
        }
      );
      req.on('error', reject);
      req.end();
    });

    const duration = Date.now() - secStart;
    const returnedReqId = res.headers['x-request-id'];
    const xFrameOptions = res.headers['x-frame-options'];
    const xContentTypeOptions = res.headers['x-content-type-options'];

    if (returnedReqId === testReqId && xFrameOptions === 'DENY' && xContentTypeOptions === 'nosniff') {
      results.push({
        check: 'Security Headers & Request ID Propagation',
        status: 'PASS',
        durationMs: duration,
        details: {
          requestIdEchoed: true,
          frameOptions: xFrameOptions,
          contentTypeOptions: xContentTypeOptions,
        },
      });
    } else {
      results.push({
        check: 'Security Headers & Request ID Propagation',
        status: 'WARN',
        durationMs: duration,
        details: `Incomplete headers: reqId=${returnedReqId}, frameOptions=${xFrameOptions}`,
      });
    }
  } catch (err) {
    results.push({
      check: 'Security Headers & Request ID Propagation',
      status: 'FAIL',
      durationMs: Date.now() - secStart,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  // Print Summary Table
  console.log('-------------------------------------------------------------------------------');
  console.log('| Check Name                                    | Status | Latency  | Details');
  console.log('-------------------------------------------------------------------------------');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅ PASS' : r.status === 'WARN' ? '⚠️ WARN' : '❌ FAIL';
    const detailStr = typeof r.details === 'object' ? JSON.stringify(r.details) : String(r.details || '');
    console.log(`| ${r.check.padEnd(45)} | ${icon.padEnd(6)} | ${(r.durationMs + 'ms').padEnd(8)} | ${detailStr}`);
  }
  console.log('-------------------------------------------------------------------------------\n');

  const hasFailures = results.some((r) => r.status === 'FAIL');
  if (hasFailures) {
    console.error('❌ Production smoke check encountered critical failures.');
    process.exit(1);
  } else {
    console.log('✅ All production smoke checks passed cleanly. System is ready for live traffic.');
    process.exit(0);
  }
}

main();
