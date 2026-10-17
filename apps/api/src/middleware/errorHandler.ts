import type { Request, Response, NextFunction } from 'express';
import { isAppError, toAppError } from '@photography-saas/errors';
import { log } from './logger.js';

/**
 * Global Error Handling Middleware
 * Intercepts all errors, formats them into standard ApiErrorResponse envelopes,
 * logs them with correlation IDs, and ensures internal stacks are never leaked.
 */
export function errorHandlerMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const appError = toAppError(err);
  const requestId = req.requestId || 'unknown-request-id';

  // Log error with correlation ID
  log({
    timestamp: new Date().toISOString(),
    level: appError.statusCode >= 500 ? 'error' : 'warn',
    service: 'photography-api',
    message: `[${appError.code}] ${appError.message}`,
    requestId,
    route: req.originalUrl,
    method: req.method,
    statusCode: appError.statusCode,
    details: appError.details,
  });

  if ((appError as any).retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String((appError as any).retryAfterSeconds));
  }

  const response = appError.toResponse(requestId);

  // In production, sanitize non-operational 500 error messages to prevent leaking internal traces or queries
  if (process.env.NODE_ENV === 'production' && appError.statusCode >= 500 && !appError.isOperational) {
    response.error.message = 'An unexpected internal server error occurred';
    response.error.details = undefined;
  }

  res.status(appError.statusCode).json(response);
}
