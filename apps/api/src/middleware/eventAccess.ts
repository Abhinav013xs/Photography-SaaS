import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '@photography-saas/config';
import { query } from '../infrastructure/database.js';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  GalleryExpiredError,
  FaceSearchDisabledError,
  EventPinRequiredError,
  PinConfigurationError,
} from '@photography-saas/errors';
import { SESSION_COOKIE_NAME } from '../services/cookieService.js';
import { extractToken } from './auth.js';
import { verifySessionToken } from '../services/authService.js';
import { validateGuestToken, GUEST_COOKIE_NAME_PREFIX } from '../services/guestSessionService.js';
import { isEventExpired } from '../services/galleryExpiryService.js';

export interface VerifiedEventAccess {
  eventId: string;
  isPhotographer: boolean;
  photographerId?: number;
  guestSessionId?: string;
  faceSearchEnabled: boolean;
}

// Extend Request interface to include verified event access context
declare global {
  namespace Express {
    interface Request {
      eventAccess?: VerifiedEventAccess;
    }
  }
}

/**
 * Resolves and verifies event access for a given event ID:
 * 1. Enforces event existence, lifecycle status, and PIN requirements.
 * 2. Grants access to the authenticated photographer.
 * 3. Enforces database-verified ephemeral guest session token when PIN protection is enabled.
 */
export async function verifyEventAccess(
  req: Request,
  eventId: string,
  options?: { allowPublicFaceSearch?: boolean }
): Promise<VerifiedEventAccess> {
  // 1. Fetch event from database
  const eventRes = await query<{
    id: string;
    owner_id: number;
    status: string;
    visibility: string;
    public_until: Date | string | null;
    pin_enabled: boolean;
    pin_hash: string | null;
    face_search_enabled: boolean;
  }>(
    `SELECT id, owner_id, status, visibility, public_until, pin_enabled, pin_hash, face_search_enabled
     FROM events
     WHERE id = $1`,
    [eventId]
  );

  if (eventRes.rows.length === 0) {
    throw new NotFoundError(`Event "${eventId}" not found`);
  }

  const event = eventRes.rows[0];

  if (event.status === 'deleting') {
    throw new ConflictError(`Event "${eventId}" is currently being deleted`);
  }

  // Check if face search is requested but disabled
  const isFaceSearchRequest = Boolean(
    req.originalUrl?.includes('/face-search') || req.baseUrl?.includes('/face-search')
  );
  if (isFaceSearchRequest && !event.face_search_enabled) {
    throw new FaceSearchDisabledError(`Face search is disabled for event "${eventId}"`);
  }

  // 2. Check if caller is authenticated photographer
  let photographerId = req.auth?.id;
  if (!photographerId) {
    const sessionToken = extractToken(req);
    if (sessionToken) {
      const payload = verifySessionToken(sessionToken);
      if (payload) {
        photographerId = payload.id;
      }
    }
  }

  if (photographerId) {
    if (event.owner_id !== photographerId) {
      throw new AuthorizationError('You do not have permission to access this event');
    }

    return {
      eventId: event.id,
      isPhotographer: true,
      photographerId,
      faceSearchEnabled: event.face_search_enabled,
    };
  }

  // 3. For all non-photographer guest requests: Enforce event visibility and lifecycle status
  if (event.visibility !== 'public' || event.status !== 'active') {
    throw new AuthorizationError('This gallery is currently private.');
  }

  // 4. Request-Time Expiry Guard (Reactive Defense)
  if (isEventExpired(event.public_until)) {
    throw new GalleryExpiredError('The public viewing period for this gallery has expired.');
  }

  // 5. Fails closed if PIN protection is enabled without a valid hash
  if (event.pin_enabled && !event.pin_hash) {
    throw new PinConfigurationError(`Gallery "${eventId}" has PIN protection enabled without a valid PIN.`);
  }

  // 5. Extract guest token from headers or cookies
  let guestToken = (req.headers['x-guest-token'] as string | undefined)?.trim();
  if (!guestToken && req.headers.authorization?.startsWith('Bearer ')) {
    const bearer = req.headers.authorization.substring(7).trim();
    if (bearer && bearer !== req.cookies?.[SESSION_COOKIE_NAME]) {
      guestToken = bearer;
    }
  }
  if (!guestToken && req.cookies) {
    guestToken = req.cookies[`${GUEST_COOKIE_NAME_PREFIX}${event.id}`] || req.cookies['guest_token'];
  }

  // 5. If PIN protection is enabled, enforce database-verified guest session
  if (event.pin_enabled) {
    if (!guestToken) {
      throw new EventPinRequiredError(`Event PIN required to access this gallery.`);
    }

    const validation = await validateGuestToken(guestToken, event.id, true);
    if (!validation.isValid) {
      throw new AuthenticationError(validation.error || 'Invalid or expired guest session');
    }

    return {
      eventId: event.id,
      isPhotographer: false,
      guestSessionId: validation.sessionId,
      faceSearchEnabled: event.face_search_enabled,
    };
  }

  // 6. If PIN protection is disabled:
  // If guest token was provided, validate it strictly
  if (guestToken) {
    const validation = await validateGuestToken(guestToken, event.id, false);
    if (!validation.isValid) {
      throw new AuthenticationError(validation.error || 'Invalid or expired guest session');
    }
    return {
      eventId: event.id,
      isPhotographer: false,
      guestSessionId: validation.sessionId,
      faceSearchEnabled: event.face_search_enabled,
    };
  }

  // Face search on direct event routes requires authorization (photographer or guest token),
  // unless explicitly permitted on public guest slug routes without PIN protection
  if (isFaceSearchRequest && !options?.allowPublicFaceSearch) {
    throw new AuthenticationError('Valid photographer session or event guest access token required');
  }

  // Public active events can be viewed without token
  if (event.visibility === 'public' && event.status === 'active') {
    return {
      eventId: event.id,
      isPhotographer: false,
      faceSearchEnabled: event.face_search_enabled,
    };
  }

  throw new AuthenticationError('Valid photographer session or event guest access token required');
}

/**
 * Express Middleware to require verified event access before handler execution.
 */
export function requireEventAccess() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const eventId = req.params.eventId || req.params.id;
      if (!eventId) {
        throw new NotFoundError('Event ID parameter missing');
      }

      req.eventAccess = await verifyEventAccess(req, eventId);
      next();
    } catch (error) {
      next(error);
    }
  };
}
