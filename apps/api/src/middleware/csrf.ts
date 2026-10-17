import type { Request, Response, NextFunction } from 'express';
import { AuthorizationError } from '@photography-saas/errors';
import { getConfig } from '@photography-saas/config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Validates request Origin / Referer for browser-initiated mutations (CSRF defense).
 */
export function validateOrigin(req: Request, _res: Response, next: NextFunction): void {
  // Safe read-only HTTP methods do not require origin checks
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const config = getConfig();
  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;

  // Determine request source origin
  let requestOrigin: string | null = null;
  if (originHeader) {
    requestOrigin = originHeader;
  } else if (refererHeader) {
    try {
      const parsed = new URL(refererHeader);
      requestOrigin = `${parsed.protocol}//${parsed.host}`;
    } catch {
      requestOrigin = null;
    }
  }

  // If no browser origin or referer header was provided (e.g., server-to-server or curl/tests), pass through
  if (!requestOrigin) {
    return next();
  }

  const allowedOrigin = new URL(config.appUrl).origin;

  // Normalize and compare
  const normalizedRequestOrigin = requestOrigin.toLowerCase();
  const normalizedAllowedOrigin = allowedOrigin.toLowerCase();

  if (normalizedRequestOrigin !== normalizedAllowedOrigin) {
    // In local development, also permit standard local dev origins (e.g., localhost:3000, 127.0.0.1:3000)
    if (config.nodeEnv === 'development' || config.nodeEnv === 'test') {
      const isLocalhost =
        normalizedRequestOrigin.includes('localhost') ||
        normalizedRequestOrigin.includes('127.0.0.1');
      if (isLocalhost) {
        return next();
      }
    }

    return next(
      new AuthorizationError(
        `Cross-origin request blocked: Origin '${requestOrigin}' is not authorized.`
      )
    );
  }

  next();
}
