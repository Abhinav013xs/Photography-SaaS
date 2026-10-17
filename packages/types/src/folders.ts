/**
 * Domain Types & DTOs for Folder Management
 * Phase 7: Folder Management
 */

export interface CreateFolderDTO {
  name: string;
  sort_order?: number;
  sortOrder?: number;
}

export interface UpdateFolderDTO {
  name?: string;
  sort_order?: number;
  sortOrder?: number;
}

export interface FolderItem {
  id: string;
  event_id: string;
  name: string;
  sort_order: number;
  media_count: number;
  created_at: string;
  updated_at: string;
}

export interface FolderDetail extends FolderItem {}

export interface FolderListResult {
  folders: FolderItem[];
  root_media_count: number;
  total_media_count: number;
}

export interface MoveMediaDTO {
  folder_id?: string | null;
  folderId?: string | null;
}

export interface BatchMoveMediaDTO {
  media_ids?: string[];
  mediaIds?: string[];
  target_folder_id?: string | null;
  targetFolderId?: string | null;
}

export interface DeleteFolderResult {
  message: string;
  media_reassigned_count: number;
}
