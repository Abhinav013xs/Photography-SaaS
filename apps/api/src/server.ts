import { createApp } from './app.js';
import { getConfig } from '@photography-saas/config';
import { log } from './middleware/logger.js';
import { closeDatabase } from './infrastructure/database.js';
import { closeRedis } from './infrastructure/redis.js';
import { resetR2Client } from './infrastructure/r2Client.js';
import { startWorkers, stopWorkers } from './services/queue/workerManager.js';
import { closeQueues } from './services/queue/queueManager.js';

const config = getConfig();
const app = createApp();

// Initialize background job workers
if (config.nodeEnv !== 'test') {
  try {
    startWorkers();
  } catch (err) {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message: `Failed to start background workers: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

const server = app.listen(config.port, () => {
  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Studio Lumina API listening on port ${config.port} [${config.nodeEnv}]`,
    details: {
      port: config.port,
      environment: config.nodeEnv,
      appUrl: config.appUrl,
    },
  });
});

// Graceful Shutdown
async function handleShutdown(signal: string) {
  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Received ${signal}. Initiating graceful shutdown...`,
  });

  server.close(async () => {
    try {
      await stopWorkers();
      await closeQueues();
      await Promise.all([closeDatabase(), closeRedis()]);
      resetR2Client();
      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'photography-api',
        message: 'Workers stopped, Queues, Database, and Redis connections closed cleanly. Exiting.',
      });
      process.exit(0);
    } catch (err) {
      log({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'photography-api',
        message: `Error during shutdown: ${err instanceof Error ? err.message : String(err)}`,
      });
      process.exit(1);
    }
  });

  // Force close after 10 seconds if hanging
  setTimeout(() => {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message: 'Forced shutdown after timeout',
    });
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
