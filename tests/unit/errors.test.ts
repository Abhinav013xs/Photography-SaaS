import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  GalleryExpiredError,
  RateLimitError,
  isAppError,
  toAppError,
} from '../../packages/errors/src/AppError.js';

describe('AppError Hierarchy Unit Tests', () => {
  it('should construct specific errors with correct HTTP status and code', () => {
    const valErr = new ValidationError('Invalid email format', [{ field: 'email', message: 'invalid' }]);
    expect(valErr.statusCode).toBe(400);
    expect(valErr.code).toBe('VALIDATION_ERROR');

    const authErr = new AuthenticationError('Token required');
    expect(authErr.statusCode).toBe(401);
    expect(authErr.code).toBe('AUTHENTICATION_REQUIRED');

    const forErr = new AuthorizationError('Forbidden');
    expect(forErr.statusCode).toBe(403);
    expect(forErr.code).toBe('FORBIDDEN');

    const notFound = new NotFoundError('Event not found');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe('NOT_FOUND');

    const expired = new GalleryExpiredError();
    expect(expired.statusCode).toBe(410);
    expect(expired.code).toBe('GALLERY_EXPIRED');

    const rate = new RateLimitError();
    expect(rate.statusCode).toBe(429);
    expect(rate.code).toBe('RATE_LIMITED');
  });

  it('should format into standard ApiErrorResponse envelope', () => {
    const error = new NotFoundError('Gallery not found');
    const response = error.toResponse('req-1234-uuid');

    expect(response).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Gallery not found',
        details: undefined,
        requestId: 'req-1234-uuid',
      },
    });
  });

  it('should correctly identify and normalize unknown errors', () => {
    const appErr = new ValidationError('Bad input');
    expect(isAppError(appErr)).toBe(true);

    const standardError = new Error('Database connection reset');
    expect(isAppError(standardError)).toBe(false);

    const converted = toAppError(standardError);
    expect(isAppError(converted)).toBe(true);
    expect(converted.statusCode).toBe(500);
    expect(converted.code).toBe('INTERNAL_SERVER_ERROR');
    expect(converted.message).toBe('Database connection reset');
  });
});
