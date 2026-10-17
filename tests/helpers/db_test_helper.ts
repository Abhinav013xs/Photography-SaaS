import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb, IMemoryDb } from 'pg-mem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../infrastructure/database/migrations'
);
const MIGRATION_PATH = path.resolve(
  MIGRATIONS_DIR,
  '001_initial_schema.sql'
);
const DOWN_MIGRATION_PATH = path.resolve(
  MIGRATIONS_DIR,
  '001_initial_schema.down.sql'
);

function sqlVal(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return `'${String(val).replace(/'/g, "''")}'`;
}

/**
 * Creates and initializes an in-memory PostgreSQL database with the complete schema.
 */
export function createTestDatabase(): IMemoryDb {
  const db = newDb();

  // Register pgcrypto and vector extensions
  db.registerExtension('pgcrypto', () => {});
  db.registerExtension('vector', (schema) => {
    schema.registerEquivalentSizableType({
      name: 'vector',
      equivalentTo: 'text',
      isValid: () => true,
    });
  });

  // Provide deterministic gen_random_uuid function
  let uuidCounter = 1;
  db.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => {
      const hex = (uuidCounter++).toString(16).padStart(12, '0');
      return `00000000-0000-0000-0000-${hex}`;
    },
  });

  // Apply all up migrations in alphabetical order
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  for (const file of files) {
    let upSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    // pg-mem limitation: partial indexes with WHERE clause fail during row mutations
    upSql = upSql.replace(/CREATE INDEX.*?idx_events_public_due.*?;/gis, '');
    upSql = upSql.replace(/CREATE INDEX.*?idx_download_jobs_cleanup.*?;/gis, '');
    // pg-mem limitation: Row Level Security statements are not supported in in-memory pg-mem
    upSql = upSql.replace(/ALTER TABLE.*?ENABLE ROW LEVEL SECURITY;/gis, '');
    upSql = upSql.replace(/CREATE POLICY.*?;/gis, '');
    // pg-mem limitation: DROP CONSTRAINT doesn't drop inline constraints from earlier files
    upSql = upSql.replace(
      /CHECK\s*\(\s*status IN\s*\('pending',\s*'processing',\s*'completed',\s*'failed'\)\s*\)/gis,
      "CHECK (status IN ('pending', 'queued', 'processing', 'retry_wait', 'completed', 'succeeded', 'failed', 'cancelled'))"
    );
    
    // Check if there are any actual executable statements left after removing comments & whitespace
    const nonCommentSql = upSql.replace(/--.*$/gm, '').trim();
    if (nonCommentSql.length > 0) {
      db.public.many(upSql);
    }
  }

  return db;
}

export function getMigrationSql(): { up: string; down: string } {
  return {
    up: fs.readFileSync(MIGRATION_PATH, 'utf-8'),
    down: fs.readFileSync(DOWN_MIGRATION_PATH, 'utf-8'),
  };
}

/**
 * Test fixture factories
 */
export function insertTestPhotographer(
  db: IMemoryDb,
  overrides: { id?: number; email?: string; password_hash?: string; business_name?: string } = {}
) {
  const id = overrides.id ?? 1;
  const email = overrides.email ?? 'photographer@studiolumina.photo';
  const passwordHash = overrides.password_hash ?? '$2a$10$test_hash_for_testing_purposes';
  const businessName = overrides.business_name ?? 'Studio Lumina';

  db.public.none(
    `INSERT INTO photographer (id, email, password_hash, business_name)
     VALUES (${sqlVal(id)}, ${sqlVal(email)}, ${sqlVal(passwordHash)}, ${sqlVal(businessName)});`
  );
  return { id, email, passwordHash, businessName };
}

export function insertTestEvent(
  db: IMemoryDb,
  overrides: {
    id?: string;
    owner_id?: number;
    slug?: string;
    name?: string;
    status?: string;
    visibility?: string;
    public_start?: string | null;
    public_until?: string | null;
    public_duration_days?: number;
    expired_at?: string | null;
    pin_enabled?: boolean;
    pin_hash?: string | null;
    allow_downloads?: boolean;
    watermark_enabled?: boolean;
    watermark_text?: string;
    watermark_opacity?: number;
    watermark_size?: string;
    watermark_position?: string;
    watermark_color?: string;
    watermark_version?: number;
    face_search_enabled?: boolean;
  } = {}
) {
  const id = overrides.id ?? 'e0000000-0000-0000-0000-000000000001';
  const ownerId = overrides.owner_id ?? 1;
  const slug = overrides.slug ?? `event-${id.slice(-4)}`;
  const name = overrides.name ?? 'Test Wedding';
  const status = overrides.status ?? 'active';
  const visibility = overrides.visibility ?? 'public';
  const publicStart = overrides.public_start ?? null;
  const publicUntil = overrides.public_until ?? null;
  const publicDurationDays = overrides.public_duration_days ?? 30;
  const expiredAt = overrides.expired_at ?? null;
  const pinEnabled = overrides.pin_enabled ?? false;
  const pinHash = overrides.pin_hash ?? null;
  const allowDownloads = overrides.allow_downloads ?? true;
  const watermarkEnabled = overrides.watermark_enabled ?? false;
  const watermarkText = overrides.watermark_text ?? 'Studio Lumina';
  const watermarkOpacity = overrides.watermark_opacity ?? 0.40;
  const watermarkSize = overrides.watermark_size ?? 'medium';
  const watermarkPosition = overrides.watermark_position ?? 'bottom-right';
  const watermarkColor = overrides.watermark_color ?? 'white';
  const watermarkVersion = overrides.watermark_version ?? 1;
  const faceSearchEnabled = overrides.face_search_enabled ?? true;

  db.public.none(
    `INSERT INTO events (
       id, owner_id, slug, name, client_name, event_date, status, visibility,
       public_start, public_until, public_duration_days, expired_at, pin_enabled,
       pin_hash, allow_downloads, watermark_enabled, watermark_text, watermark_opacity,
       watermark_size, watermark_position, watermark_color, watermark_version, face_search_enabled
     )
     VALUES (
       ${sqlVal(id)}, ${sqlVal(ownerId)}, ${sqlVal(slug)}, ${sqlVal(name)}, 'Client Name', '2026-10-10',
       ${sqlVal(status)}, ${sqlVal(visibility)}, ${sqlVal(publicStart)}, ${sqlVal(publicUntil)},
       ${sqlVal(publicDurationDays)}, ${sqlVal(expiredAt)}, ${sqlVal(pinEnabled)}, ${sqlVal(pinHash)},
       ${sqlVal(allowDownloads)}, ${sqlVal(watermarkEnabled)}, ${sqlVal(watermarkText)}, ${sqlVal(watermarkOpacity)},
       ${sqlVal(watermarkSize)}, ${sqlVal(watermarkPosition)}, ${sqlVal(watermarkColor)}, ${sqlVal(watermarkVersion)},
       ${sqlVal(faceSearchEnabled)}
     );`
  );
  return { id, ownerId, slug, name, status, visibility, public_start: publicStart, public_until: publicUntil, public_duration_days: publicDurationDays, expired_at: expiredAt, allow_downloads: allowDownloads, watermark_enabled: watermarkEnabled, watermark_text: watermarkText, watermark_version: watermarkVersion, face_search_enabled: faceSearchEnabled };
}

export function insertTestDownloadJob(
  db: IMemoryDb,
  overrides: {
    id?: string;
    event_id: string;
    status?: string;
    media_ids?: string[];
    requested_count?: number;
    processed_count?: number;
    progress?: number;
    storage_key?: string | null;
    file_size?: number | null;
    expires_at?: string | Date;
    completed_at?: string | Date | null;
    error_message?: string | null;
  }
) {
  const id = overrides.id ?? 'd0000000-0000-0000-0000-000000000001';
  const eventId = overrides.event_id;
  const status = overrides.status ?? 'pending';
  const mediaIds = overrides.media_ids ?? [];
  const requestedCount = overrides.requested_count ?? mediaIds.length;
  const processedCount = overrides.processed_count ?? 0;
  const progress = overrides.progress ?? 0;
  const storageKey = overrides.storage_key ?? null;
  const fileSize = overrides.file_size ?? null;
  const expiresAt = overrides.expires_at ? new Date(overrides.expires_at).toISOString() : new Date(Date.now() + 86400000).toISOString();
  const completedAt = overrides.completed_at ? new Date(overrides.completed_at).toISOString() : null;
  const errorMessage = overrides.error_message ?? null;

  db.public.none(
    `INSERT INTO download_jobs (id, event_id, status, requested_count, processed_count, progress, storage_key, file_size, expires_at, completed_at, error_message, created_at)
     VALUES (${sqlVal(id)}, ${sqlVal(eventId)}, ${sqlVal(status)}, ${sqlVal(requestedCount)}, ${sqlVal(processedCount)}, ${sqlVal(progress)}, ${sqlVal(storageKey)}, ${sqlVal(fileSize)}, ${sqlVal(expiresAt)}, ${sqlVal(completedAt)}, ${sqlVal(errorMessage)}, NOW());`
  );
  return { id, eventId, status, mediaIds, requestedCount, processedCount, progress, storageKey, fileSize, expiresAt, completedAt, errorMessage };
}

export function insertTestFolder(
  db: IMemoryDb,
  overrides: { id?: string; event_id: string; name?: string; sort_order?: number }
) {
  const id = overrides.id ?? 'f0000000-0000-0000-0000-000000000001';
  const eventId = overrides.event_id;
  const name = overrides.name ?? 'Ceremony';
  const sortOrder = overrides.sort_order ?? 0;

  db.public.none(
    `INSERT INTO folders (id, event_id, name, sort_order)
     VALUES (${sqlVal(id)}, ${sqlVal(eventId)}, ${sqlVal(name)}, ${sqlVal(sortOrder)});`
  );
  return { id, eventId, name, sortOrder };
}

export function insertTestMedia(
  db: IMemoryDb,
  overrides: {
    id?: string;
    event_id: string;
    folder_id?: string | null;
    type?: string;
    filename?: string;
    original_name?: string;
    file_size?: number;
    width?: number | null;
    height?: number | null;
    storage_key_original?: string;
    storage_key_preview?: string | null;
    storage_key_thumbnail?: string | null;
    thumbnail_size?: number | null;
    preview_size?: number | null;
    video_duration?: number | null;
    video_codec?: string | null;
    audio_codec?: string | null;
    processing_error?: string | null;
    processed_at?: string | Date | null;
    status?: string;
    watermark_applied?: boolean;
    watermark_version?: number | null;
    created_at?: string | Date | null;
  }
) {
  const id = overrides.id ?? '10000000-0000-0000-0000-000000000001';
  const eventId = overrides.event_id;
  const folderId = overrides.folder_id ?? null;
  const type = overrides.type ?? 'photo';
  const filename = overrides.filename ?? `${id}.jpg`;
  const originalName = overrides.original_name ?? overrides.filename ?? 'orig.jpg';
  const fileSize = overrides.file_size ?? 5000000;
  const width = overrides.width ?? null;
  const height = overrides.height ?? null;
  const storageKeyOriginal = overrides.storage_key_original ?? `events/${eventId}/originals/${filename}`;
  const storageKeyPreview = overrides.storage_key_preview ?? null;
  const storageKeyThumbnail = overrides.storage_key_thumbnail ?? null;
  const thumbnailSize = overrides.thumbnail_size ?? null;
  const previewSize = overrides.preview_size ?? null;
  const videoDuration = overrides.video_duration ?? null;
  const videoCodec = overrides.video_codec ?? null;
  const audioCodec = overrides.audio_codec ?? null;
  const processingError = overrides.processing_error ?? null;
  const processedAt = overrides.processed_at
    ? typeof overrides.processed_at === 'string'
      ? overrides.processed_at
      : overrides.processed_at.toISOString()
    : null;
  const status = overrides.status ?? 'ready';
  const watermarkApplied = overrides.watermark_applied ?? false;
  const watermarkVersion = overrides.watermark_version ?? (status === 'ready' ? 1 : 0);
  const createdAtVal = overrides.created_at
    ? sqlVal(typeof overrides.created_at === 'string' ? overrides.created_at : overrides.created_at.toISOString())
    : 'NOW()';

  db.public.none(
    `INSERT INTO media (
      id, event_id, folder_id, type, filename, original_name, mime_type, file_size,
      width, height, storage_key_original, storage_key_preview, storage_key_thumbnail,
      thumbnail_size, preview_size, video_duration, video_codec, audio_codec,
      processing_error, processed_at, status, watermark_applied, watermark_version, created_at
    ) VALUES (
      ${sqlVal(id)}, ${sqlVal(eventId)}, ${sqlVal(folderId)}, ${sqlVal(type)}, ${sqlVal(filename)},
      ${sqlVal(originalName)}, 'image/jpeg', ${sqlVal(fileSize)}, ${sqlVal(width)}, ${sqlVal(height)},
      ${sqlVal(storageKeyOriginal)}, ${sqlVal(storageKeyPreview)}, ${sqlVal(storageKeyThumbnail)},
      ${sqlVal(thumbnailSize)}, ${sqlVal(previewSize)}, ${sqlVal(videoDuration)}, ${sqlVal(videoCodec)}, ${sqlVal(audioCodec)},
      ${sqlVal(processingError)}, ${sqlVal(processedAt)},
      ${sqlVal(status)}, ${sqlVal(watermarkApplied)}, ${sqlVal(watermarkVersion)}, ${createdAtVal}
    );`
  );
  return { id, eventId, folderId, type, filename, fileSize, status, thumbnailSize, previewSize, watermark_applied: watermarkApplied, watermark_version: watermarkVersion };
}

export function insertTestFaceEmbedding(
  db: IMemoryDb,
  overrides: {
    id?: string;
    event_id: string;
    photo_id: string;
    face_index?: number;
    confidence?: number;
    embedding?: string;
  }
) {
  const id = overrides.id ?? '20000000-0000-0000-0000-000000000001';
  const eventId = overrides.event_id;
  const photoId = overrides.photo_id;
  const faceIndex = overrides.face_index ?? 0;
  const confidence = overrides.confidence ?? 0.95;
  const embedding = overrides.embedding ?? '[0.1, 0.2, 0.3]';

  db.public.none(
    `INSERT INTO face_embeddings (id, event_id, photo_id, face_index, box_x, box_y, box_w, box_h, confidence, embedding)
     VALUES (${sqlVal(id)}, ${sqlVal(eventId)}, ${sqlVal(photoId)}, ${sqlVal(faceIndex)}, 0.1, 0.1, 0.2, 0.2, ${sqlVal(confidence)}, ${sqlVal(embedding)});`
  );
  return { id, eventId, photoId, faceIndex, confidence, embedding };
}

let storageUsageCounter = 1;

export function insertTestStorageUsage(
  db: IMemoryDb,
  overrides: {
    id?: string;
    event_id: string;
    original_bytes?: number;
    preview_bytes?: number;
    thumbnail_bytes?: number;
    video_bytes?: number;
    total_bytes?: number;
    last_calculated_at?: Date | string;
  }
) {
  const hex = (storageUsageCounter++).toString(16).padStart(12, '0');
  const id = overrides.id ?? `70000000-0000-0000-0000-${hex}`;
  const eventId = overrides.event_id;
  const originalBytes = overrides.original_bytes ?? 0;
  const previewBytes = overrides.preview_bytes ?? 0;
  const thumbnailBytes = overrides.thumbnail_bytes ?? 0;
  const videoBytes = overrides.video_bytes ?? 0;
  const totalBytes =
    overrides.total_bytes ??
    originalBytes + previewBytes + thumbnailBytes + videoBytes;
  const lastCalculatedAt = overrides.last_calculated_at
    ? typeof overrides.last_calculated_at === 'string'
      ? overrides.last_calculated_at
      : overrides.last_calculated_at.toISOString()
    : new Date().toISOString();

  db.public.none(
    `INSERT INTO storage_usage (id, event_id, original_bytes, preview_bytes, thumbnail_bytes, video_bytes, total_bytes, last_calculated_at)
     VALUES (${sqlVal(id)}, ${sqlVal(eventId)}, ${sqlVal(originalBytes)}, ${sqlVal(previewBytes)}, ${sqlVal(thumbnailBytes)}, ${sqlVal(videoBytes)}, ${sqlVal(totalBytes)}, ${sqlVal(lastCalculatedAt)});`
  );
  return {
    id,
    eventId,
    originalBytes,
    previewBytes,
    thumbnailBytes,
    videoBytes,
    totalBytes,
    lastCalculatedAt,
  };
}

export function insertTestProcessingJob(
  db: IMemoryDb,
  overrides: {
    id?: string;
    event_id: string;
    media_id?: string;
    type?: string;
    status?: string;
    progress?: number;
    total_items?: number;
    processed_items?: number;
    error_message?: string | null;
    attempts?: number;
    max_attempts?: number;
    job_id?: string | null;
    error_code?: string | null;
    worker_id?: string | null;
    lease_expires_at?: string | null;
    next_retry_at?: string | null;
    idempotency_key?: string | null;
    correlation_id?: string | null;
  }
) {
  const id = overrides.id ?? '80000000-0000-0000-0000-000000000001';
  const eventId = overrides.event_id;
  const mediaId = overrides.media_id ?? null;
  const type = overrides.type ?? 'photo_processing';
  const status = overrides.status ?? 'pending';
  const progress = overrides.progress ?? 0;
  const totalItems = overrides.total_items ?? 1;
  const processedItems = overrides.processed_items ?? 0;
  const errorMessage = overrides.error_message ?? null;
  const attempts = overrides.attempts ?? 0;
  const maxAttempts = overrides.max_attempts ?? 3;
  const jobId = overrides.job_id ?? null;
  const errorCode = overrides.error_code ?? null;
  const workerId = overrides.worker_id ?? null;
  const leaseExpiresAt = overrides.lease_expires_at ?? null;
  const nextRetryAt = overrides.next_retry_at ?? null;
  const idempotencyKey = overrides.idempotency_key ?? null;
  const correlationId = overrides.correlation_id ?? null;

  db.public.none(
    `INSERT INTO processing_jobs (
      id, event_id, media_id, type, status, progress, total_items, processed_items,
      error_message, attempts, max_attempts, job_id, error_code, worker_id,
      lease_expires_at, next_retry_at, idempotency_key, correlation_id
    ) VALUES (
      ${sqlVal(id)}, ${sqlVal(eventId)}, ${sqlVal(mediaId)}, ${sqlVal(type)}, ${sqlVal(status)},
      ${sqlVal(progress)}, ${sqlVal(totalItems)}, ${sqlVal(processedItems)}, ${sqlVal(errorMessage)},
      ${sqlVal(attempts)}, ${sqlVal(maxAttempts)}, ${sqlVal(jobId)}, ${sqlVal(errorCode)},
      ${sqlVal(workerId)}, ${leaseExpiresAt ? `'${leaseExpiresAt}'::timestamptz` : 'NULL'},
      ${nextRetryAt ? `'${nextRetryAt}'::timestamptz` : 'NULL'},
      ${sqlVal(idempotencyKey)}, ${sqlVal(correlationId)}
    );`
  );
  return {
    id,
    eventId,
    mediaId,
    type,
    status,
    progress,
    totalItems,
    processedItems,
    errorMessage,
    attempts,
    maxAttempts,
    jobId,
    errorCode,
    workerId,
    leaseExpiresAt,
    nextRetryAt,
    idempotencyKey,
    correlationId,
  };
}
