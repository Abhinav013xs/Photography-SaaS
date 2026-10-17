import type { Request, Response, NextFunction } from 'express';
import { RateLimitError } from '@photography-saas/errors';
import { getRedisClient } from '../infrastructure/redis.js';

interface MemoryRateLimitRecord {
  count: number;
  resetAt: number;
}

// In-memory fallback cache for test environments or when Redis is offline
const memoryStore = new Map<string, MemoryRateLimitRecord>();

export interface RateLimiterOptions {
  windowMs: number;
  maxAttempts: number;
  keyPrefix: string;
}

export const LOGIN_RATE_LIMIT_OPTIONS: RateLimiterOptions = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxAttempts: 5,
  keyPrefix: 'rate_limit:login:',
};

export const PASSWORD_RATE_LIMIT_OPTIONS: RateLimiterOptions = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxAttempts: 5,
  keyPrefix: 'rate_limit:pwd:',
};

export const UPLOAD_PRESIGN_RATE_LIMIT_OPTIONS: RateLimiterOptions = {
  windowMs: 60 * 1000, // 1 minute
  maxAttempts: 60,
  keyPrefix: 'rate_limit:upload:',
};

export const BULK_DOWNLOAD_RATE_LIMIT_OPTIONS: RateLimiterOptions = {
  windowMs: 60 * 60 * 1000, // 1 hour
  maxAttempts: 25,
  keyPrefix: 'rate_limit:zip:',
};

export const PUBLIC_GALLERY_RATE_LIMIT_OPTIONS: RateLimiterOptions = {
  windowMs: 60 * 1000, // 1 minute
  maxAttempts: 120,
  keyPrefix: 'rate_limit:gallery:',
};

export const REPROCESS_RATE_LIMIT_OPTIONS: RateLimiterOptions = {
  windowMs: 60 * 60 * 1000, // 1 hour
  maxAttempts: 10,
  keyPrefix: 'rate_limit:reprocess:',
};

/**
 * Derives client identifier from IP address, prioritizing Cloudflare CF-Connecting-IP.
 */
export function getClientIp(req: Request): string {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) {
    return cfIp.trim();
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Checks current rate limit status and throws RateLimitError if exceeded.
 */
export async function checkRateLimit(
  key: string,
  options: RateLimiterOptions = LOGIN_RATE_LIMIT_OPTIONS
): Promise<void> {
  const now = Date.now();
  let currentCount = 0;

  try {
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      const fullKey = `${options.keyPrefix}${key}`;
      const count = await redis.get(fullKey);
      currentCount = count ? parseInt(count, 10) : 0;
    } else {
      // Memory fallback
      const record = memoryStore.get(key);
      if (record && record.resetAt > now) {
        currentCount = record.count;
      } else {
        memoryStore.delete(key);
      }
    }
  } catch {
    // Memory fallback on Redis error
    const record = memoryStore.get(key);
    if (record && record.resetAt > now) {
      currentCount = record.count;
    }
  }

  if (currentCount >= options.maxAttempts) {
    const record = memoryStore.get(key);
    const retryAfterSeconds = record
      ? Math.max(1, Math.ceil((record.resetAt - now) / 1000))
      : Math.ceil(options.windowMs / 1000);
    const err = new RateLimitError(
      `Too many failed attempts. Security cooldown active. Please try again later.`
    );
    (err as any).retryAfterSeconds = retryAfterSeconds;
    throw err;
  }
}

/**
 * Increments the failure counter for the given client identifier.
 */
export async function recordFailedAttempt(
  key: string,
  options: RateLimiterOptions = LOGIN_RATE_LIMIT_OPTIONS
): Promise<number> {
  const now = Date.now();
  let updatedCount = 1;

  try {
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      const fullKey = `${options.keyPrefix}${key}`;
      const count = await redis.incr(fullKey);
      if (count === 1) {
        await redis.pexpire(fullKey, options.windowMs);
      }
      updatedCount = count;
      return updatedCount;
    }
  } catch {
    // Fall through to memory fallback
  }

  // Memory fallback
  const record = memoryStore.get(key);
  if (record && record.resetAt > now) {
    record.count += 1;
    updatedCount = record.count;
  } else {
    memoryStore.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
  }

  return updatedCount;
}

/**
 * Resets the rate limit counter upon successful authentication.
 */
export async function resetRateLimit(
  key: string,
  options: RateLimiterOptions = LOGIN_RATE_LIMIT_OPTIONS
): Promise<void> {
  try {
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      await redis.del(`${options.keyPrefix}${key}`);
    }
  } catch {
    // Ignore redis error on cleanup
  }
  memoryStore.delete(key);
}

/**
 * Express middleware to enforce auth rate limiting per IP address.
 */
export function createAuthRateLimiter(options: Partial<RateLimiterOptions> = {}) {
  const mergedOptions: RateLimiterOptions = {
    ...LOGIN_RATE_LIMIT_OPTIONS,
    ...options,
  };

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = getClientIp(req);
      await checkRateLimit(ip, mergedOptions);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Express middleware to enforce request rate limiting (token consumption on all incoming requests).
 */
export function createRequestRateLimiter(options: RateLimiterOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = getClientIp(req);
      const now = Date.now();
      const key = `${options.keyPrefix}${ip}`;
      let currentCount = 1;

      try {
        const redis = getRedisClient();
        if (redis && redis.status === 'ready') {
          currentCount = await redis.incr(key);
          if (currentCount === 1) {
            await redis.pexpire(key, options.windowMs);
          }
        } else {
          // Memory store
          const record = memoryStore.get(key);
          if (record && record.resetAt > now) {
            record.count += 1;
            currentCount = record.count;
          } else {
            memoryStore.set(key, { count: 1, resetAt: now + options.windowMs });
            currentCount = 1;
          }
        }
      } catch {
        const record = memoryStore.get(key);
        if (record && record.resetAt > now) {
          record.count += 1;
          currentCount = record.count;
        } else {
          memoryStore.set(key, { count: 1, resetAt: now + options.windowMs });
          currentCount = 1;
        }
      }

      if (currentCount > options.maxAttempts) {
        const record = memoryStore.get(key);
        const retryAfterSeconds = record
          ? Math.max(1, Math.ceil((record.resetAt - now) / 1000))
          : Math.ceil(options.windowMs / 1000);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        const err = new RateLimitError(
          `Too many requests. Please wait ${Math.ceil(retryAfterSeconds / 60)} minutes before trying again.`
        );
        (err as any).retryAfterSeconds = retryAfterSeconds;
        throw err;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const passwordRateLimiter = createAuthRateLimiter(PASSWORD_RATE_LIMIT_OPTIONS);
export const uploadPresignRateLimiter = createRequestRateLimiter(UPLOAD_PRESIGN_RATE_LIMIT_OPTIONS);
export const bulkDownloadRateLimiter = createRequestRateLimiter(BULK_DOWNLOAD_RATE_LIMIT_OPTIONS);
export const publicGalleryRateLimiter = createRequestRateLimiter(PUBLIC_GALLERY_RATE_LIMIT_OPTIONS);
export const reprocessRateLimiter = createRequestRateLimiter(REPROCESS_RATE_LIMIT_OPTIONS);

/**
 * Clears the in-memory rate limiter store (for unit and integration tests).
 */
export function clearMemoryRateLimitStore(): void {
  memoryStore.clear();
}

export const resetLoginAttempts = clearMemoryRateLimitStore;
