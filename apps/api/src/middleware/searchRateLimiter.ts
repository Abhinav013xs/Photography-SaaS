import type { Request, Response, NextFunction } from 'express';
import { FaceSearchRateLimitError } from '@photography-saas/errors';

interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateLimitRecord>();

const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_SEARCHES_PER_WINDOW = 10; // 10 searches per minute per client/event

// Periodic purge every 5 minutes to prevent map growth
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    record.timestamps = record.timestamps.filter((ts) => now - ts < WINDOW_MS);
    if (record.timestamps.length === 0) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export function searchRateLimiter(options?: { windowMs?: number; maxSearches?: number }) {
  const windowMs = options?.windowMs ?? WINDOW_MS;
  const maxSearches = options?.maxSearches ?? MAX_SEARCHES_PER_WINDOW;

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const eventId = req.params.eventId || 'global';
    const key = `${ip}:${eventId}`;

    const now = Date.now();
    let record = rateLimitMap.get(key);

    if (!record) {
      record = { timestamps: [] };
      rateLimitMap.set(key, record);
    }

    // Filter out timestamps outside window
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

    if (record.timestamps.length >= maxSearches) {
      const oldest = record.timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));

      return next(
        new FaceSearchRateLimitError(
          `Search rate limit exceeded. You may perform at most ${maxSearches} face searches per minute.`,
          retryAfterSeconds
        )
      );
    }

    record.timestamps.push(now);
    next();
  };
}

/**
 * Resets rate limit map (useful for test isolation).
 */
export function resetSearchRateLimiter(): void {
  rateLimitMap.clear();
}
