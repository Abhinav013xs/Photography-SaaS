import jwt from 'jsonwebtoken';
import db from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'lumina-photographer-super-secret-key-92837482';

export function authenticatePhotographer(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify account exists and is not suspended
    const photographer = db.prepare('SELECT id, email, status, suspension_reason FROM photographer WHERE id = ?').get(decoded.id);
    if (!photographer) {
      return res.status(401).json({ error: 'Account no longer exists' });
    }

    if (photographer.status === 'suspended') {
      return res.status(403).json({
        error: 'Account Suspended',
        message: photographer.suspension_reason
          ? `Your photographer account has been suspended: ${photographer.suspension_reason}. Please contact customer support.`
          : 'Your photographer account is currently suspended. Please contact customer support.',
      });
    }

    req.photographer = { ...decoded, ...photographer };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

export function signPhotographerToken(payload) {
  return jwt.sign({ ...payload, role: 'photographer' }, JWT_SECRET, { expiresIn: '7d' });
}
