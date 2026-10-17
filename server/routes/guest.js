import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { searchBySelfie } from '../ai/face_service.js';
import SelectionService from '../services/selection_service.js';

const GUEST_JWT_SECRET = process.env.GUEST_JWT_SECRET || 'guest-session-secret-key-1928374';
const uploadSelfie = multer({
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max selfie
});

const router = express.Router();

// Helper to extract or generate stable guest session id
function getGuestSessionId(req) {
  return req.headers['x-guest-session-id'] || req.cookies?.guest_session_id || 'guest_session_' + (req.ip || 'default');
}

// In-memory rate limiting map for PIN attempts to prevent brute force
const pinAttempts = new Map();

/**
 * Middleware: Check PIN authorization if event has PIN enabled
 */
function verifyGuestAccess(req, res, next) {
  const { slug } = req.params;
  const event = db.prepare('SELECT id, status, visibility, public_until, pin_enabled FROM events WHERE slug = ?').get(slug);

  if (!event) {
    return res.status(404).json({ error: 'Gallery not found' });
  }

  // 1. Check status & visibility
  if (event.status !== 'active' || event.visibility !== 'public') {
    return res.status(403).json({ error: 'This gallery is currently private.' });
  }

  // 2. Check public expiry
  if (event.public_until && new Date(event.public_until) < new Date()) {
    return res.status(410).json({ error: 'This gallery public viewing period has expired.' });
  }

  // 3. Check PIN protection
  if (event.pin_enabled) {
    const authHeader = req.headers['x-guest-token'];
    if (!authHeader) {
      return res.status(401).json({ requiresPin: true, error: 'Event PIN required' });
    }

    try {
      const decoded = jwt.verify(authHeader, GUEST_JWT_SECRET);
      if (decoded.eventId !== event.id) {
        return res.status(401).json({ requiresPin: true, error: 'Invalid PIN session' });
      }
    } catch (e) {
      return res.status(401).json({ requiresPin: true, error: 'PIN session expired' });
    }
  }

  req.event = event;
  next();
}

/**
 * GET /api/guest/event/:slug
 * Public metadata for event
 */
router.get('/event/:slug', (req, res) => {
  const { slug } = req.params;
  const event = db.prepare(`
    SELECT 
      e.id, e.slug, e.name, e.client_name, e.event_date, e.location,
      e.description, e.cover_photo_id, e.status, e.visibility,
      e.public_until, e.pin_enabled, e.allow_downloads,
      e.watermark_enabled, e.watermark_text, e.face_search_enabled,
      e.client_selection_mode, e.selection_package_name, e.selection_package_quota,
      e.selection_min_quota, e.selection_allow_extra, e.selection_deadline,
      e.selection_instructions, e.selection_allow_changes_after_submission,
      e.selection_requires_approval, e.selection_multiple_rounds,
      cover.storage_key_preview as cover_preview,
      p.business_name, p.tagline, p.instagram, p.website
    FROM events e
    CROSS JOIN photographer p
    LEFT JOIN media cover ON cover.id = e.cover_photo_id
    WHERE e.slug = ?
  `).get(slug);

  if (!event) {
    return res.status(404).json({ error: 'Gallery not found' });
  }

  // Check if private or archived
  if (event.status !== 'active' || event.visibility !== 'public') {
    return res.status(403).json({
      error: 'This gallery is currently private.',
      name: event.name,
      business_name: event.business_name,
    });
  }

  // Check public expiry
  const isExpired = event.public_until && new Date(event.public_until) < new Date();
  if (isExpired) {
    return res.status(410).json({
      error: 'The public viewing period for this gallery has expired.',
      name: event.name,
      business_name: event.business_name,
    });
  }

  return res.json({
    event: {
      ...event,
      pin_protected: Boolean(event.pin_enabled),
      pin_hash: undefined,
    },
  });
});

/**
 * POST /api/guest/verify-pin/:slug
 * Verify guest event PIN with brute force rate limiting
 */
router.post('/verify-pin/:slug', (req, res) => {
  const { slug } = req.params;
  const { pin } = req.body;

  const event = db.prepare('SELECT id, status, visibility, pin_enabled, pin_hash FROM events WHERE slug = ?').get(slug);
  if (!event) {
    return res.status(404).json({ error: 'Gallery not found' });
  }

  // 1. Check status & visibility
  if (event.status !== 'active' || event.visibility !== 'public') {
    return res.status(403).json({ error: 'This gallery is currently private.' });
  }

  if (!event.pin_enabled) {
    // No PIN needed
    const token = jwt.sign({ eventId: event.id, role: 'guest' }, GUEST_JWT_SECRET, { expiresIn: '12h' });
    res.cookie(`guest_session_${event.id}`, token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
    return res.json({ success: true, guestToken: token });
  }

  // Fails closed if PIN enabled but no hash is present
  if (!event.pin_hash) {
    return res.status(403).json({ error: 'Gallery is PIN protected but is not properly configured.' });
  }

  // Rate limiting per IP + event (max 5 failed attempts in 15 mins)
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const rateKey = `${clientIp}_${event.id}`;
  const now = Date.now();
  const attemptRecord = pinAttempts.get(rateKey) || { count: 0, resetAt: now + 15 * 60 * 1000 };

  if (attemptRecord.count >= 5 && now < attemptRecord.resetAt) {
    const minutesLeft = Math.ceil((attemptRecord.resetAt - now) / 60000);
    const retryAfter = Math.ceil((attemptRecord.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfter.toString());
    return res.status(429).json({
      error: `Too many incorrect PIN attempts. Please wait ${minutesLeft} minutes before trying again.`,
    });
  }

  if (now > attemptRecord.resetAt) {
    attemptRecord.count = 0;
    attemptRecord.resetAt = now + 15 * 60 * 1000;
  }

  const cleanPin = typeof pin === 'string' ? pin.trim() : '';
  if (!cleanPin || !/^\d{4,8}$/.test(cleanPin) || !bcrypt.compareSync(cleanPin, event.pin_hash)) {
    attemptRecord.count += 1;
    pinAttempts.set(rateKey, attemptRecord);
    return res.status(401).json({ error: 'Incorrect PIN. Please try again.' });
  }

  // Success: clear rate limit record & grant guest token
  pinAttempts.delete(rateKey);
  const token = jwt.sign({ eventId: event.id, role: 'guest' }, GUEST_JWT_SECRET, { expiresIn: '12h' });
  res.cookie(`guest_session_${event.id}`, token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });

  return res.json({ success: true, guestToken: token });
});

/**
 * POST /api/guest/session/clear/:eventId
 * Clears guest session cookie
 */
router.post('/session/clear/:eventId', (req, res) => {
  const { eventId } = req.params;
  res.clearCookie(`guest_session_${eventId}`);
  return res.json({ success: true, message: 'Guest session cleared' });
});

/**
 * GET /api/guest/gallery/:slug
 * Fetch gallery folders and media (protected by verifyGuestAccess)
 */
router.get('/gallery/:slug', verifyGuestAccess, (req, res) => {
  const event = req.event;
  const { folderId } = req.query;

  const folders = db.prepare(`
    SELECT f.*, COUNT(m.id) as photo_count
    FROM folders f
    LEFT JOIN media m ON m.folder_id = f.id AND m.status = 'ready'
    WHERE f.event_id = ?
    GROUP BY f.id
    ORDER BY f.sort_order ASC, f.created_at ASC
  `).all(event.id);

  let mediaSql = `
    SELECT 
      m.id, m.event_id, m.folder_id, m.type, m.original_name,
      m.width, m.height, m.storage_key_preview, m.storage_key_thumbnail,
      m.camera_make, m.camera_model, m.date_taken, m.created_at,
      f.name as folder_name
    FROM media m
    LEFT JOIN folders f ON m.folder_id = f.id
    WHERE m.event_id = ? AND m.status = 'ready'
  `;
  const mediaParams = [event.id];

  if (folderId && folderId !== 'all') {
    if (folderId === 'uncategorized') {
      mediaSql += ` AND m.folder_id IS NULL`;
    } else {
      mediaSql += ` AND m.folder_id = ?`;
      mediaParams.push(folderId);
    }
  }

  mediaSql += ` ORDER BY m.created_at ASC`;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(0, parseInt(req.query.limit, 10) || 0);

  if (limit > 0) {
    const countSql = `
      SELECT COUNT(*) as total
      FROM media m
      WHERE m.event_id = ? AND m.status = 'ready'
      ${folderId && folderId !== 'all' ? (folderId === 'uncategorized' ? 'AND m.folder_id IS NULL' : 'AND m.folder_id = ?') : ''}
    `;
    const countParams = [event.id];
    if (folderId && folderId !== 'all' && folderId !== 'uncategorized') countParams.push(folderId);

    const totalCount = db.prepare(countSql).get(...countParams)?.total || 0;
    const offset = (page - 1) * limit;

    mediaSql += ` LIMIT ? OFFSET ?`;
    mediaParams.push(limit, offset);

    const mediaList = db.prepare(mediaSql).all(...mediaParams);

    return res.json({
      folders,
      media: mediaList,
      totalCount,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: page * limit < totalCount,
      },
    });
  }

  const mediaList = db.prepare(mediaSql).all(...mediaParams);

  return res.json({
    folders,
    media: mediaList,
    totalCount: mediaList.length,
  });
});

// Rate limiting map for guest face searches (max 10 requests per minute per IP + event)
const faceSearchAttempts = new Map();
const FACE_SEARCH_WINDOW_MS = 60 * 1000;
const MAX_FACE_SEARCHES_PER_WINDOW = 10;

/**
 * POST /api/guest/face-search/:slug
 * AI Face Search ("Find My Photos")
 * SCOPED STRICTLY TO CURRENT EVENT (Requirement 18, 19, 20) with Rate Limiting
 */
router.post('/face-search/:slug', verifyGuestAccess, uploadSelfie.single('selfie'), async (req, res) => {
  const event = req.event;

  // Rate limiting per IP + event (max 10 searches per minute)
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const rateKey = `face_${clientIp}_${event.id}`;
  const now = Date.now();
  const timestamps = (faceSearchAttempts.get(rateKey) || []).filter((ts) => now - ts < FACE_SEARCH_WINDOW_MS);

  if (timestamps.length >= MAX_FACE_SEARCHES_PER_WINDOW) {
    const oldest = timestamps[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + FACE_SEARCH_WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', retryAfter.toString());
    return res.status(429).json({
      error: `Search rate limit exceeded. You may perform at most ${MAX_FACE_SEARCHES_PER_WINDOW} face searches per minute.`,
    });
  }

  timestamps.push(now);
  faceSearchAttempts.set(rateKey, timestamps);

  // Check if face search is enabled for this event
  const eventConfig = db.prepare('SELECT face_search_enabled FROM events WHERE id = ?').get(event.id);
  if (!eventConfig || !eventConfig.face_search_enabled) {
    return res.status(403).json({ error: 'AI face search is not enabled for this gallery.' });
  }

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'Please upload or capture a selfie.' });
  }

  try {
    // STRICT EVENT ISOLATION: searchBySelfie queries ONLY embeddings with WHERE event_id = ?
    const searchResult = await searchBySelfie(event.id, req.file.buffer);

    return res.json(searchResult);
  } catch (err) {
    console.error(`[Guest Face Search Error] Event ${event.id}:`, err);
    return res.status(500).json({ error: 'An error occurred during face recognition. Please try another selfie.' });
  }
});

/**
 * Phase 46: Client Photo Selection, Proofing & Favorites Endpoints
 */

/**
 * GET /api/guest/selection/:slug
 * Retrieves active selection state, configuration, items, and revisions for the guest session.
 */
router.get('/selection/:slug', verifyGuestAccess, (req, res) => {
  const event = req.event;

  // Verify feature flag
  const flag = db.prepare("SELECT enabled FROM feature_flags WHERE key = 'client_selection'").get();
  if (flag && flag.enabled === 0) {
    return res.status(403).json({
      error: 'Client selection is temporarily disabled for maintenance.',
      code: 'FEATURE_DISABLED',
    });
  }

  const sessionId = getGuestSessionId(req);

  try {
    const data = SelectionService.getOrInitSelection(event.id, sessionId);
    return res.json(data);
  } catch (err) {
    console.error(`[Guest Selection Init Error] Event ${event.id}:`, err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to load selection.' });
  }
});

/**
 * POST /api/guest/selection/:slug/item
 * Toggle favorite or package selection flag on a photo item.
 */
router.post('/selection/:slug/item', verifyGuestAccess, (req, res) => {
  const event = req.event;

  // Verify feature flag
  const flag = db.prepare("SELECT enabled FROM feature_flags WHERE key = 'client_selection'").get();
  if (flag && flag.enabled === 0) {
    return res.status(403).json({
      error: 'Client selection is temporarily disabled for maintenance.',
      code: 'FEATURE_DISABLED',
    });
  }

  const sessionId = getGuestSessionId(req);

  try {
    const result = SelectionService.updateItem(event.id, sessionId, req.body);
    return res.json(result);
  } catch (err) {
    console.error(`[Guest Selection Item Error] Event ${event.id}:`, err);
    return res.status(err.status || 500).json({
      error: err.message || 'Failed to update selection item.',
      code: err.code,
      quota: err.quota,
      selectedCount: err.selectedCount,
    });
  }
});

/**
 * POST /api/guest/selection/:slug/submit
 * Submits final package selection to photographer.
 */
router.post('/selection/:slug/submit', verifyGuestAccess, (req, res) => {
  const event = req.event;

  const flag = db.prepare("SELECT enabled FROM feature_flags WHERE key = 'client_selection'").get();
  if (flag && flag.enabled === 0) {
    return res.status(403).json({
      error: 'Client selection is temporarily disabled for maintenance.',
      code: 'FEATURE_DISABLED',
    });
  }

  const sessionId = getGuestSessionId(req);

  try {
    const result = SelectionService.submitSelection(event.id, sessionId, req.body);
    return res.json(result);
  } catch (err) {
    console.error(`[Guest Selection Submit Error] Event ${event.id}:`, err);
    return res.status(err.status || 500).json({
      error: err.message || 'Failed to submit selection.',
      code: err.code,
      minQuota: err.minQuota,
      selectedCount: err.selectedCount,
    });
  }
});

/**
 * GET /api/guest/selection/:slug/photos
 * Retrieves media objects for selected or favorite items.
 */
router.get('/selection/:slug/photos', verifyGuestAccess, (req, res) => {
  const event = req.event;
  const sessionId = getGuestSessionId(req);
  const filter = req.query.filter === 'favorites' ? 'favorites' : 'selected';

  try {
    const { collection } = SelectionService.getOrInitSelection(event.id, sessionId);
    const photos = SelectionService.getSelectionPhotos(collection.id, filter);
    return res.json({
      filter,
      totalCount: photos.length,
      photos,
    });
  } catch (err) {
    console.error(`[Guest Selection Photos Error] Event ${event.id}:`, err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to retrieve selection photos.' });
  }
});

/**
 * GET /api/guest/selection/:slug/delivery
 * Accesses final delivery package when ready.
 */
router.get('/selection/:slug/delivery', verifyGuestAccess, (req, res) => {
  const event = req.event;
  const sessionId = getGuestSessionId(req);

  try {
    const { collection } = SelectionService.getOrInitSelection(event.id, sessionId);
    if (collection.delivery_status !== 'ready' && collection.delivery_status !== 'delivered') {
      return res.status(400).json({
        error: 'Final delivery has not yet been marked ready by the photographer.',
        status: collection.delivery_status,
      });
    }

    // Mark accessed
    db.prepare(`
      UPDATE selection_collections
      SET delivery_accessed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(collection.id);

    return res.json({
      success: true,
      deliveryStatus: collection.delivery_status,
      deliveryLink: collection.delivery_link,
      deliveryPreparedAt: collection.delivery_prepared_at,
      selectedCount: collection.selected_count,
      packageName: collection.package_name,
    });
  } catch (err) {
    console.error(`[Guest Selection Delivery Error] Event ${event.id}:`, err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to access delivery.' });
  }
});

export default router;

