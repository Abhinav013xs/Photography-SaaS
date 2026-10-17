import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getConfig } from '@photography-saas/config';
import { query } from '../infrastructure/database.js';
import type { Photographer, PhotographerProfile } from '@photography-saas/types';

// Pre-computed dummy bcrypt hash (cost 10) to mitigate timing attacks on nonexistent emails
const DUMMY_BCRYPT_HASH = '$2a$10$w095mJvYqE2Qn25VjVfZueH5L.M1o2d9P2Yl8v7U2Q9J5vYqE2Qn2';

const BCRYPT_ROUNDS = 10;
const SESSION_EXPIRATION = '7d';

/**
 * Hashes a plaintext password using salted bcrypt (cost 10).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
  return bcrypt.hash(password, salt);
}

/**
 * Compares plaintext password against a bcrypt hash in constant time.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Performs dummy comparison to eliminate timing discrepancies when account is not found.
 */
export async function performDummyCompare(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
}

/**
 * Signs a secure session JWT token for the authenticated photographer.
 */
export function signSessionToken(photographer: { id: number; email: string }): string {
  const config = getConfig();
  return jwt.sign(
    {
      sub: photographer.id,
      email: photographer.email,
    },
    config.authSecret,
    {
      expiresIn: SESSION_EXPIRATION,
      issuer: 'studio-lumina-api',
      audience: 'studio-lumina-client',
    }
  );
}

/**
 * Verifies a session JWT token and returns the decoded payload.
 */
export function verifySessionToken(token: string): { id: number; email: string } | null {
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.authSecret, {
      issuer: 'studio-lumina-api',
      audience: 'studio-lumina-client',
    }) as { sub: number | string; email: string };

    const id = typeof decoded.sub === 'number' ? decoded.sub : parseInt(decoded.sub, 10);
    if (isNaN(id)) return null;

    return {
      id,
      email: decoded.email,
    };
  } catch {
    return null;
  }
}

/**
 * Queries the single photographer by email (case-insensitive normalized).
 */
export async function getPhotographerByEmail(email: string): Promise<Photographer | null> {
  const normalized = email.trim().toLowerCase();
  const res = await query<Photographer>(
    'SELECT * FROM photographer WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [normalized]
  );
  return res.rows[0] || null;
}

/**
 * Queries the single photographer by ID.
 */
export async function getPhotographerById(id: number): Promise<Photographer | null> {
  const res = await query<Photographer>(
    'SELECT * FROM photographer WHERE id = $1 LIMIT 1',
    [id]
  );
  return res.rows[0] || null;
}

/**
 * Counts the total number of photographer records (must be 0 or 1).
 */
export async function getPhotographerCount(): Promise<number> {
  const res = await query<{ count: string }>('SELECT COUNT(*) AS count FROM photographer');
  return parseInt(res.rows[0]?.count || '0', 10);
}

/**
 * Creates the single photographer owner.
 */
export async function createPhotographer(data: {
  email: string;
  password_hash: string;
  business_name?: string;
  tagline?: string;
  bio?: string;
  website?: string;
  instagram?: string;
}): Promise<Photographer> {
  const normalized = data.email.trim().toLowerCase();
  const res = await query<Photographer>(
    `INSERT INTO photographer (email, password_hash, business_name, tagline, bio, website, instagram)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      normalized,
      data.password_hash,
      data.business_name || 'Studio Lumina',
      data.tagline || 'Editorial & Fine Art Photography',
      data.bio || null,
      data.website || null,
      data.instagram || null,
    ]
  );
  return res.rows[0];
}

/**
 * Updates the administrative password hash for the photographer.
 */
export async function updatePhotographerPassword(id: number, newHash: string): Promise<void> {
  await query(
    'UPDATE photographer SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [newHash, id]
  );
}

/**
 * Formats a Photographer database entity into a safe client profile response.
 */
export function toPhotographerProfile(photographer: Photographer): PhotographerProfile {
  return {
    id: photographer.id,
    email: photographer.email,
    businessName: photographer.business_name,
    tagline: photographer.tagline,
    bio: photographer.bio,
    website: photographer.website,
    instagram: photographer.instagram,
    avatarUrl: photographer.avatar_url,
    createdAt: photographer.created_at instanceof Date 
      ? photographer.created_at.toISOString() 
      : String(photographer.created_at),
  };
}
