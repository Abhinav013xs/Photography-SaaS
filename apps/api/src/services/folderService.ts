import { randomUUID } from 'crypto';
import { query, withTransaction } from '../infrastructure/database.js';
import {
  EventNotFoundError,
  FolderNotFoundError,
  FolderNameConflictError,
  InvalidTargetFolderError,
  MediaNotFoundError,
  ValidationError,
} from '@photography-saas/errors';
import type {
  Folder,
  CreateFolderDTO,
  UpdateFolderDTO,
  FolderItem,
  FolderDetail,
  FolderListResult,
  DeleteFolderResult,
} from '@photography-saas/types';
import { log } from '../middleware/logger.js';

export const MAX_FOLDER_NAME_LENGTH = 255;

/**
 * Normalizes and validates a folder name.
 * Trims whitespace, verifies length is between 1 and 255 characters.
 */
export function validateAndNormalizeFolderName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new ValidationError('Folder name must be a string');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Folder name cannot be empty or whitespace-only');
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new ValidationError(
      `Folder name cannot exceed ${MAX_FOLDER_NAME_LENGTH} characters (received ${trimmed.length})`
    );
  }
  return trimmed;
}

/**
 * Verifies that the event exists and is owned by the authenticated photographer.
 */
export async function verifyEventOwnership(ownerId: number, eventId: string): Promise<void> {
  const res = await query<{ id: string }>(
    'SELECT id FROM events WHERE id = $1 AND owner_id = $2',
    [eventId, ownerId]
  );
  if (res.rows.length === 0) {
    throw new EventNotFoundError('Event not found or access denied');
  }
}

/**
 * Checks if a folder with the specified name already exists within the event.
 */
export async function checkDuplicateFolderName(
  eventId: string,
  name: string,
  excludeFolderId?: string
): Promise<void> {
  let sql = 'SELECT id FROM folders WHERE event_id = $1 AND LOWER(name) = LOWER($2)';
  const params: any[] = [eventId, name];

  if (excludeFolderId) {
    sql += ' AND id != $3';
    params.push(excludeFolderId);
  }

  const res = await query<{ id: string }>(sql, params);
  if (res.rows.length > 0) {
    throw new FolderNameConflictError(
      `A folder named "${name}" already exists in this event`
    );
  }
}

/**
 * Creates a new folder inside an event container.
 */
export async function createFolder(
  ownerId: number,
  eventId: string,
  dto: CreateFolderDTO
): Promise<FolderItem> {
  await verifyEventOwnership(ownerId, eventId);
  const normalizedName = validateAndNormalizeFolderName(dto.name);
  await checkDuplicateFolderName(eventId, normalizedName);

  let sortOrder = dto.sort_order ?? dto.sortOrder;
  if (sortOrder === undefined || sortOrder === null) {
    const maxOrderRes = await query<{ max_order: number | null }>(
      'SELECT MAX(sort_order) as max_order FROM folders WHERE event_id = $1',
      [eventId]
    );
    sortOrder = (maxOrderRes.rows[0]?.max_order ?? -1) + 1;
  }

  const folderId = randomUUID();
  const insertRes = await query<Folder>(
    `INSERT INTO folders (id, event_id, name, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING id, event_id, name, sort_order, created_at, updated_at`,
    [folderId, eventId, normalizedName, sortOrder]
  );

  const row = insertRes.rows[0];

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Folder created: "${normalizedName}" (${row.id}) for event ${eventId}`,
  });

  return {
    id: row.id,
    event_id: row.event_id,
    name: row.name,
    sort_order: row.sort_order,
    media_count: 0,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Lists all folders for an event with actual media counts.
 */
export async function listFolders(
  ownerId: number,
  eventId: string
): Promise<FolderListResult> {
  await verifyEventOwnership(ownerId, eventId);

  const foldersRes = await query<{
    id: string;
    event_id: string;
    name: string;
    sort_order: number;
    created_at: Date;
    updated_at: Date;
    media_count: string;
  }>(
    `SELECT f.id, f.event_id, f.name, f.sort_order, f.created_at, f.updated_at,
            COUNT(m.id)::int AS media_count
     FROM folders f
     LEFT JOIN media m ON m.event_id = f.event_id AND m.folder_id = f.id
     WHERE f.event_id = $1
     GROUP BY f.id, f.event_id, f.name, f.sort_order, f.created_at, f.updated_at
     ORDER BY f.sort_order ASC, f.name ASC, f.created_at ASC`,
    [eventId]
  );

  const rootRes = await query<{ root_count: string }>(
    `SELECT COUNT(*)::int AS root_count
     FROM media
     WHERE event_id = $1 AND folder_id IS NULL`,
    [eventId]
  );
  const rootMediaCount = parseInt(rootRes.rows[0]?.root_count || '0', 10);

  const folders: FolderItem[] = foldersRes.rows.map((r) => ({
    id: r.id,
    event_id: r.event_id,
    name: r.name,
    sort_order: r.sort_order,
    media_count: parseInt(String(r.media_count), 10) || 0,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  }));

  const totalMediaCount = rootMediaCount + folders.reduce((sum, f) => sum + f.media_count, 0);

  return {
    folders,
    root_media_count: rootMediaCount,
    total_media_count: totalMediaCount,
  };
}

/**
 * Retrieves details for a specific folder within an event.
 */
export async function getFolderById(
  ownerId: number,
  eventId: string,
  folderId: string
): Promise<FolderDetail> {
  await verifyEventOwnership(ownerId, eventId);

  const res = await query<{
    id: string;
    event_id: string;
    name: string;
    sort_order: number;
    created_at: Date;
    updated_at: Date;
    media_count: string;
  }>(
    `SELECT f.id, f.event_id, f.name, f.sort_order, f.created_at, f.updated_at,
            COUNT(m.id)::int AS media_count
     FROM folders f
     LEFT JOIN media m ON m.event_id = f.event_id AND m.folder_id = f.id
     WHERE f.id = $1 AND f.event_id = $2
     GROUP BY f.id, f.event_id, f.name, f.sort_order, f.created_at, f.updated_at`,
    [folderId, eventId]
  );

  if (res.rows.length === 0) {
    throw new FolderNotFoundError('Folder not found in this event');
  }

  const r = res.rows[0];
  return {
    id: r.id,
    event_id: r.event_id,
    name: r.name,
    sort_order: r.sort_order,
    media_count: parseInt(String(r.media_count), 10) || 0,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

/**
 * Updates an existing folder (rename or reorder).
 */
export async function updateFolder(
  ownerId: number,
  eventId: string,
  folderId: string,
  dto: UpdateFolderDTO
): Promise<FolderDetail> {
  await verifyEventOwnership(ownerId, eventId);

  const existingRes = await query<Folder>(
    'SELECT * FROM folders WHERE id = $1 AND event_id = $2',
    [folderId, eventId]
  );
  if (existingRes.rows.length === 0) {
    throw new FolderNotFoundError('Folder not found in this event');
  }
  const current = existingRes.rows[0];

  let name = current.name;
  if (dto.name !== undefined) {
    const normalized = validateAndNormalizeFolderName(dto.name);
    if (normalized.toLowerCase() !== current.name.toLowerCase()) {
      await checkDuplicateFolderName(eventId, normalized, folderId);
    }
    name = normalized;
  }

  const sortOrder = dto.sort_order ?? dto.sortOrder ?? current.sort_order;

  const updateRes = await query<Folder>(
    `UPDATE folders
     SET name = $1, sort_order = $2, updated_at = NOW()
     WHERE id = $3 AND event_id = $4
     RETURNING id, event_id, name, sort_order, created_at, updated_at`,
    [name, sortOrder, folderId, eventId]
  );

  const updated = updateRes.rows[0];

  const countRes = await query<{ count: string }>(
    'SELECT COUNT(*)::int AS count FROM media WHERE event_id = $1 AND folder_id = $2',
    [eventId, folderId]
  );
  const mediaCount = parseInt(countRes.rows[0]?.count || '0', 10);

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Folder updated: "${name}" (${folderId}) in event ${eventId}`,
  });

  return {
    id: updated.id,
    event_id: updated.event_id,
    name: updated.name,
    sort_order: updated.sort_order,
    media_count: mediaCount,
    created_at: new Date(updated.created_at).toISOString(),
    updated_at: new Date(updated.updated_at).toISOString(),
  };
}

/**
 * Safely deletes a folder inside a database transaction.
 * Associated media items have folder_id set to NULL (moved to event root).
 * Media records, files, and embeddings are NEVER deleted.
 */
export async function deleteFolder(
  ownerId: number,
  eventId: string,
  folderId: string
): Promise<DeleteFolderResult> {
  await verifyEventOwnership(ownerId, eventId);

  const existingRes = await query<Folder>(
    'SELECT id, name FROM folders WHERE id = $1 AND event_id = $2',
    [folderId, eventId]
  );
  if (existingRes.rows.length === 0) {
    throw new FolderNotFoundError('Folder not found in this event');
  }

  const folderName = existingRes.rows[0].name;

  const { mediaReassignedCount } = await withTransaction(async (client) => {
    // 1. Reassign media to event root
    const updateRes = await client.query(
      `UPDATE media 
       SET folder_id = NULL, updated_at = NOW() 
       WHERE event_id = $1 AND folder_id = $2`,
      [eventId, folderId]
    );
    const reassigned = updateRes.rowCount ?? 0;

    // 2. Delete the folder record
    await client.query(
      `DELETE FROM folders WHERE id = $1 AND event_id = $2`,
      [folderId, eventId]
    );

    return { mediaReassignedCount: reassigned };
  });

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Folder safely deleted: "${folderName}" (${folderId}) in event ${eventId}. Reassigned ${mediaReassignedCount} media items to event root.`,
  });

  return {
    message: 'Folder safely deleted. Associated media reassigned to event root.',
    media_reassigned_count: mediaReassignedCount,
  };
}

/**
 * Moves a single media asset to another folder or to the event root (folder_id = NULL).
 */
export async function moveMediaToFolder(
  ownerId: number,
  eventId: string,
  mediaId: string,
  targetFolderId: string | null
): Promise<{ id: string; event_id: string; folder_id: string | null; updated_at: string }> {
  await verifyEventOwnership(ownerId, eventId);

  // Verify media exists and belongs to this event
  const mediaRes = await query<{ id: string; folder_id: string | null }>(
    'SELECT id, folder_id FROM media WHERE id = $1 AND event_id = $2',
    [mediaId, eventId]
  );
  if (mediaRes.rows.length === 0) {
    throw new MediaNotFoundError('Media asset not found in this event');
  }

  // If target folder specified, verify it exists and belongs to this event
  if (targetFolderId !== null) {
    const folderRes = await query<{ id: string }>(
      'SELECT id FROM folders WHERE id = $1 AND event_id = $2',
      [targetFolderId, eventId]
    );
    if (folderRes.rows.length === 0) {
      throw new InvalidTargetFolderError('Target folder does not exist or belongs to another event');
    }
  }

  const updateRes = await query<{
    id: string;
    event_id: string;
    folder_id: string | null;
    updated_at: Date;
  }>(
    `UPDATE media 
     SET folder_id = $1, updated_at = NOW() 
     WHERE id = $2 AND event_id = $3
     RETURNING id, event_id, folder_id, updated_at`,
    [targetFolderId, mediaId, eventId]
  );

  const row = updateRes.rows[0];

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Media ${mediaId} moved to ${targetFolderId ?? 'event root'} in event ${eventId}`,
  });

  return {
    id: row.id,
    event_id: row.event_id,
    folder_id: row.folder_id,
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Moves multiple media assets in batch to a target folder or to the event root.
 */
export async function batchMoveMedia(
  ownerId: number,
  eventId: string,
  mediaIds: string[],
  targetFolderId: string | null
): Promise<{ moved_count: number; target_folder_id: string | null }> {
  await verifyEventOwnership(ownerId, eventId);

  if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
    throw new ValidationError('At least one media ID must be specified for batch move');
  }

  // If target folder specified, verify it belongs to this event
  if (targetFolderId !== null) {
    const folderRes = await query<{ id: string }>(
      'SELECT id FROM folders WHERE id = $1 AND event_id = $2',
      [targetFolderId, eventId]
    );
    if (folderRes.rows.length === 0) {
      throw new InvalidTargetFolderError('Target folder does not exist or belongs to another event');
    }
  }

  const result = await withTransaction(async (client) => {
    // Verify all media belong to this event
    const verifyPlaceholders = mediaIds.map((_, i) => `$${i + 2}`).join(', ');
    const verifyRes = await client.query<{ id: string }>(
      `SELECT id FROM media WHERE event_id = $1 AND id IN (${verifyPlaceholders})`,
      [eventId, ...mediaIds]
    );

    if (verifyRes.rows.length !== mediaIds.length) {
      throw new MediaNotFoundError('One or more media items were not found in this event');
    }

    const updatePlaceholders = mediaIds.map((_, i) => `$${i + 3}`).join(', ');
    const updateRes = await client.query(
      `UPDATE media 
       SET folder_id = $1, updated_at = NOW() 
       WHERE event_id = $2 AND id IN (${updatePlaceholders})`,
      [targetFolderId, eventId, ...mediaIds]
    );

    return { moved_count: updateRes.rowCount ?? 0, target_folder_id: targetFolderId };
  });

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'photography-api',
    message: `Batch moved ${result.moved_count} media items to ${targetFolderId ?? 'root'} in event ${eventId}`,
  });

  return result;
}
