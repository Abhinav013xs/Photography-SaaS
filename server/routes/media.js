import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const archiver = require('archiver');
import db from '../db.js';
import storage from '../storage/r2.js';
import queue from '../services/queue.js';
import { authenticatePhotographer } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_UPLOADS_DIR = path.join(__dirname, '..', '..', 'temp', 'uploads');
if (!fs.existsSync(TEMP_UPLOADS_DIR)) {
  fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
}

// Multer storage for incoming uploads
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${uuidv4()}_${safeBase}${ext}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1 GB max per file
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/tiff',
      'video/mp4', 'video/quicktime', 'video/x-msvideo'
    ];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(jpe?g|png|webp|tiff|mp4|mov|avi)$/i)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

const router = express.Router();

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'lumina-photographer-super-secret-key-92837482';
const GUEST_JWT_SECRET = process.env.GUEST_JWT_SECRET || 'guest-session-secret-key-1928374';

const DANGEROUS_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'phtml', 'phar',
  'exe', 'dll', 'so', 'dylib',
  'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'psm1',
  'cgi', 'pl', 'py', 'rb',
  'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx',
  'vbs', 'vbe', 'wsf', 'wsh',
  'jsp', 'jspx', 'asp', 'aspx', 'ashx', 'asmx',
  'cer', 'csr', 'war', 'jar', 'com', 'scr', 'msi', 'bin', 'htm', 'html', 'xhtml'
]);

function assertSafeUploadFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Filename must be a non-empty string');
  }
  if (/[\x00-\x1f\x7f]/.test(filename) || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Filename contains invalid control characters or path separators');
  }
  const parts = filename.toLowerCase().split('.');
  if (parts.length > 2) {
    for (let i = 1; i < parts.length - 1; i++) {
      if (DANGEROUS_EXTENSIONS.has(parts[i])) {
        throw new Error(`Dangerous double extension detected in "${filename}"`);
      }
    }
  }
}

function validateFileMagicBytes(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    if (bytesRead < 4) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytesRead >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
    ) {
      return 'image/png';
    }
    // WebP: RIFF....WEBP
    if (
      bytesRead >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      return 'image/webp';
    }
    // MP4 / MOV: ....ftyp
    if (
      bytesRead >= 8 &&
      buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70
    ) {
      return 'video/mp4';
    }

    return null;
  } catch (err) {
    return null;
  }
}

function checkDownloadAuthorization(event, req) {
  // 1. Operational status
  if (event.status !== 'active') {
    return { allowed: false, status: 403, error: 'This gallery is currently unavailable.' };
  }

  // 2. Visibility
  if (event.visibility !== 'public') {
    return { allowed: false, status: 403, error: 'This gallery is currently private.' };
  }

  // 3. Expiry
  if (event.public_until && new Date(event.public_until) < new Date()) {
    return { allowed: false, status: 410, error: 'The public viewing period for this gallery has expired.' };
  }

  // 4. PIN Authorization
  if (event.pin_enabled) {
    let authorized = false;
    // Check photographer auth first
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token;
    const rawToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (typeof queryToken === 'string' ? queryToken : null);
    if (rawToken) {
      try {
        const decoded = jwt.verify(rawToken, JWT_SECRET);
        if (decoded && (decoded.role === 'photographer' || decoded.id || decoded.sub)) {
          authorized = true;
        }
      } catch (e) {}
    }
    if (!authorized && req.cookies && req.cookies.studio_session) {
      try {
        const decoded = jwt.verify(req.cookies.studio_session, JWT_SECRET);
        if (decoded && (decoded.role === 'photographer' || decoded.id || decoded.sub)) {
          authorized = true;
        }
      } catch (e) {}
    }

    if (!authorized) {
      const guestToken = req.headers['x-guest-token'] || (req.cookies && req.cookies[`guest_session_${event.id}`]);
      if (!guestToken) {
        return { allowed: false, status: 401, error: 'Event PIN session required' };
      }
      try {
        const decoded = jwt.verify(guestToken, GUEST_JWT_SECRET);
        if (decoded.eventId !== event.id) {
          return { allowed: false, status: 401, error: 'Invalid PIN session token' };
        }
      } catch (e) {
        return { allowed: false, status: 401, error: 'PIN session expired' };
      }
    }
  }

  return { allowed: true };
}

/**
 * GET /api/media/stream
 * Stream image or video object with strict event visibility and access authorization.
 */
router.get('/stream', async (req, res) => {
  const { key } = req.query;
  if (!key) {
    return res.status(400).send('Storage key required');
  }

  const keyStr = String(key).trim();
  const parts = keyStr.split('/');

  // Reject invalid storage format or non-event storage keys
  if (parts.length !== 4 || parts[0] !== 'events') {
    return res.status(400).send('Invalid storage key format');
  }

  const eventId = parts[1];

  // Check if caller is authenticated photographer
  let isPhotographer = false;
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;
  const rawToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (typeof queryToken === 'string' ? queryToken : null);
  if (rawToken) {
    try {
      const decoded = jwt.verify(rawToken, JWT_SECRET);
      if (decoded && (decoded.role === 'photographer' || decoded.id || decoded.sub)) {
        isPhotographer = true;
      }
    } catch (e) {}
  }

  if (!isPhotographer && req.cookies && req.cookies.studio_session) {
    try {
      const decoded = jwt.verify(req.cookies.studio_session, JWT_SECRET);
      if (decoded && (decoded.role === 'photographer' || decoded.id || decoded.sub)) {
        isPhotographer = true;
      }
    } catch (e) {}
  }

  // If not authenticated photographer: enforce guest access rules
  if (!isPhotographer) {
    const event = db.prepare('SELECT id, status, visibility, public_until, pin_enabled FROM events WHERE id = ?').get(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Gallery not found' });
    }

    // Deny access if event is not active or is private
    if (event.status !== 'active' || event.visibility !== 'public') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.status(403).json({ error: 'This gallery is currently private.' });
    }

    // Check expiry
    if (event.public_until && new Date(event.public_until) < new Date()) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.status(410).json({ error: 'This gallery public viewing period has expired.' });
    }

    // If PIN protected, require valid guest token
    if (event.pin_enabled) {
      const guestToken = req.headers['x-guest-token'] || (req.cookies && req.cookies[`guest_session_${eventId}`]);
      if (!guestToken) {
        return res.status(401).json({ requiresPin: true, error: 'Event PIN required' });
      }
      try {
        const decoded = jwt.verify(guestToken, GUEST_JWT_SECRET);
        if (decoded.eventId !== eventId) {
          return res.status(401).json({ requiresPin: true, error: 'Invalid PIN session' });
        }
      } catch (e) {
        return res.status(401).json({ requiresPin: true, error: 'PIN session expired' });
      }
    }
  }

  try {
    const obj = await storage.getObject(keyStr);
    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300'); // Short cache window to allow privacy invalidation
    return res.send(obj.buffer);
  } catch (err) {
    return res.status(404).send('Resource not found');
  }
});


/**
 * GET /api/media/event/:eventId
 * Retrieve media list for an event (photographer view)
 */
router.get('/event/:eventId', authenticatePhotographer, (req, res) => {
  const { eventId } = req.params;
  const { folderId, type } = req.query;

  let sql = `
    SELECT m.*, f.name as folder_name
    FROM media m
    LEFT JOIN folders f ON m.folder_id = f.id
    WHERE m.event_id = ?
  `;
  const params = [eventId];

  if (folderId === 'null' || folderId === 'uncategorized') {
    sql += ` AND m.folder_id IS NULL`;
  } else if (folderId) {
    sql += ` AND m.folder_id = ?`;
    params.push(folderId);
  }

  if (type) {
    sql += ` AND m.type = ?`;
    params.push(type);
  }

  sql += ` ORDER BY m.created_at DESC`;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(0, parseInt(req.query.limit, 10) || 0);

  if (limit > 0) {
    const countSql = `
      SELECT COUNT(*) as total
      FROM media m
      ${folderId ? 'LEFT JOIN folders f ON m.folder_id = f.id' : ''}
      WHERE m.event_id = ?
      ${folderId === 'null' || folderId === 'uncategorized' ? 'AND m.folder_id IS NULL' : (folderId ? 'AND m.folder_id = ?' : '')}
      ${type ? 'AND m.type = ?' : ''}
    `;
    const countParams = [eventId];
    if (folderId && folderId !== 'null' && folderId !== 'uncategorized') countParams.push(folderId);
    if (type) countParams.push(type);

    const totalCount = db.prepare(countSql).get(...countParams)?.total || 0;
    const offset = (page - 1) * limit;

    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const mediaList = db.prepare(sql).all(...params);
    return res.json({
      media: mediaList,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: page * limit < totalCount,
      },
    });
  }

  const mediaList = db.prepare(sql).all(...params);
  return res.json({ media: mediaList });
});

/**
 * POST /api/media/upload/:eventId
 * Batch upload media files
 */
router.post('/upload/:eventId', authenticatePhotographer, upload.array('files', 100), async (req, res) => {
  const photographer = db.prepare('SELECT status, suspension_reason FROM photographer WHERE id = ?').get(req.photographer.id);
  if (photographer && photographer.status === 'suspended') {
    const filesToClean = req.files || [];
    for (const f of filesToClean) {
      try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) {}
    }
    return res.status(403).json({
      error: 'Account Suspended',
      message: 'Suspended photographers cannot upload media. Please contact support.',
    });
  }

  const { eventId } = req.params;
  const { folderId } = req.body;

  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  // Pre-validate all uploaded files for safe filenames and true binary magic bytes
  for (const f of files) {
    try {
      assertSafeUploadFilename(f.originalname);
    } catch (err) {
      // Clean up uploaded temp files
      for (const fileToClean of files) {
        try { if (fs.existsSync(fileToClean.path)) fs.unlinkSync(fileToClean.path); } catch (e) {}
      }
      return res.status(400).json({ error: `Rejected file: ${err.message}` });
    }

    const detectedMime = validateFileMagicBytes(f.path);
    if (!detectedMime) {
      // Clean up uploaded temp files
      for (const fileToClean of files) {
        try { if (fs.existsSync(fileToClean.path)) fs.unlinkSync(fileToClean.path); } catch (e) {}
      }
      return res.status(400).json({ error: `File "${f.originalname}" is corrupt or has an invalid binary signature.` });
    }
  }

  const mediaIds = [];
  const insertStmt = db.prepare(`
    INSERT INTO media (
      id, event_id, folder_id, type, filename, original_name,
      mime_type, file_size, storage_key_original, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')
  `);

  const insertTransaction = db.transaction((fileList) => {
    for (const f of fileList) {
      const mediaId = uuidv4();
      const detectedMime = validateFileMagicBytes(f.path) || f.mimetype;
      const isVideo = detectedMime.startsWith('video/') || f.originalname.match(/\.(mp4|mov|avi)$/i);
      const mediaType = isVideo ? 'video' : 'photo';

      insertStmt.run(
        mediaId,
        eventId,
        folderId || null,
        mediaType,
        path.basename(f.path),
        f.originalname,
        detectedMime,
        f.size,
        f.path // Temporarily holds disk path until processed
      );
      mediaIds.push(mediaId);
    }
  });

  insertTransaction(files);

  // Create queue job
  const jobId = queue.createJob(eventId, mediaIds, 'media_processing');

  // Trigger worker loop immediately
  queue.processNextBatch().catch(console.error);

  return res.status(201).json({
    success: true,
    uploadedCount: files.length,
    jobId,
    mediaIds,
  });
});

/**
 * PUT /api/media/move
 * Move photos to another folder with strict event boundary enforcement
 */
router.put('/move', authenticatePhotographer, (req, res) => {
  const { mediaIds, targetFolderId } = req.body;
  if (!mediaIds || !Array.isArray(mediaIds) || mediaIds.length === 0) {
    return res.status(400).json({ error: 'Array of mediaIds is required' });
  }

  if (mediaIds.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 items per batch move operation' });
  }

  // If a target folder is specified, verify it exists and determine its event container
  let targetEventId = null;
  if (targetFolderId) {
    const targetFolder = db.prepare('SELECT id, event_id FROM folders WHERE id = ?').get(targetFolderId);
    if (!targetFolder) {
      return res.status(404).json({ error: 'Target folder not found' });
    }
    targetEventId = targetFolder.event_id;
  }

  const placeholders = mediaIds.map(() => '?').join(',');

  // Verify that all media assets belong to the same event as the target folder
  if (targetEventId) {
    const mediaCheck = db.prepare(`
      SELECT COUNT(DISTINCT event_id) as eventCount, MAX(event_id) as eventId
      FROM media
      WHERE id IN (${placeholders})
    `).get(...mediaIds);

    if (mediaCheck.eventCount > 1 || (mediaCheck.eventCount === 1 && mediaCheck.eventId !== targetEventId)) {
      return res.status(400).json({ error: 'Cannot move media assets to a folder belonging to another event' });
    }
  }

  db.prepare(`
    UPDATE media
    SET folder_id = ?
    WHERE id IN (${placeholders})
  `).run(targetFolderId || null, ...mediaIds);

  return res.json({ success: true, count: mediaIds.length });
});

/**
 * DELETE /api/media/batch
 * Delete selected media items with batch limit protection
 */
router.delete('/batch', authenticatePhotographer, async (req, res) => {
  const { mediaIds } = req.body;
  if (!mediaIds || !Array.isArray(mediaIds) || mediaIds.length === 0) {
    return res.status(400).json({ error: 'Array of mediaIds is required' });
  }

  if (mediaIds.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 items per batch deletion' });
  }

  const placeholders = mediaIds.map(() => '?').join(',');
  const items = db.prepare(`SELECT * FROM media WHERE id IN (${placeholders})`).all(...mediaIds);

  for (const item of items) {
    if (item.storage_key_original) await storage.deleteObject(item.storage_key_original);
    if (item.storage_key_preview) await storage.deleteObject(item.storage_key_preview);
    if (item.storage_key_thumbnail) await storage.deleteObject(item.storage_key_thumbnail);
  }

  db.prepare(`DELETE FROM face_embeddings WHERE photo_id IN (${placeholders})`).run(...mediaIds);
  db.prepare(`DELETE FROM media WHERE id IN (${placeholders})`).run(...mediaIds);

  return res.json({ success: true, deletedCount: items.length });
});

/**
 * GET /api/media/download/:mediaId
 * Download single authorized photo with strict event authorization
 */
router.get('/download/:mediaId', async (req, res) => {
  const { mediaId } = req.params;
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
  if (!media) {
    return res.status(404).send('Media not found');
  }

  // Resolve event and verify authorization
  const event = db.prepare(`
    SELECT id, name, status, visibility, public_until, pin_enabled,
           allow_downloads, allow_photo_downloads, allow_video_downloads
    FROM events WHERE id = ?
  `).get(media.event_id);

  if (!event) {
    return res.status(404).send('Gallery not found');
  }

  const authCheck = checkDownloadAuthorization(event, req);
  if (!authCheck.allowed) {
    return res.status(authCheck.status).send(authCheck.error);
  }

  if (!event.allow_downloads) {
    return res.status(403).send('Downloads disabled for this gallery');
  }

  if (media.type === 'photo' && event.allow_photo_downloads === 0) {
    return res.status(403).send('Individual photo downloads are disabled for this gallery');
  }

  if (media.type === 'video' && event.allow_video_downloads === 0) {
    return res.status(403).send('Video downloads are disabled for this gallery');
  }

  try {
    const obj = await storage.getObject(media.storage_key_original);
    res.setHeader('Content-Type', media.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(media.original_name)}"`);
    return res.send(obj.buffer);
  } catch (err) {
    return res.status(500).send('Failed to retrieve original asset');
  }
});

/**
 * POST /api/media/download-zip/:eventId
 * Stream ZIP archive of selected or all photos in event with strict event authorization
 */
router.post('/download-zip/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const { mediaIds } = req.body;

  const event = db.prepare(`
    SELECT id, name, status, visibility, public_until, pin_enabled,
           allow_downloads, allow_bulk_downloads
    FROM events WHERE id = ?
  `).get(eventId);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const authCheck = checkDownloadAuthorization(event, req);
  if (!authCheck.allowed) {
    return res.status(authCheck.status).json({ error: authCheck.error });
  }

  if (!event.allow_downloads) {
    return res.status(403).json({ error: 'Downloads are disabled for this gallery.' });
  }

  if (event.allow_bulk_downloads === 0) {
    return res.status(403).json({ error: 'Bulk ZIP downloads are disabled for this gallery.' });
  }

  let items;
  if (mediaIds && Array.isArray(mediaIds) && mediaIds.length > 0) {
    const placeholders = mediaIds.map(() => '?').join(',');
    items = db.prepare(`SELECT * FROM media WHERE id IN (${placeholders}) AND event_id = ?`).all(...mediaIds, eventId);
  } else {
    items = db.prepare(`SELECT * FROM media WHERE event_id = ? AND status = 'ready'`).all(eventId);
  }

  if (items.length === 0) {
    return res.status(400).json({ error: 'No media items to download' });
  }

  const zipFilename = `${event.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_photos.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.pipe(res);

  for (const item of items) {
    try {
      const obj = await storage.getObject(item.storage_key_original);
      archive.append(obj.buffer, { name: item.original_name });
    } catch (err) {
      console.error(`[ZIP Pack Error] Media ${item.id}:`, err.message);
    }
  }

  await archive.finalize();
});

export default router;
