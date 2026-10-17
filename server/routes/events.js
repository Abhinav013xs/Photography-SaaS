import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import storage from '../storage/r2.js';
import { authenticatePhotographer } from '../middleware/auth.js';
import SelectionService from '../services/selection_service.js';

const router = express.Router();

/**
 * Generate a clean URL slug from event and client name
 */
function createEventSlug(name, clientName) {
  const base = `${name}-${clientName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${base}-${randomSuffix}`;
}

/**
 * GET /api/events
 * List all events with counts, filters, search
 */
router.get('/', authenticatePhotographer, (req, res) => {
  const { status = 'active', search = '', sort = 'date_desc' } = req.query;

  let query = `
    SELECT 
      e.*,
      (SELECT COUNT(*) FROM media WHERE event_id = e.id) as media_count,
      (SELECT COUNT(*) FROM media WHERE event_id = e.id AND type = 'photo') as photo_count,
      (SELECT COUNT(*) FROM media WHERE event_id = e.id AND type = 'video') as video_count,
      (SELECT COUNT(*) FROM folders WHERE event_id = e.id) as folder_count,
      (SELECT COUNT(*) FROM face_embeddings WHERE event_id = e.id) as face_count,
      (SELECT COALESCE(SUM(file_size), 0) FROM media WHERE event_id = e.id) as total_size_bytes,
      cover.storage_key_thumbnail as cover_thumbnail,
      cover.storage_key_preview as cover_preview
    FROM events e
    LEFT JOIN media cover ON cover.id = e.cover_photo_id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'all') {
    query += ` AND e.status = ?`;
    params.push(status);
  } else {
    // When status is 'all' or default, exclude trashed events (viewable in Recycle Bin)
    query += ` AND e.status != 'trashed'`;
  }

  if (search) {
    query += ` AND (e.name LIKE ? OR e.client_name LIKE ? OR e.description LIKE ?)`;
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  query += ` GROUP BY e.id`;

  if (sort === 'date_asc') query += ` ORDER BY e.event_date ASC`;
  else if (sort === 'name_asc') query += ` ORDER BY e.name ASC`;
  else if (sort === 'name_desc') query += ` ORDER BY e.name DESC`;
  else query += ` ORDER BY e.event_date DESC, e.created_at DESC`;

  const events = db.prepare(query).all(...params);

  const enrichedEvents = events.map((ev) => {
    // Check if public has expired in real time
    const isExpired = ev.public_until && new Date(ev.public_until) < new Date();
    return {
      ...ev,
      is_expired: isExpired,
      pin_protected: Boolean(ev.pin_enabled),
      pin_hash: undefined, // Never expose hash
    };
  });

  return res.json({ events: enrichedEvents });
});

/**
 * POST /api/events
 * Create new event
 */
router.post('/', authenticatePhotographer, (req, res) => {
  const photographer = db.prepare('SELECT status, suspension_reason FROM photographer WHERE id = ?').get(req.photographer.id);
  if (photographer && photographer.status === 'suspended') {
    return res.status(403).json({
      error: 'Account Suspended',
      message: 'Suspended photographers cannot create events. Please contact support.',
    });
  }

  const {
    name,
    client_name,
    client_email,
    event_date,
    location,
    description,
    pin_enabled = false,
    pin = '',
    visibility = 'public',
    public_days = 30,
    allow_downloads = true,
    watermark_enabled = false,
    watermark_text = 'Studio Lumina',
    face_search_enabled = true,
    client_selection_mode = 'disabled',
    selection_package_name = 'Full Collection',
    selection_package_quota = 0,
    selection_min_quota = 0,
    selection_allow_extra = false,
    selection_deadline = null,
    selection_instructions = '',
    selection_allow_changes_after_submission = true,
    selection_requires_approval = true,
    selection_multiple_rounds = true,
  } = req.body;

  if (!name || !client_name || !event_date) {
    return res.status(400).json({ error: 'Event name, client name, and event date are required' });
  }

  const eventId = uuidv4();
  const slug = createEventSlug(name, client_name);

  // Requirement 24: Max 30 days public duration enforced!
  const enforcedDays = Math.min(Math.max(parseInt(public_days, 10) || 30, 1), 30);
  const now = new Date();
  const publicStart = now.toISOString();
  const publicUntilDate = new Date(now.getTime() + enforcedDays * 24 * 60 * 60 * 1000);
  const publicUntil = publicUntilDate.toISOString();

  let pinHash = null;
  if (pin_enabled && pin) {
    const salt = bcrypt.genSaltSync(10);
    pinHash = bcrypt.hashSync(String(pin).trim(), salt);
  }

  const insertEvent = db.prepare(`
    INSERT INTO events (
      id, slug, name, client_name, client_email, event_date, location, description,
      status, visibility, public_start, public_until, pin_enabled, pin_hash,
      allow_downloads, watermark_enabled, watermark_text, face_search_enabled,
      client_selection_mode, selection_package_name, selection_package_quota,
      selection_min_quota, selection_allow_extra, selection_deadline,
      selection_instructions, selection_allow_changes_after_submission,
      selection_requires_approval, selection_multiple_rounds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertEvent.run(
    eventId,
    slug,
    name.trim(),
    client_name.trim(),
    client_email || null,
    event_date,
    location || null,
    description || null,
    visibility,
    visibility === 'public' ? publicStart : null,
    visibility === 'public' ? publicUntil : null,
    pin_enabled ? 1 : 0,
    pinHash,
    allow_downloads ? 1 : 0,
    watermark_enabled ? 1 : 0,
    watermark_text || 'Studio Lumina',
    face_search_enabled ? 1 : 0,
    client_selection_mode || 'disabled',
    selection_package_name || 'Full Collection',
    parseInt(selection_package_quota, 10) || 0,
    parseInt(selection_min_quota, 10) || 0,
    selection_allow_extra ? 1 : 0,
    selection_deadline || null,
    selection_instructions || null,
    selection_allow_changes_after_submission !== false ? 1 : 0,
    selection_requires_approval !== false ? 1 : 0,
    selection_multiple_rounds !== false ? 1 : 0
  );

  // Automatically create a default folder
  const defaultFolderId = uuidv4();
  db.prepare(`
    INSERT INTO folders (id, event_id, name, sort_order)
    VALUES (?, ?, 'Highlights', 0)
  `).run(defaultFolderId, eventId);

  const created = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  return res.status(201).json({
    event: {
      ...created,
      pin_protected: Boolean(created.pin_enabled),
      pin_hash: undefined,
    },
  });
});

/**
 * GET /api/events/bin
 * List all trashed events in the Recycle Bin
 */
router.get('/bin', authenticatePhotographer, (req, res) => {
  const events = db.prepare(`
    SELECT 
      e.*,
      (SELECT COUNT(*) FROM media WHERE event_id = e.id) as media_count,
      (SELECT COUNT(*) FROM media WHERE event_id = e.id AND type = 'photo') as photo_count,
      (SELECT COUNT(*) FROM media WHERE event_id = e.id AND type = 'video') as video_count,
      (SELECT COUNT(*) FROM face_embeddings WHERE event_id = e.id) as face_count,
      (SELECT COALESCE(SUM(file_size), 0) FROM media WHERE event_id = e.id) as total_size_bytes,
      cover.storage_key_thumbnail as cover_thumbnail
    FROM events e
    LEFT JOIN media cover ON cover.id = e.cover_photo_id
    WHERE e.status = 'trashed'
    GROUP BY e.id
    ORDER BY e.deleted_at DESC
  `).all();

  const now = Date.now();
  const enriched = events.map((ev) => {
    let daysRemaining = 30;
    if (ev.purge_after) {
      const purgeTime = new Date(ev.purge_after).getTime();
      daysRemaining = Math.max(0, Math.ceil((purgeTime - now) / (1000 * 60 * 60 * 24)));
    }
    return {
      ...ev,
      days_remaining: daysRemaining,
      is_urgent: daysRemaining <= 3,
    };
  });

  return res.json({ events: enriched, count: enriched.length });
});

const purgeEventDatabaseRecords = db.transaction((eventId) => {
  db.prepare('DELETE FROM selection_revisions WHERE selection_id IN (SELECT id FROM selection_collections WHERE event_id = ?)').run(eventId);
  db.prepare('DELETE FROM selection_items WHERE selection_id IN (SELECT id FROM selection_collections WHERE event_id = ?)').run(eventId);
  db.prepare('DELETE FROM selection_collections WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM processing_jobs WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM face_embeddings WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM media WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM folders WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
});

/**
 * POST /api/events/bin/empty
 * Permanently purge all trashed events
 */
router.post('/bin/empty', authenticatePhotographer, async (req, res) => {
  const trashedEvents = db.prepare("SELECT id, name FROM events WHERE status = 'trashed'").all();
  let deletedCount = 0;

  for (const ev of trashedEvents) {
    try {
      await storage.deleteEventStorage(ev.id);
      purgeEventDatabaseRecords(ev.id);
      deletedCount++;
    } catch (e) {
      console.error(`Failed to permanently delete trashed event ${ev.id}:`, e);
    }
  }

  return res.json({ success: true, successfullyDeleted: deletedCount });
});

/**
 * GET /api/events/:id
 * Retrieve event details, stats, folders
 */
router.get('/:id', authenticatePhotographer, (req, res) => {
  const { id } = req.params;

  const event = db.prepare(`
    SELECT 
      e.*,
      (SELECT COUNT(*) FROM media WHERE event_id = e.id) as media_count,
      (SELECT COUNT(*) FROM media WHERE event_id = e.id AND type = 'photo') as photo_count,
      (SELECT COUNT(*) FROM media WHERE event_id = e.id AND type = 'video') as video_count,
      (SELECT COUNT(*) FROM face_embeddings WHERE event_id = e.id) as face_count,
      (SELECT COALESCE(SUM(file_size), 0) FROM media WHERE event_id = e.id) as total_size_bytes,
      cover.storage_key_thumbnail as cover_thumbnail,
      cover.storage_key_preview as cover_preview
    FROM events e
    LEFT JOIN media cover ON cover.id = e.cover_photo_id
    WHERE e.id = ?
    GROUP BY e.id
  `).get(id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const folders = db.prepare(`
    SELECT 
      f.*,
      COUNT(m.id) as photo_count
    FROM folders f
    LEFT JOIN media m ON m.folder_id = f.id
    WHERE f.event_id = ?
    GROUP BY f.id
    ORDER BY f.sort_order ASC, f.created_at ASC
  `).all(id);

  // Check processing jobs
  const activeJob = db.prepare(`
    SELECT * FROM processing_jobs
    WHERE event_id = ? AND status IN ('pending', 'processing')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(id);

  return res.json({
    event: {
      ...event,
      pin_protected: Boolean(event.pin_enabled),
      pin_hash: undefined,
    },
    folders,
    activeJob: activeJob || null,
  });
});

/**
 * PUT /api/events/:id
 * Update event configuration
 */
router.put('/:id', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  const {
    name,
    client_name,
    client_email,
    event_date,
    location,
    description,
    cover_photo_id,
    visibility,
    public_days,
    public_duration_days,
    pin_enabled,
    pin,
    allow_downloads,
    allow_photo_downloads,
    allow_bulk_downloads,
    allow_video_downloads,
    watermark_enabled,
    watermark_text,
    watermark_opacity,
    watermark_size,
    watermark_position,
    watermark_color,
    face_search_enabled,
    status,
    client_selection_mode,
    selection_package_name,
    selection_package_quota,
    selection_min_quota,
    selection_allow_extra,
    selection_deadline,
    selection_instructions,
    selection_allow_changes_after_submission,
    selection_requires_approval,
    selection_multiple_rounds,
  } = req.body;

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // Visibility & Expiry handling
  let publicStart = event.public_start;
  let publicUntil = event.public_until;
  const days = public_duration_days || public_days || event.public_duration_days || 30;
  const enforcedDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 30);

  if (visibility === 'public') {
    const now = new Date();
    publicStart = event.public_start || now.toISOString();
    const until = new Date(now.getTime() + enforcedDays * 24 * 60 * 60 * 1000);
    publicUntil = until.toISOString();
  }

  let pinHash = event.pin_hash;
  if (pin_enabled !== undefined) {
    if (pin_enabled && pin) {
      const salt = bcrypt.genSaltSync(10);
      pinHash = bcrypt.hashSync(String(pin).trim(), salt);
    } else if (!pin_enabled) {
      pinHash = null;
    }
  }

  // Check watermark version increment
  let watermarkVersion = event.watermark_version || 1;
  if (
    (watermark_enabled !== undefined && (watermark_enabled ? 1 : 0) !== event.watermark_enabled) ||
    (watermark_text !== undefined && watermark_text !== event.watermark_text) ||
    (watermark_opacity !== undefined && Math.abs(Number(watermark_opacity) - Number(event.watermark_opacity || 0.40)) > 0.01) ||
    (watermark_size !== undefined && watermark_size !== event.watermark_size) ||
    (watermark_position !== undefined && watermark_position !== event.watermark_position) ||
    (watermark_color !== undefined && watermark_color !== event.watermark_color)
  ) {
    watermarkVersion += 1;
  }

  db.prepare(`
    UPDATE events SET
      name = COALESCE(?, name),
      client_name = COALESCE(?, client_name),
      client_email = COALESCE(?, client_email),
      event_date = COALESCE(?, event_date),
      location = COALESCE(?, location),
      description = COALESCE(?, description),
      cover_photo_id = ?,
      visibility = COALESCE(?, visibility),
      status = COALESCE(?, status),
      public_start = COALESCE(?, public_start),
      public_until = COALESCE(?, public_until),
      public_duration_days = COALESCE(?, public_duration_days),
      pin_enabled = COALESCE(?, pin_enabled),
      pin_hash = ?,
      allow_downloads = COALESCE(?, allow_downloads),
      allow_photo_downloads = COALESCE(?, allow_photo_downloads),
      allow_bulk_downloads = COALESCE(?, allow_bulk_downloads),
      allow_video_downloads = COALESCE(?, allow_video_downloads),
      watermark_enabled = COALESCE(?, watermark_enabled),
      watermark_text = COALESCE(?, watermark_text),
      watermark_opacity = COALESCE(?, watermark_opacity),
      watermark_size = COALESCE(?, watermark_size),
      watermark_position = COALESCE(?, watermark_position),
      watermark_color = COALESCE(?, watermark_color),
      watermark_version = ?,
      face_search_enabled = COALESCE(?, face_search_enabled),
      client_selection_mode = COALESCE(?, client_selection_mode),
      selection_package_name = COALESCE(?, selection_package_name),
      selection_package_quota = COALESCE(?, selection_package_quota),
      selection_min_quota = COALESCE(?, selection_min_quota),
      selection_allow_extra = COALESCE(?, selection_allow_extra),
      selection_deadline = COALESCE(?, selection_deadline),
      selection_instructions = COALESCE(?, selection_instructions),
      selection_allow_changes_after_submission = COALESCE(?, selection_allow_changes_after_submission),
      selection_requires_approval = COALESCE(?, selection_requires_approval),
      selection_multiple_rounds = COALESCE(?, selection_multiple_rounds),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : null,
    client_name !== undefined ? client_name.trim() : null,
    client_email !== undefined ? client_email : null,
    event_date || null,
    location !== undefined ? location : null,
    description !== undefined ? description : null,
    cover_photo_id !== undefined ? cover_photo_id : event.cover_photo_id,
    visibility || null,
    status || null,
    publicStart,
    publicUntil,
    enforcedDays,
    pin_enabled !== undefined ? (pin_enabled ? 1 : 0) : null,
    pinHash,
    allow_downloads !== undefined ? (allow_downloads ? 1 : 0) : null,
    allow_photo_downloads !== undefined ? (allow_photo_downloads ? 1 : 0) : null,
    allow_bulk_downloads !== undefined ? (allow_bulk_downloads ? 1 : 0) : null,
    allow_video_downloads !== undefined ? (allow_video_downloads ? 1 : 0) : null,
    watermark_enabled !== undefined ? (watermark_enabled ? 1 : 0) : null,
    watermark_text !== undefined ? watermark_text : null,
    watermark_opacity !== undefined ? Number(watermark_opacity) : null,
    watermark_size || null,
    watermark_position || null,
    watermark_color || null,
    watermarkVersion,
    face_search_enabled !== undefined ? (face_search_enabled ? 1 : 0) : null,
    client_selection_mode !== undefined ? client_selection_mode : null,
    selection_package_name !== undefined ? selection_package_name : null,
    selection_package_quota !== undefined ? parseInt(selection_package_quota, 10) : null,
    selection_min_quota !== undefined ? parseInt(selection_min_quota, 10) : null,
    selection_allow_extra !== undefined ? (selection_allow_extra ? 1 : 0) : null,
    selection_deadline !== undefined ? selection_deadline : null,
    selection_instructions !== undefined ? selection_instructions : null,
    selection_allow_changes_after_submission !== undefined ? (selection_allow_changes_after_submission ? 1 : 0) : null,
    selection_requires_approval !== undefined ? (selection_requires_approval ? 1 : 0) : null,
    selection_multiple_rounds !== undefined ? (selection_multiple_rounds ? 1 : 0) : null,
    id
  );

  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  const isExpired = updated.public_until && new Date(updated.public_until) < new Date();
  return res.json({
    event: {
      ...updated,
      is_expired: isExpired,
      pin_protected: Boolean(updated.pin_enabled),
      allow_downloads: Boolean(updated.allow_downloads),
      allow_photo_downloads: updated.allow_photo_downloads !== 0,
      allow_bulk_downloads: updated.allow_bulk_downloads !== 0,
      allow_video_downloads: updated.allow_video_downloads !== 0,
      watermark_enabled: Boolean(updated.watermark_enabled),
      face_search_enabled: Boolean(updated.face_search_enabled),
      pin_hash: undefined,
    },
  });
});

/**
 * PATCH /api/events/:id/visibility
 * Update event visibility specifically ('public' | 'private')
 */
router.patch('/:id/visibility', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  const { visibility, public_duration_days } = req.body;

  if (visibility !== 'public' && visibility !== 'private') {
    return res.status(400).json({ error: "Visibility must be either 'public' or 'private'" });
  }

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  let publicStart = event.public_start;
  let publicUntil = event.public_until;
  const days = public_duration_days || event.public_duration_days || 30;
  const enforcedDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 30);

  if (visibility === 'public') {
    const now = new Date();
    publicStart = event.public_start || now.toISOString();
    publicUntil = new Date(now.getTime() + enforcedDays * 24 * 60 * 60 * 1000).toISOString();
  }

  db.prepare(`
    UPDATE events SET
      visibility = ?,
      public_start = ?,
      public_until = ?,
      public_duration_days = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(visibility, publicStart, publicUntil, enforcedDays, id);

  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  const isExpired = updated.public_until && new Date(updated.public_until) < new Date();
  return res.json({
    event: {
      ...updated,
      is_expired: isExpired,
      pin_protected: Boolean(updated.pin_enabled),
      pin_hash: undefined,
    },
  });
});

/**
 * POST /api/events/:id/publish
 */
router.post('/:id/publish', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  const { public_duration_days } = req.body;
  const days = Math.min(Math.max(parseInt(public_duration_days, 10) || 30, 1), 30);
  const now = new Date();
  const publicStart = now.toISOString();
  const publicUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    UPDATE events SET
      visibility = 'public',
      status = 'active',
      public_start = ?,
      public_until = ?,
      public_duration_days = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(publicStart, publicUntil, days, id);

  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  return res.json({
    event: {
      ...updated,
      is_expired: false,
      pin_protected: Boolean(updated.pin_enabled),
      pin_hash: undefined,
    },
  });
});

/**
 * POST /api/events/:id/unpublish
 */
router.post('/:id/unpublish', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  db.prepare(`
    UPDATE events SET
      visibility = 'private',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  return res.json({
    event: {
      ...updated,
      pin_protected: Boolean(updated.pin_enabled),
      pin_hash: undefined,
    },
  });
});

/**
 * POST /api/events/:id/archive
 */
router.post('/:id/archive', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  db.prepare(`UPDATE events SET status = 'archived', visibility = 'private', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  return res.json({ success: true, message: 'Event archived successfully' });
});

/**
 * POST /api/events/:id/unarchive
 */
router.post('/:id/unarchive', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  db.prepare(`UPDATE events SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  return res.json({ success: true, message: 'Event restored to active successfully' });
});

/**
 * POST /api/events/:id/trash
 * Move event to Recycle Bin
 */
router.post('/:id/trash', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const now = new Date();
  const purgeAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  db.prepare(`
    UPDATE events
    SET status = 'trashed',
        visibility = 'private',
        deleted_at = ?,
        purge_after = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(now.toISOString(), purgeAfter.toISOString(), id);

  console.log(`[Recycle Bin] Moved event "${event.name}" (${id}) to Recycle Bin.`);
  return res.json({ success: true, message: 'Event moved to Recycle Bin' });
});

/**
 * POST /api/events/:id/restore
 * Restore event from Recycle Bin or Archive
 */
router.post('/:id/restore', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  db.prepare(`
    UPDATE events
    SET status = 'active',
        deleted_at = NULL,
        purge_after = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  console.log(`[Lifecycle] Restored event "${event.name}" (${id}) to active state.`);
  return res.json({ success: true, message: 'Event restored successfully' });
});

/**
 * DELETE /api/events/:id/permanent
 * Permanently delete event
 */
router.delete('/:id/permanent', authenticatePhotographer, async (req, res) => {
  const { id } = req.params;
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  await storage.deleteEventStorage(id);
  purgeEventDatabaseRecords(id);

  console.log(`[Recycle Bin] Permanently deleted event "${event.name}" (${id}).`);
  return res.json({ success: true, message: 'Event permanently deleted' });
});

/**
 * DELETE /api/events/:id
 * PERMANENT DELETION (Requirement 26)
 */
router.delete('/:id', authenticatePhotographer, async (req, res) => {
  const { id } = req.params;
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // 1. Delete physical/R2 storage files
  await storage.deleteEventStorage(id);

  // 2. Cascade delete records from SQLite atomically
  purgeEventDatabaseRecords(id);

  console.log(`[Event Deletion] Permanently deleted event "${event.name}" (${id}) and all associated storage.`);
  return res.json({ success: true, message: 'Event permanently deleted' });
});

/**
 * GET /api/events/:id/qr
 * Generate QR code for sharing
 */
router.get('/:id/qr', authenticatePhotographer, async (req, res) => {
  const { id } = req.params;
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const appHost = (process.env.APP_URL || process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const shareUrl = `${appHost}/gallery/${encodeURIComponent(event.slug)}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(shareUrl, {
      width: 1000,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0a0b0d',
        light: '#ffffff',
      },
    });

    const qrSvg = await QRCode.toString(shareUrl, {
      type: 'svg',
      width: 1000,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0a0b0d',
        light: '#ffffff',
      },
    });

    const isExpired = event.public_until ? new Date(event.public_until).getTime() < Date.now() : false;

    return res.json({
      shareUrl,
      qrDataUrl,
      qrSvg,
      eventName: event.name,
      clientName: event.client_name,
      eventDate: event.event_date,
      pinProtected: Boolean(event.pin_enabled),
      visibility: event.visibility,
      isExpired,
      publicUntil: event.public_until,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// ==================== FOLDER MANAGEMENT ====================

/**
 * GET /api/events/:id/folders
 */
router.get('/:id/folders', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  const folders = db.prepare(`
    SELECT f.*, COUNT(m.id) as photo_count
    FROM folders f
    LEFT JOIN media m ON m.folder_id = f.id
    WHERE f.event_id = ?
    GROUP BY f.id
    ORDER BY f.sort_order ASC, f.created_at ASC
  `).all(id);

  return res.json({ folders });
});

/**
 * POST /api/events/:id/folders
 */
router.post('/:id/folders', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  const folderId = uuidv4();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM folders WHERE event_id = ?').get(id);
  const sortOrder = (maxOrder?.m || 0) + 1;

  db.prepare(`
    INSERT INTO folders (id, event_id, name, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(folderId, id, name.trim(), sortOrder);

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
  return res.status(201).json({ folder: { ...folder, photo_count: 0 } });
});

/**
 * PUT /api/events/:id/folders/:folderId
 * Update folder with strict event scoping
 */
router.put('/:id/folders/:folderId', authenticatePhotographer, (req, res) => {
  const { id, folderId } = req.params;
  const { name, sort_order } = req.body;

  const existing = db.prepare('SELECT id FROM folders WHERE id = ? AND event_id = ?').get(folderId, id);
  if (!existing) {
    return res.status(404).json({ error: 'Folder not found in this event' });
  }

  db.prepare(`
    UPDATE folders SET
      name = COALESCE(?, name),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ? AND event_id = ?
  `).run(name ? name.trim() : null, sort_order, folderId, id);

  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND event_id = ?').get(folderId, id);
  return res.json({ folder });
});

/**
 * DELETE /api/events/:id/folders/:folderId
 * Safe folder deletion with strict event scoping (Requirement 7: media is preserved!)
 */
router.delete('/:id/folders/:folderId', authenticatePhotographer, (req, res) => {
  const { id, folderId } = req.params;
  const { targetFolderId } = req.query; // Optional reassignment target

  const existing = db.prepare('SELECT id FROM folders WHERE id = ? AND event_id = ?').get(folderId, id);
  if (!existing) {
    return res.status(404).json({ error: 'Folder not found in this event' });
  }

  // Safely reassign media to targetFolderId or NULL (Uncategorized)
  if (targetFolderId && targetFolderId !== folderId) {
    const targetFolder = db.prepare('SELECT id FROM folders WHERE id = ? AND event_id = ?').get(targetFolderId, id);
    if (!targetFolder) {
      return res.status(400).json({ error: 'Target folder must belong to the same event' });
    }
    db.prepare('UPDATE media SET folder_id = ? WHERE folder_id = ? AND event_id = ?').run(targetFolderId, folderId, id);
  } else {
    db.prepare('UPDATE media SET folder_id = NULL WHERE folder_id = ? AND event_id = ?').run(folderId, id);
  }

  db.prepare('DELETE FROM folders WHERE id = ? AND event_id = ?').run(folderId, id);

  return res.json({ success: true, message: 'Folder deleted safely; media preserved.' });
});

/**
 * Phase 46: Photographer Selection & Proofing Management Endpoints
 */

/**
 * GET /api/events/:id/selections
 * List all client selection collections for an event
 */
router.get('/:id/selections', authenticatePhotographer, (req, res) => {
  const { id } = req.params;
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const selections = db.prepare(`
    SELECT 
      sc.*,
      (SELECT COUNT(*) FROM selection_revisions sr WHERE sr.selection_id = sc.id) as revision_count
    FROM selection_collections sc
    WHERE sc.event_id = ?
    ORDER BY sc.updated_at DESC
  `).all(id);

  return res.json({ selections, totalCount: selections.length });
});

/**
 * GET /api/events/:id/selections/:selectionId
 * Retrieve detailed client selection with revisions
 */
router.get('/:id/selections/:selectionId', authenticatePhotographer, (req, res) => {
  const { id, selectionId } = req.params;
  const selection = db.prepare(`
    SELECT * FROM selection_collections WHERE id = ? AND event_id = ?
  `).get(selectionId, id);

  if (!selection) return res.status(404).json({ error: 'Selection collection not found' });

  const revisions = db.prepare(`
    SELECT * FROM selection_revisions WHERE selection_id = ? ORDER BY version DESC
  `).all(selectionId);

  return res.json({ selection, revisions });
});

/**
 * GET /api/events/:id/selections/:selectionId/photos
 * Retrieve media objects for items in this selection
 */
router.get('/:id/selections/:selectionId/photos', authenticatePhotographer, (req, res) => {
  const { id, selectionId } = req.params;
  const selection = db.prepare(`
    SELECT id FROM selection_collections WHERE id = ? AND event_id = ?
  `).get(selectionId, id);

  if (!selection) return res.status(404).json({ error: 'Selection collection not found' });

  const filter = req.query.filter === 'favorites' ? 'favorites' : 'selected';
  const photos = SelectionService.getSelectionPhotos(selectionId, filter);

  return res.json({ filter, totalCount: photos.length, photos });
});

/**
 * POST /api/events/:id/selections/:selectionId/approve
 * Approves client selection
 */
router.post('/:id/selections/:selectionId/approve', authenticatePhotographer, (req, res) => {
  const { id, selectionId } = req.params;
  try {
    const updated = SelectionService.approveSelection(id, selectionId);
    return res.json({ success: true, selection: updated });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/events/:id/selections/:selectionId/request-changes
 * Requests changes from client with feedback
 */
router.post('/:id/selections/:selectionId/request-changes', authenticatePhotographer, (req, res) => {
  const { id, selectionId } = req.params;
  const { feedback } = req.body;
  try {
    const updated = SelectionService.requestChanges(id, selectionId, feedback);
    return res.json({ success: true, selection: updated });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/events/:id/selections/:selectionId/delivery
 * Updates final delivery package status and link
 */
router.post('/:id/selections/:selectionId/delivery', authenticatePhotographer, (req, res) => {
  const { id, selectionId } = req.params;
  try {
    const updated = SelectionService.updateDelivery(id, selectionId, req.body);
    return res.json({ success: true, selection: updated });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/events/:id/selections/:selectionId/reconcile
 * Reconciles count integrity
 */
router.post('/:id/selections/:selectionId/reconcile', authenticatePhotographer, (req, res) => {
  const { id, selectionId } = req.params;
  const selection = db.prepare('SELECT id FROM selection_collections WHERE id = ? AND event_id = ?').get(selectionId, id);
  if (!selection) return res.status(404).json({ error: 'Selection collection not found' });

  const result = SelectionService.reconcileSelectionCounts(selectionId);
  return res.json({ success: true, result });
});

export default router;

