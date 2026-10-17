import type { Request, Response, NextFunction } from 'express';
import { AuthenticationError } from '@photography-saas/errors';
import type { AuthContext, Photographer } from '@photography-saas/types';
import { verifySessionToken, getPhotographerById } from '../services/authService.js';
import { SESSION_COOKIE_NAME } from '../services/cookieService.js';

// Extend Express Request interface to include authenticated owner context
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      photographer?: Photographer;
    }
  }
}

/**
 * Extracts session token from HTTP-only cookie or Authorization header.
 */
export function extractToken(req: Request): string | null {
  // 1. Check HttpOnly cookie
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    return req.cookies[SESSION_COOKIE_NAME];
  }

  // 2. Check Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Authentication Guard Middleware
 * Rejects unauthenticated requests and attaches verified photographer context to req.auth.
 */
export async function requirePhotographer(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new AuthenticationError('Authentication required');
    }

    const payload = verifySessionToken(token);
    if (!payload) {
      throw new AuthenticationError('Session token is invalid or has expired');
    }

    const photographer = await getPhotographerById(payload.id);
    if (!photographer) {
      throw new AuthenticationError('Authenticated photographer account not found');
    }

    // Attach verified context
    req.auth = {
      id: photographer.id,
      email: photographer.email,
    };
    req.photographer = photographer;

    next();
  } catch (error) {
    next(error);
  }
}
