/**
 * Photographer Authentication & Security Domain Types
 * Phase 4: Photographer Authentication & Security
 */

export interface LoginInput {
  email: string;
  password: string;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

export interface PhotographerProfile {
  id: number;
  email: string;
  businessName: string;
  tagline: string | null;
  bio: string | null;
  website: string | null;
  instagram: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AuthContext {
  id: number;
  email: string;
}

export interface SessionTokenPayload {
  sub: number;
  email: string;
  iat: number;
  exp: number;
}
