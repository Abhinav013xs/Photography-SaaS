import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'photographer.db');
const db = new Database(DB_PATH);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize database schema
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS photographer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      business_name TEXT DEFAULT 'Studio Lumina',
      tagline TEXT DEFAULT 'Editorial & Fine Art Photography',
      bio TEXT DEFAULT 'Documentary and fine art wedding photography.',
      website TEXT DEFAULT 'https://studiolumina.photo',
      instagram TEXT DEFAULT '@studiolumina',
      avatar_url TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      client_name TEXT NOT NULL,
      client_email TEXT,
      event_date TEXT NOT NULL,
      location TEXT,
      description TEXT,
      cover_photo_id TEXT,
      status TEXT DEFAULT 'active', -- 'active', 'archived'
      visibility TEXT DEFAULT 'public', -- 'public', 'private'
      public_start DATETIME,
      public_until DATETIME,
      pin_enabled INTEGER DEFAULT 0,
      pin_hash TEXT,
      allow_downloads INTEGER DEFAULT 1,
      watermark_enabled INTEGER DEFAULT 0,
      watermark_text TEXT DEFAULT 'Studio Lumina',
      face_search_enabled INTEGER DEFAULT 1,
      deleted_at DATETIME,
      purge_after DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      folder_id TEXT,
      type TEXT NOT NULL, -- 'photo', 'video'
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      storage_key_original TEXT NOT NULL,
      storage_key_preview TEXT,
      storage_key_thumbnail TEXT,
      video_duration REAL,
      camera_make TEXT,
      camera_model TEXT,
      focal_length TEXT,
      aperture TEXT,
      shutter_speed TEXT,
      iso INTEGER,
      date_taken TEXT,
      status TEXT DEFAULT 'uploaded', -- 'uploaded', 'processing', 'ready', 'failed'
      faces_detected INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS face_embeddings (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      photo_id TEXT NOT NULL,
      face_index INTEGER NOT NULL,
      box_x REAL NOT NULL,
      box_y REAL NOT NULL,
      box_w REAL NOT NULL,
      box_h REAL NOT NULL,
      confidence REAL NOT NULL,
      embedding TEXT NOT NULL, -- JSON array of floats (128D)
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (photo_id) REFERENCES media(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      media_id TEXT,
      type TEXT NOT NULL, -- 'media_processing', 'face_indexing', 'zip_export'
      status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
      progress INTEGER DEFAULT 0,
      total_items INTEGER DEFAULT 0,
      processed_items INTEGER DEFAULT 0,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Phase 45: Admin Operations, Audit Logging & Control Center
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL, -- 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_AGENT', 'OPERATIONS_AGENT', 'FINANCE_ADMIN', 'READ_ONLY_ADMIN'
      status TEXT DEFAULT 'active', -- 'active', 'suspended'
      last_login_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      admin_email TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      previous_state TEXT,
      new_state TEXT,
      reason TEXT NOT NULL,
      ip_address TEXT,
      request_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      photographer_id INTEGER,
      photographer_email TEXT,
      subject TEXT NOT NULL,
      category TEXT NOT NULL, -- 'login', 'upload', 'face_search', 'gallery', 'video', 'storage', 'billing', 'account', 'performance', 'other'
      priority TEXT NOT NULL DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH', 'URGENT'
      status TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'
      assigned_admin_id TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      description TEXT,
      updated_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS platform_incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      severity TEXT NOT NULL, -- 'SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'
      status TEXT NOT NULL, -- 'INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'
      affected_subsystem TEXT NOT NULL,
      description TEXT,
      mitigation_steps TEXT,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      mitigated_at DATETIME,
      resolved_at DATETIME,
      created_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Phase 46: Client Photo Selection, Proofing, Favorites, Quotas & Delivery
    CREATE TABLE IF NOT EXISTS selection_collections (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      client_name TEXT,
      client_email TEXT,
      status TEXT DEFAULT 'draft', -- 'draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'locked', 'completed'
      package_name TEXT DEFAULT 'Full Collection',
      quota INTEGER DEFAULT 0, -- 0 = unlimited
      min_quota INTEGER DEFAULT 0,
      allow_extra INTEGER DEFAULT 0,
      selected_count INTEGER DEFAULT 0,
      favorites_count INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      client_notes TEXT,
      photographer_feedback TEXT,
      submitted_at DATETIME,
      approved_at DATETIME,
      deadline DATETIME,
      delivery_status TEXT DEFAULT 'not_started', -- 'not_started', 'preparing', 'ready', 'delivered'
      delivery_link TEXT,
      delivery_prepared_at DATETIME,
      delivery_accessed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS selection_items (
      id TEXT PRIMARY KEY,
      selection_id TEXT NOT NULL,
      photo_id TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      is_selected INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (selection_id) REFERENCES selection_collections(id) ON DELETE CASCADE,
      FOREIGN KEY (photo_id) REFERENCES media(id) ON DELETE CASCADE,
      UNIQUE(selection_id, photo_id)
    );

    CREATE TABLE IF NOT EXISTS selection_revisions (
      id TEXT PRIMARY KEY,
      selection_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      selected_count INTEGER NOT NULL,
      photo_ids TEXT NOT NULL, -- JSON array of media IDs
      notes TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (selection_id) REFERENCES selection_collections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_folders_event ON folders(event_id);
    CREATE INDEX IF NOT EXISTS idx_media_event ON media(event_id);
    CREATE INDEX IF NOT EXISTS idx_media_folder ON media(folder_id);
    CREATE INDEX IF NOT EXISTS idx_media_status ON media(status);
    CREATE INDEX IF NOT EXISTS idx_face_event ON face_embeddings(event_id);
    CREATE INDEX IF NOT EXISTS idx_face_photo ON face_embeddings(photo_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_logs(admin_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON platform_incidents(status);
    CREATE INDEX IF NOT EXISTS idx_selections_event ON selection_collections(event_id);
    CREATE INDEX IF NOT EXISTS idx_selections_session ON selection_collections(session_id);
    CREATE INDEX IF NOT EXISTS idx_selections_status ON selection_collections(status);
    CREATE INDEX IF NOT EXISTS idx_selection_items_sel ON selection_items(selection_id);
    CREATE INDEX IF NOT EXISTS idx_selection_items_photo ON selection_items(photo_id);
    CREATE INDEX IF NOT EXISTS idx_selection_items_fav ON selection_items(selection_id, is_favorite);
    CREATE INDEX IF NOT EXISTS idx_selection_items_sel_flag ON selection_items(selection_id, is_selected);
    CREATE INDEX IF NOT EXISTS idx_revisions_selection ON selection_revisions(selection_id);
  `);

  // Migration for recycle bin columns
  try {
    db.exec(`ALTER TABLE events ADD COLUMN deleted_at DATETIME`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN purge_after DATETIME`);
  } catch (e) {}

  // Migration for granular download columns (Phase 24)
  try {
    db.exec(`ALTER TABLE events ADD COLUMN allow_photo_downloads INTEGER DEFAULT 1`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN allow_bulk_downloads INTEGER DEFAULT 1`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN allow_video_downloads INTEGER DEFAULT 1`);
  } catch (e) {}

  // Migration for watermark system & expiry columns
  try {
    db.exec(`ALTER TABLE events ADD COLUMN watermark_opacity REAL DEFAULT 0.40`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN watermark_size TEXT DEFAULT 'medium'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN watermark_position TEXT DEFAULT 'bottom-right'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN watermark_color TEXT DEFAULT 'white'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN watermark_version INTEGER DEFAULT 1`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN public_duration_days INTEGER DEFAULT 30`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN expired_at DATETIME`);
  } catch (e) {}

  // Migration for photographer account lifecycle (Phase 45)
  try {
    db.exec(`ALTER TABLE photographer ADD COLUMN status TEXT DEFAULT 'active'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE photographer ADD COLUMN suspended_at DATETIME`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE photographer ADD COLUMN suspension_reason TEXT`);
  } catch (e) {}

  // Migration for processing_jobs DLQ and retries (Phase 45)
  try {
    db.exec(`ALTER TABLE processing_jobs ADD COLUMN retry_count INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE processing_jobs ADD COLUMN error_category TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE processing_jobs ADD COLUMN max_retries INTEGER DEFAULT 3`);
  } catch (e) {}

  // Migration for Phase 46: Client Selection, Package Quotas & Proofing
  try {
    db.exec(`ALTER TABLE events ADD COLUMN client_selection_mode TEXT DEFAULT 'disabled'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN selection_package_name TEXT DEFAULT 'Full Collection'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN selection_package_quota INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN selection_min_quota INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN selection_allow_extra INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN selection_deadline DATETIME`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN selection_instructions TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN selection_allow_changes_after_submission INTEGER DEFAULT 1`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN selection_requires_approval INTEGER DEFAULT 1`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE events ADD COLUMN selection_multiple_rounds INTEGER DEFAULT 1`);
  } catch (e) {}

  // Seed default feature flags if empty
  const existingFlagsCount = db.prepare('SELECT COUNT(*) as c FROM feature_flags').get();
  if (!existingFlagsCount || existingFlagsCount.c === 0) {
    const insertFlag = db.prepare(`
      INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_by)
      VALUES (?, ?, ?, 'system')
    `);
    insertFlag.run('face_search', 1, 'AI Face Detection & Biometric Search Service');
    insertFlag.run('video_processing', 1, 'Video Transcoding & H.264 Renditions Pipeline');
    insertFlag.run('bulk_downloads', 1, 'Bulk ZIP Archive Assembly & Delivery');
    insertFlag.run('client_selection', 1, 'Client Proofing, Favorites & Package Selection');
    insertFlag.run('maintenance_mode', 0, 'Platform-Wide Maintenance Mode (Restricts non-admins)');
  }
  // Also ensure client_selection flag exists if flags already seeded
  try {
    db.prepare(`
      INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_by)
      VALUES ('client_selection', 1, 'Client Proofing, Favorites & Package Selection', 'system')
    `).run();
  } catch (e) {}

  // Seed default admin accounts if empty
  const existingAdminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get();
  if (!existingAdminCount || existingAdminCount.c === 0) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'AdminMaster2026!';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(adminPassword, salt);

    const insertAdmin = db.prepare(`
      INSERT OR IGNORE INTO admin_users (id, email, password_hash, name, role, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `);

    insertAdmin.run('admin_super_1', (process.env.ADMIN_EMAIL || 'admin@studiolumina.photo').toLowerCase().trim(), hash, 'Platform Director', 'SUPER_ADMIN');
    insertAdmin.run('admin_ops_1', 'ops@studiolumina.photo', hash, 'Site Reliability Lead', 'OPERATIONS_AGENT');
    insertAdmin.run('admin_support_1', 'support@studiolumina.photo', hash, 'Customer Operations Lead', 'SUPPORT_AGENT');
    insertAdmin.run('admin_finance_1', 'finance@studiolumina.photo', hash, 'Finance & Billing Lead', 'FINANCE_ADMIN');
    insertAdmin.run('admin_readonly_1', 'audit@studiolumina.photo', hash, 'Compliance Inspector', 'READ_ONLY_ADMIN');
    console.log('[DB] Initialized default administrative accounts across all roles.');
  }

  // Ensure default photographer exists or synchronize custom credentials from environment
  const existingPhotographer = db.prepare('SELECT id, email, password_hash FROM photographer LIMIT 1').get();
  if (!existingPhotographer) {
    const defaultPassword = process.env.PHOTOGRAPHER_PASSWORD || 'photographer123';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(defaultPassword, salt);
    db.prepare(`
      INSERT INTO photographer (email, password_hash, business_name, tagline, bio)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      (process.env.PHOTOGRAPHER_EMAIL || 'photographer@studiolumina.photo').toLowerCase().trim(),
      hash,
      'Studio Lumina',
      'Editorial & Fine Art Photography',
      'Capturing raw human emotion and timeless celebrations across the world.'
    );
    console.log('[DB] Initialized default photographer account.');
  } else {
    // If environment variables specify custom credentials, sync them to the existing account
    const updates = [];
    const params = [];

    if (process.env.PHOTOGRAPHER_EMAIL && process.env.PHOTOGRAPHER_EMAIL.trim()) {
      const targetEmail = process.env.PHOTOGRAPHER_EMAIL.toLowerCase().trim();
      if (targetEmail !== existingPhotographer.email.toLowerCase()) {
        updates.push('email = ?');
        params.push(targetEmail);
      }
    }

    if (process.env.PHOTOGRAPHER_PASSWORD && process.env.PHOTOGRAPHER_PASSWORD.trim()) {
      const isSamePassword = bcrypt.compareSync(process.env.PHOTOGRAPHER_PASSWORD, existingPhotographer.password_hash);
      if (!isSamePassword) {
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(process.env.PHOTOGRAPHER_PASSWORD, salt);
        updates.push('password_hash = ?');
        params.push(hash);
      }
    }

    if (updates.length > 0) {
      params.push(existingPhotographer.id);
      db.prepare(`UPDATE photographer SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      console.log('[DB] Updated photographer credentials from environment configuration.');
    }
  }
}

export default db;
