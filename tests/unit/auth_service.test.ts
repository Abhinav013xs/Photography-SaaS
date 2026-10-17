import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  comparePassword,
  performDummyCompare,
  signSessionToken,
  verifySessionToken,
  toPhotographerProfile,
} from '../../apps/api/src/services/authService.js';
import type { Photographer } from '@photography-saas/types';

describe('Auth Service Unit Tests', () => {
  describe('Password Hashing & Verification (bcrypt)', () => {
    it('should hash a password using salted bcrypt with cost factor 10', async () => {
      const password = 'SuperSecretPassword123!';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^\$2[aby]\$10\$/); // bcrypt cost 10 prefix
      expect(hash).not.toBe(password);
    });

    it('should verify matching password against hash', async () => {
      const password = 'ValidPhotographerPassword!456';
      const hash = await hashPassword(password);

      const isValid = await comparePassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject non-matching password against hash', async () => {
      const password = 'CorrectPassword789';
      const hash = await hashPassword(password);

      const isValid = await comparePassword('WrongPassword123', hash);
      expect(isValid).toBe(false);
    });

    it('should perform dummy bcrypt compare without throwing', async () => {
      await expect(performDummyCompare('NonExistentAccountPassword')).resolves.toBeUndefined();
    });
  });

  describe('Session Token Lifecycle (JWT)', () => {
    const photographer = { id: 1, email: 'photographer@studiolumina.photo' };

    it('should sign and verify a valid session token', () => {
      const token = signSessionToken(photographer);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // Standard JWT header.payload.signature

      const decoded = verifySessionToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.id).toBe(1);
      expect(decoded?.email).toBe('photographer@studiolumina.photo');
    });

    it('should return null for malformed or tampered token', () => {
      const token = signSessionToken(photographer);
      const tampered = token.slice(0, -5) + 'abcde';

      const decoded = verifySessionToken(tampered);
      expect(decoded).toBeNull();
    });

    it('should return null for arbitrary strings', () => {
      expect(verifySessionToken('invalid.token.here')).toBeNull();
      expect(verifySessionToken('')).toBeNull();
    });
  });

  describe('Photographer Profile Transformation', () => {
    it('should strip sensitive fields like password_hash from the output', () => {
      const entity: Photographer = {
        id: 1,
        email: 'owner@studiolumina.photo',
        password_hash: '$2a$10$secret_bcrypt_hash_that_must_never_leak',
        business_name: 'Studio Lumina',
        tagline: 'Fine Art & Editorial',
        bio: 'Solo owner and photographer.',
        website: 'https://studiolumina.photo',
        instagram: '@studiolumina',
        avatar_url: 'https://assets.studiolumina.photo/avatar.jpg',
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      };

      const profile = toPhotographerProfile(entity);

      expect(profile).toBeDefined();
      expect((profile as any).password_hash).toBeUndefined();
      expect(profile.id).toBe(1);
      expect(profile.email).toBe('owner@studiolumina.photo');
      expect(profile.businessName).toBe('Studio Lumina');
      expect(profile.tagline).toBe('Fine Art & Editorial');
      expect(profile.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });
});
