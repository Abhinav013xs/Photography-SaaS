import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { authenticatePhotographer, signPhotographerToken } from '../middleware/auth.js';

const router = express.Router();

// In-memory rate limiting map for login attempts to prevent brute force
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attemptRecord = loginAttempts.get(clientIp) || { count: 0, resetAt: now + LOGIN_LOCKOUT_MS };

  if (attemptRecord.count >= MAX_LOGIN_ATTEMPTS && now < attemptRecord.resetAt) {
    const minutesLeft = Math.ceil((attemptRecord.resetAt - now) / 60000);
    const retryAfter = Math.ceil((attemptRecord.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfter.toString());
    return res.status(429).json({
      error: `Too many failed login attempts. Please wait ${minutesLeft} minutes before trying again.`,
    });
  }

  if (now > attemptRecord.resetAt) {
    attemptRecord.count = 0;
    attemptRecord.resetAt = now + LOGIN_LOCKOUT_MS;
  }

  // Pre-computed bcrypt cost 10 dummy hash to guarantee constant-time execution on nonexistent accounts
  const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMye.I95iL0Z5V3tFkYf99FmQnOiq2L5D9.';

  const photographer = db.prepare('SELECT * FROM photographer WHERE email = ?').get(email.toLowerCase().trim());
  if (!photographer) {
    bcrypt.compareSync(password, DUMMY_HASH);
    attemptRecord.count += 1;
    loginAttempts.set(clientIp, attemptRecord);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Phase 45: Check account suspension status
  if (photographer.status === 'suspended') {
    return res.status(403).json({
      error: 'Account Suspended',
      message: photographer.suspension_reason
        ? `Your photographer account has been suspended: ${photographer.suspension_reason}. Please contact customer support.`
        : 'Your photographer account is currently suspended. Please contact customer support.',
    });
  }

  const isValid = bcrypt.compareSync(password, photographer.password_hash);
  if (!isValid) {
    attemptRecord.count += 1;
    loginAttempts.set(clientIp, attemptRecord);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Clear failed attempts upon successful login
  loginAttempts.delete(clientIp);

  const token = signPhotographerToken({ id: photographer.id, email: photographer.email });
  
  const { password_hash, ...profile } = photographer;
  return res.json({
    token,
    photographer: profile,
  });
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticatePhotographer, (req, res) => {
  const photographer = db.prepare('SELECT * FROM photographer WHERE id = ?').get(req.photographer.id);
  if (!photographer) {
    return res.status(404).json({ error: 'Photographer not found' });
  }
  const { password_hash, ...profile } = photographer;
  return res.json({ photographer: profile });
});

/**
 * PUT /api/auth/profile
 */
router.put('/profile', authenticatePhotographer, (req, res) => {
  const { email, business_name, tagline, bio, website, instagram, current_password, new_password } = req.body;

  const photographer = db.prepare('SELECT * FROM photographer WHERE id = ?').get(req.photographer.id);
  if (!photographer) {
    return res.status(404).json({ error: 'Photographer not found' });
  }

  // Update email if provided
  if (email && typeof email === 'string' && email.trim()) {
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail.includes('@') || !normalizedEmail.includes('.')) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }
    const existing = db.prepare('SELECT id FROM photographer WHERE email = ? AND id != ?').get(normalizedEmail, req.photographer.id);
    if (existing) {
      return res.status(400).json({ error: 'Email is already in use by another account' });
    }
    db.prepare('UPDATE photographer SET email = ? WHERE id = ?').run(normalizedEmail, req.photographer.id);
  }

  if (new_password) {
    if (typeof new_password !== 'string' || new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }
    if (!current_password) {
      return res.status(400).json({ error: 'Current password is required to set new password' });
    }
    const isValid = bcrypt.compareSync(current_password, photographer.password_hash);
    if (!isValid) {
      return res.status(400).json({ error: 'Current password does not match' });
    }
    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(new_password, salt);
    db.prepare('UPDATE photographer SET password_hash = ? WHERE id = ?').run(newHash, req.photographer.id);
  }

  db.prepare(`
    UPDATE photographer SET
      business_name = COALESCE(?, business_name),
      tagline = COALESCE(?, tagline),
      bio = COALESCE(?, bio),
      website = COALESCE(?, website),
      instagram = COALESCE(?, instagram)
    WHERE id = ?
  `).run(business_name, tagline, bio, website, instagram, req.photographer.id);

  const updated = db.prepare('SELECT * FROM photographer WHERE id = ?').get(req.photographer.id);
  const { password_hash, ...profile } = updated;

  return res.json({ success: true, photographer: profile });
});

export default router;
