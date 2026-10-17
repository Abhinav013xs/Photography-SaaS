import { Redis, type RedisOptions } from 'ioredis';
import { getConfig } from '@photography-saas/config';
import { log } from '../../middleware/logger.js';

let sharedBullMQConnection: Redis | null = null;

/**
 * Returns connection options for BullMQ queues and workers.
 * Ensures `maxRetriesPerRequest: null` and `enableReadyCheck: false` as required by BullMQ.
 * Avoids setting `keyPrefix` at the ioredis layer since BullMQ manages its own key namespaces.
 */
export function getBullMQConnectionOptions(): RedisOptions {
  const config = getConfig();
  const redisUrl = config.redis.url;

  try {
    const url = new URL(redisUrl);
    const options: RedisOptions = {
      host: url.hostname || 'localhost',
      port: url.port ? parseInt(url.port, 10) : 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      db: url.pathname && url.pathname.length > 1 ? parseInt(url.pathname.slice(1), 10) : 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy(times) {
        return Math.min(times * 100, 2000);
      },
    };

    if (url.protocol === 'rediss:') {
      options.tls = {};
    }

    return options;
  } catch {
    return {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    };
  }
}

/**
 * Creates an isolated ioredis connection specifically configured for BullMQ.
 */
export function createBullMQRedisClient(): Redis {
  const options = getBullMQConnectionOptions();
  const client = new Redis(options);

  client.on('error', (err) => {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `BullMQ Redis connection warning: ${err.message}`,
    });
  });

  return client;
}
