import { createHash, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { getConfig } from '@photography-saas/config';
import { query } from '../infrastructure/database.js';
import type { GuestSessionTokenPayload } from '@photography-saas/types';
import { log } from '../middleware/logger.js';

export const GUEST_SESSION_TTL_HOURS = 12;
export const GUEST_COOKIE_NAME_PREFIX = 'guest_session_';

/**
 * Computes a secure SHA-256 hash of a token for database lookup.
 * Never stores raw bearer tokens in the database.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Computes a privacy-preserving SHA-256 hash of an IP address.
 * Never stores raw IP addresses in the database.
 */
export function hashIp(ip?: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip.trim()).digest('hex');
}

/**
 * Creates a cryptographically signed guest session token and persists its SHA-256 hash in PostgreSQL.
 */
export async function createGuestSession(
  eventId: string,
  clientIp?: string
): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const config = getConfig();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + GUEST_SESSION_TTL_HOURS * 60 * 60 * 1000);

  const payload: GuestSessionTokenPayload = {
    eventId,
    sessionId,
    role: 'guest',
  };

  const token = jwt.sign(payload, config.authSecret, {
    expiresIn: `${GUEST_SESSION_TTL_HOURS}h`,
    jwtid: sessionId,
  });

  const tokenHash = hashToken(token);
  const ipAddressHash = hashIp(clientIp);

  await query(
    `INSERT INTO guest_sessions (id, event_id, token_hash, ip_address_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [sessionId, eventId, tokenHash, ipAddressHash, expiresAt]
  );

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Ephemeral guest session created for event ${eventId}`,
    details: {
      eventId,
      sessionId,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return { token, expiresAt, sessionId };
}

/**
 * Validates a guest token against the target event:
 * 1. Cryptographically verifies signature and expiry.
 * 2. Enforces strict event ID matching (token eventId === targetEventId).
 * 3. Enforces server-side persistence and revocation check in PostgreSQL when requireDatabaseSession is true.
 */
export async function validateGuestToken(
  token: string,
  targetEventId: string,
  requireDatabaseSession = false
): Promise<{ isValid: boolean; sessionId?: string; error?: string }> {
  if (!token || typeof token !== 'string') {
    return { isValid: false, error: 'No token provided' };
  }

  const config = getConfig();

  let payload: any;
  try {
    payload = jwt.verify(token.trim(), config.authSecret);
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') {
      return { isValid: false, error: 'Guest session token has expired' };
    }
    return { isValid: false, error: 'Invalid guest session token signature' };
  }

  const tokenEventId = payload.eventId || payload.event_id;
  // Strict Event Scope check
  if (!tokenEventId || tokenEventId !== targetEventId) {
    return {
      isValid: false,
      error: `Cross-event token rejection: Token scoped to "${tokenEventId}", requested "${targetEventId}"`,
    };
  }

  // Server-side revocation and expiry check in PostgreSQL
  const tokenHash = hashToken(token);
  const sessionRes = await query<{ id: string; expires_at: string }>(
    `SELECT id, expires_at
     FROM guest_sessions
     WHERE token_hash = $1 AND event_id = $2 AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash, targetEventId]
  );

  if (sessionRes.rows.length === 0) {
    if (requireDatabaseSession) {
      return { isValid: false, error: 'Guest session does not exist, has expired, or was revoked' };
    }
    // For unprotected events or signed tokens, fallback to payload session ID
    return { isValid: true, sessionId: payload.sessionId || payload.session_id || 'jwt-session' };
  }

  return { isValid: true, sessionId: sessionRes.rows[0].id };
}

/**
 * Revokes all active guest sessions for a given event ID.
 * Triggered when a photographer changes or disables the event PIN.
 */
export async function revokeEventGuestSessions(eventId: string): Promise<number> {
  const res = await query(
    `DELETE FROM guest_sessions WHERE event_id = $1`,
    [eventId]
  );

  const revokedCount = (res as any).rowCount || 0;
  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Revoked all active guest sessions for event ${eventId} (count: ${revokedCount})`,
    details: { eventId, revokedCount },
  });

  return revokedCount;
}

/**
 * Revokes a specific guest session (e.g., guest explicit logout/exit).
 */
export async function revokeGuestSession(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const res = await query(
    `DELETE FROM guest_sessions WHERE token_hash = $1`,
    [tokenHash]
  );
  return ((res as any).rowCount || 0) > 0;
}

/**
 * Periodic or on-demand cleanup of expired guest sessions from PostgreSQL.
 */
export async function cleanupExpiredGuestSessions(): Promise<number> {
  const res = await query(
    `DELETE FROM guest_sessions WHERE expires_at < NOW()`
  );
  return (res as any).rowCount || 0;
}
