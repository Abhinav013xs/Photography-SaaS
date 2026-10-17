import { Router, type Request, type Response, type NextFunction } from 'express';
import { AuthenticationError } from '@photography-saas/errors';
import { validateBody } from '../middleware/validate.js';
import { requirePhotographer } from '../middleware/auth.js';
import {
  createAuthRateLimiter,
  recordFailedAttempt,
  resetRateLimit,
  getClientIp,
  passwordRateLimiter,
} from '../middleware/rateLimiter.js';
import { validateOrigin } from '../middleware/csrf.js';
import { setSessionCookie, clearSessionCookie } from '../services/cookieService.js';
import {
  getPhotographerByEmail,
  comparePassword,
  performDummyCompare,
  signSessionToken,
  toPhotographerProfile,
  hashPassword,
  updatePhotographerPassword,
} from '../services/authService.js';
import { loginSchema, passwordChangeSchema } from './authSchemas.js';
import { log } from '../middleware/logger.js';

const authRouter = Router();

// Rate limiter for login: max 5 failed attempts per 15 minutes
const loginRateLimiter = createAuthRateLimiter();

/**
 * POST /api/auth/login
 * Authenticates the photographer and sets an HttpOnly session cookie.
 */
authRouter.post(
  '/login',
  validateOrigin,
  loginRateLimiter,
  validateBody(loginSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { email, password } = req.body;
    const clientIp = getClientIp(req);

    try {
      const photographer = await getPhotographerByEmail(email);

      // Defend against account enumeration via constant-time dummy compare
      if (!photographer) {
        await performDummyCompare(password);
        await recordFailedAttempt(clientIp);

        log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'photography-api',
          message: 'Failed login attempt: Account not found',
          route: '/api/auth/login',
          method: 'POST',
          requestId: req.requestId,
        });

        throw new AuthenticationError('Invalid email or password');
      }

      const isMatch = await comparePassword(password, photographer.password_hash);
      if (!isMatch) {
        await recordFailedAttempt(clientIp);

        log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          service: 'photography-api',
          message: 'Failed login attempt: Incorrect password',
          route: '/api/auth/login',
          method: 'POST',
          requestId: req.requestId,
        });

        throw new AuthenticationError('Invalid email or password');
      }

      // Successful authentication: reset rate limit counter
      await resetRateLimit(clientIp);

      // Create session token and set secure HttpOnly cookie
      const token = signSessionToken(photographer);
      setSessionCookie(res, token);

      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'photography-api',
        message: 'Photographer authenticated successfully',
        route: '/api/auth/login',
        method: 'POST',
        requestId: req.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          photographer: toPhotographerProfile(photographer),
          token, // Included for API/testing clients; browsers rely on the HttpOnly cookie
        },
        meta: {
          requestId: req.requestId,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/logout
 * Clears the session cookie and terminates the authenticated session.
 */
authRouter.post(
  '/logout',
  validateOrigin,
  (req: Request, res: Response): void => {
    clearSessionCookie(res);

    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'photography-api',
      message: 'Photographer logged out',
      route: '/api/auth/logout',
      method: 'POST',
      requestId: req.requestId,
    });

    res.status(200).json({
      success: true,
      data: {
        message: 'Successfully logged out',
      },
      meta: {
        requestId: req.requestId,
      },
    });
  }
);

/**
 * GET /api/auth/me
 * Retrieves current authenticated photographer profile.
 */
authRouter.get(
  '/me',
  requirePhotographer,
  (req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      data: {
        photographer: toPhotographerProfile(req.photographer!),
      },
      meta: {
        requestId: req.requestId,
      },
    });
  }
);

/**
 * PUT /api/auth/password
 * Changes the administrative password and rotates session token.
 */
authRouter.put(
  '/password',
  validateOrigin,
  requirePhotographer,
  passwordRateLimiter,
  validateBody(passwordChangeSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { currentPassword, newPassword } = req.body;
    const clientIp = getClientIp(req);

    try {
      const photographer = req.photographer!;
      const isMatch = await comparePassword(currentPassword, photographer.password_hash);

      if (!isMatch) {
        await recordFailedAttempt(clientIp);
        throw new AuthenticationError('Current password is incorrect');
      }

      // Hash new password and update record
      const newHash = await hashPassword(newPassword);
      await updatePhotographerPassword(photographer.id, newHash);

      // Rotate session token
      const newToken = signSessionToken({ id: photographer.id, email: photographer.email });
      setSessionCookie(res, newToken);

      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'photography-api',
        message: 'Photographer password updated and session rotated',
        route: '/api/auth/password',
        method: 'PUT',
        requestId: req.requestId,
      });

      res.status(200).json({
        success: true,
        data: {
          message: 'Password updated successfully',
        },
        meta: {
          requestId: req.requestId,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default authRouter;
