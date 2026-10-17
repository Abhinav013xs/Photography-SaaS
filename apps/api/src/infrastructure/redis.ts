import { Redis } from 'ioredis';
import { getConfig } from '@photography-saas/config';
import type { SubsystemHealthCheck } from '@photography-saas/types';
import { log } from '../middleware/logger.js';

let redisClient: Redis | null = null;

/**
 * Returns the active Redis client singleton.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    const config = getConfig();
    redisClient = new Redis(config.redis.url, {
      keyPrefix: config.redis.keyPrefix,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy(times) {
        // Linear backoff capped at 2 seconds
        return Math.min(times * 100, 2000);
      },
    });

    redisClient.on('error', (err) => {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'photography-api',
        message: `Redis connection warning: ${err.message}`,
      });
    });
  }
  return redisClient;
}

/**
 * Checks Redis connectivity and ping latency.
 * Does NOT initialize BullMQ queues.
 */
export async function checkRedisHealth(): Promise<SubsystemHealthCheck> {
  const start = Date.now();
  try {
    const client = getRedisClient();
    const pingPromise = (async () => {
      if (client.status === 'wait') {
        await client.connect();
      }
      return client.ping();
    })();

    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('Redis ping timeout (1000ms)')), 1000).unref();
    });

    const pong = await Promise.race([pingPromise, timeoutPromise]);
    const latencyMs = Date.now() - start;

    if (pong === 'PONG') {
      return {
        status: 'healthy',
        latencyMs,
      };
    }
    return {
      status: 'degraded',
      latencyMs,
      message: `Unexpected Redis response: ${pong}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : 'Redis ping failed';
    return {
      status: 'unhealthy',
      latencyMs,
      message,
    };
  }
}

/**
 * Gracefully disconnects the Redis client.
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    } finally {
      redisClient = null;
    }
  }
}
