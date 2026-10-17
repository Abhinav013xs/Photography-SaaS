import { log } from '../middleware/logger.js';

/**
 * Standard structured logger helper providing level-based methods.
 */
export const logger = {
  info(message: string, details?: Record<string, unknown>): void {
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message,
      details,
    });
  },

  warn(message: string, details?: Record<string, unknown>): void {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'photography-api',
      message,
      details,
    });
  },

  error(message: string, details?: Record<string, unknown>): void {
    log({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'photography-api',
      message,
      details,
    });
  },

  debug(message: string, details?: Record<string, unknown>): void {
    log({
      timestamp: new Date().toISOString(),
      level: 'debug',
      service: 'photography-api',
      message,
      details,
    });
  },
};
