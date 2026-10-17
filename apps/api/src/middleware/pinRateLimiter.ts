import type { Request, Response, NextFunction } from 'express';
import { PinRateLimitError } from '@photography-saas/errors';
import { log } from './logger.js';

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface PinAttemptRecord {
  attempts: number;
  resetAt: number;
}

// In-memory rate limiting map keyed by `${clientIp}:${eventId}`
const pinAttemptsStore = new Map<string, PinAttemptRecord>();

/**
 * Extracts client IP from request, safely handling proxies when configured.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ips.trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function getRateKey(ip: string, eventId: string): string {
  return `${ip.trim()}:${eventId.trim()}`;
}

/**
 * Checks whether an IP + event combination has exceeded the maximum allowed failed attempts.
 */
export function checkPinRateLimit(ip: string, eventId: string): {
  allowed: boolean;
  retryAfterSeconds: number;
  remainingAttempts: number;
} {
  const key = getRateKey(ip, eventId);
  const record = pinAttemptsStore.get(key);
  const now = Date.now();

  if (!record) {
    return { allowed: true, retryAfterSeconds: 0, remainingAttempts: MAX_PIN_ATTEMPTS };
  }

  // If lockout window expired, reset record
  if (now >= record.resetAt) {
    pinAttemptsStore.delete(key);
    return { allowed: true, retryAfterSeconds: 0, remainingAttempts: MAX_PIN_ATTEMPTS };
  }

  if (record.attempts >= MAX_PIN_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds, remainingAttempts: 0 };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remainingAttempts: MAX_PIN_ATTEMPTS - record.attempts,
  };
}

/**
 * Records a failed PIN attempt. If attempts reach MAX_PIN_ATTEMPTS, locks out for 15 minutes.
 */
export function recordFailedPinAttempt(ip: string, eventId: string): {
  remainingAttempts: number;
  retryAfterSeconds: number;
} {
  const key = getRateKey(ip, eventId);
  const now = Date.now();
  const record = pinAttemptsStore.get(key) || {
    attempts: 0,
    resetAt: now + PIN_LOCKOUT_WINDOW_MS,
  };

  // If window expired, reset
  if (now >= record.resetAt) {
    record.attempts = 1;
    record.resetAt = now + PIN_LOCKOUT_WINDOW_MS;
  } else {
    record.attempts += 1;
  }

  pinAttemptsStore.set(key, record);

  const remaining = Math.max(0, MAX_PIN_ATTEMPTS - record.attempts);
  const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);

  log({
    timestamp: new Date().toISOString(),
    level: record.attempts >= MAX_PIN_ATTEMPTS ? 'warn' : 'info',
    service: 'photography-api',
    message: `PIN verification attempt failed for event ${eventId} (attempt ${record.attempts}/${MAX_PIN_ATTEMPTS})`,
    details: {
      eventId,
      attempts: record.attempts,
      lockedOut: record.attempts >= MAX_PIN_ATTEMPTS,
      retryAfterSeconds: record.attempts >= MAX_PIN_ATTEMPTS ? retryAfterSeconds : undefined,
    },
  });

  return { remainingAttempts: remaining, retryAfterSeconds };
}

/**
 * Clears failed attempts upon successful PIN verification.
 */
export function clearPinRateLimit(ip: string, eventId: string): void {
  const key = getRateKey(ip, eventId);
  pinAttemptsStore.delete(key);
}

/**
 * Express middleware to enforce PIN rate limiting before checking PIN hash.
 */
export function pinRateLimiterMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const eventId = req.params.eventId || req.params.slug || req.body?.eventId || 'global';
    const clientIp = getClientIp(req);

    const { allowed, retryAfterSeconds } = checkPinRateLimit(clientIp, eventId);
    if (!allowed) {
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      throw new PinRateLimitError(
        `Too many incorrect PIN attempts. Please wait ${Math.ceil(retryAfterSeconds / 60)} minutes before trying again.`,
        retryAfterSeconds
      );
    }

    next();
  };
}

/**
 * Testing helper: clears all in-memory rate limiting state.
 */
export function resetPinRateLimiterStore(): void {
  pinAttemptsStore.clear();
}
