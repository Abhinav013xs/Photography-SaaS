import type { CookieOptions, Response } from 'express';
import { getConfig } from '@photography-saas/config';

export const SESSION_COOKIE_NAME = 'studio_session';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Returns environment-aware, hardened cookie options for session management.
 */
export function getSessionCookieOptions(): CookieOptions {
  const config = getConfig();
  const isProd = config.nodeEnv === 'production';

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax', // Lax for local cross-port dev (localhost:3000 to 5000), Strict in prod
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

/**
 * Attaches the authenticated session cookie to an Express Response.
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
}

/**
 * Clears the session cookie from the client.
 */
export function clearSessionCookie(res: Response): void {
  const options = getSessionCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
  });
}
