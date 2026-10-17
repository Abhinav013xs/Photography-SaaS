import { Router, type Request, type Response } from 'express';
import { checkDatabaseHealth } from '../infrastructure/database.js';
import { checkRedisHealth } from '../infrastructure/redis.js';
import { checkAiServiceHealth, checkAiServiceReady } from '../infrastructure/aiClient.js';
import { checkStorageHealth } from '../infrastructure/storageAdapter.js';
import type { HealthCheckResponse, ProbeResponse, SubsystemHealthCheck } from '@photography-saas/types';
import { getConfig } from '@photography-saas/config';

const router = Router();
const processStartTime = Date.now();

/**
 * GET /health
 * Comprehensive diagnostic check across all application dependencies.
 */
router.get('/', async (req: Request, res: Response) => {
  const config = getConfig();
  const [dbHealth, redisHealth, aiHealth, storageHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkAiServiceHealth(),
    checkStorageHealth(),
  ]);

  const queueHealth: SubsystemHealthCheck = {
    status: redisHealth.status === 'healthy' ? 'healthy' : redisHealth.status === 'degraded' ? 'degraded' : 'unhealthy',
    message: redisHealth.status !== 'healthy' ? redisHealth.message : undefined,
  };

  const isHealthy = dbHealth.status !== 'unhealthy';

  const response: HealthCheckResponse = {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptimeSeconds: Math.floor((Date.now() - processStartTime) / 1000),
    environment: config.nodeEnv,
    checks: {
      database: dbHealth,
      redis: redisHealth,
      aiService: aiHealth,
      storage: storageHealth,
      queues: queueHealth,
    },
  };

  const statusCode = isHealthy ? 200 : 503;
  res.status(statusCode).json(response);
});

/**
 * GET /health/live
 * Kubernetes / process manager liveness probe.
 */
router.get('/live', (_req: Request, res: Response) => {
  const response: ProbeResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'photography-api',
  };
  res.status(200).json(response);
});

/**
 * Readiness probe handler ensuring database connectivity and AI microservice model readiness.
 */
export async function readyCheckHandler(_req: Request, res: Response): Promise<void> {
  const [dbHealth, aiReady] = await Promise.all([
    checkDatabaseHealth(),
    checkAiServiceReady(),
  ]);
  const isReady = dbHealth.status === 'healthy';
  const statusCode = isReady ? 200 : 503;
  res.status(statusCode).json({
    status: isReady ? 'ready' : 'not_ready',
    database: { status: dbHealth.status, latencyMs: dbHealth.latencyMs },
    aiService: aiReady,
  });
}

/**
 * GET /health/ready
 */
router.get('/ready', readyCheckHandler);

export default router;
