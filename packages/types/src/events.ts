import type {
  EventStatus,
  EventVisibility,
  Event,
  WatermarkPosition,
  WatermarkSize,
  WatermarkColor,
} from './database.js';

export interface CreateEventDTO {
  name: string;
  client_name: string;
  client_email?: string | null;
  event_date: string; // YYYY-MM-DD
  location?: string | null;
  description?: string | null;
  slug?: string;
  visibility?: EventVisibility;
  status?: EventStatus;
  public_start?: string | null;
  public_until?: string | null;
  public_duration_days?: number;
  pin_enabled?: boolean;
  pin?: string | null;
  allow_downloads?: boolean;
  allow_photo_downloads?: boolean;
  allow_bulk_downloads?: boolean;
  allow_video_downloads?: boolean;
  watermark_enabled?: boolean;
  watermark_text?: string | null;
  watermark_opacity?: number;
  watermark_size?: WatermarkSize;
  watermark_position?: WatermarkPosition;
  watermark_color?: WatermarkColor;
  face_search_enabled?: boolean;
  cover_photo_id?: string | null;
}

export interface UpdateEventDTO {
  name?: string;
  client_name?: string;
  client_email?: string | null;
  event_date?: string;
  location?: string | null;
  description?: string | null;
  slug?: string;
  visibility?: EventVisibility;
  status?: EventStatus;
  public_start?: string | null;
  public_until?: string | null;
  public_duration_days?: number;
  pin_enabled?: boolean;
  pin?: string | null;
  allow_downloads?: boolean;
  allow_photo_downloads?: boolean;
  allow_bulk_downloads?: boolean;
  allow_video_downloads?: boolean;
  watermark_enabled?: boolean;
  watermark_text?: string | null;
  watermark_opacity?: number;
  watermark_size?: WatermarkSize;
  watermark_position?: WatermarkPosition;
  watermark_color?: WatermarkColor;
  face_search_enabled?: boolean;
  cover_photo_id?: string | null;
}

export interface UpdateEventVisibilityDTO {
  visibility: EventVisibility;
  public_duration_days?: number;
}

export interface EventListItem {
  id: string;
  slug: string;
  name: string;
  client_name: string;
  client_email: string | null;
  event_date: string;
  location: string | null;
  status: EventStatus;
  visibility: EventVisibility;
  public_start: string | null;
  public_until: string | null;
  public_duration_days: number;
  is_expired: boolean;
  expired_at: string | null;
  pin_enabled: boolean;
  allow_downloads: boolean;
  allow_photo_downloads?: boolean;
  allow_bulk_downloads?: boolean;
  allow_video_downloads?: boolean;
  watermark_enabled: boolean;
  deleted_at?: string | null;
  purge_after?: string | null;
  deleted_by?: number | null;
  days_remaining?: number | null;
  created_at: string;
  updated_at: string;
}

export interface EventDetail extends EventListItem {
  description: string | null;
  watermark_text: string | null;
  watermark_opacity: number;
  watermark_size: WatermarkSize;
  watermark_position: WatermarkPosition;
  watermark_color: WatermarkColor;
  watermark_version: number;
  face_search_enabled: boolean;
  cover_photo_id: string | null;
}

export interface TrashedEventListItem extends EventListItem {
  deleted_at: string;
  purge_after: string;
  deleted_by: number | null;
  days_remaining: number;
  cover_preview_url?: string | null;
  cover_photo_id?: string | null;
  photo_count?: number;
  video_count?: number;
  total_size_bytes?: number;
}

export interface TrashEventResponseDTO {
  trashed: boolean;
  id: string;
  name: string;
  status: 'trashed';
  deleted_at: string;
  purge_after: string;
  days_remaining: number;
}

export interface RestoreEventResponseDTO {
  restored: boolean;
  id: string;
  name: string;
  status: EventStatus;
}

export interface EmptyBinResultDTO {
  totalRequested: number;
  successfullyDeleted: number;
  failedCount: number;
  results: Array<{
    eventId: string;
    name: string;
    success: boolean;
    error?: string;
  }>;
}

export interface WatermarkReprocessStatus {
  eventId: string;
  watermarkVersion: number;
  totalPhotos: number;
  syncedPhotos: number;
  pendingPhotos: number;
  inSync: boolean;
}

export interface EventListQuery {
  status?: EventStatus | 'all';
  visibility?: EventVisibility | 'all';
  search?: string;
  page?: number;
  limit?: number;
}

export interface EventQrShareDTO {
  shareUrl: string;
  qrDataUrl: string;
  qrSvg: string;
  eventName: string;
  clientName: string;
  eventDate: string;
  pinProtected: boolean;
  visibility: EventVisibility;
  isExpired: boolean;
  publicUntil: string | null;
}

export type EventDeletionStage =
  | 'initialized'
  | 'access_blocked'
  | 'jobs_cancelled'
  | 'r2_purged'
  | 'database_purged'
  | 'verified'
  | 'completed'
  | 'failed';

export interface EventDeletionJobDTO {
  id: string;
  eventId: string;
  ownerId: number;
  eventName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  stage: EventDeletionStage;
  attempts: number;
  r2ObjectsDeleted: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeleteEventResponseDTO {
  deleted: boolean;
  id: string;
  name: string;
  jobId: string;
  r2ObjectsDeleted: number;
  stage: EventDeletionStage;
}
