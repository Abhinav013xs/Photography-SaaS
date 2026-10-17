/**
 * Domain Database Types & Entities
 * Phase 3: Database Architecture & Migrations
 */

export type EventStatus = 'draft' | 'active' | 'archived' | 'trashed' | 'deleting' | 'deleted';
export type EventVisibility = 'public' | 'private';
export type MediaType = 'photo' | 'video';
export type MediaProcessingStatus = 'uploaded' | 'processing' | 'ready' | 'failed';
import type { JobType, JobStatus } from './jobs.js';

export interface Photographer {
  id: number;
  email: string;
  password_hash: string;
  business_name: string;
  tagline: string | null;
  bio: string | null;
  website: string | null;
  instagram: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export type WatermarkPosition = 'center' | 'bottom-right' | 'bottom-center';
export type WatermarkSize = 'small' | 'medium' | 'large';
export type WatermarkColor = 'white' | 'black';

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  opacity: number;
  size: WatermarkSize;
  position: WatermarkPosition;
  color: WatermarkColor;
}

export interface Event {
  id: string;
  owner_id: number;
  slug: string;
  name: string;
  client_name: string;
  client_email: string | null;
  event_date: string;
  location: string | null;
  description: string | null;
  cover_photo_id: string | null;
  status: EventStatus;
  visibility: EventVisibility;
  public_start: Date | null;
  public_until: Date | null;
  public_duration_days: number;
  expired_at: Date | null;
  pin_enabled: boolean;
  pin_hash: string | null;
  allow_downloads: boolean;
  allow_photo_downloads?: boolean;
  allow_bulk_downloads?: boolean;
  allow_video_downloads?: boolean;
  watermark_enabled: boolean;
  watermark_text: string | null;
  watermark_opacity: number;
  watermark_size: WatermarkSize;
  watermark_position: WatermarkPosition;
  watermark_color: WatermarkColor;
  watermark_version: number;
  face_search_enabled: boolean;
  deleted_at?: Date | null;
  purge_after?: Date | null;
  deleted_by?: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface Folder {
  id: string;
  event_id: string;
  name: string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface Media {
  id: string;
  event_id: string;
  folder_id: string | null;
  type: MediaType;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  storage_key_original: string;
  storage_key_preview: string | null;
  storage_key_thumbnail: string | null;
  thumbnail_size: number | null;
  preview_size: number | null;
  video_duration: number | null;
  video_codec?: string | null;
  audio_codec?: string | null;
  checksum: string | null;
  camera_make: string | null;
  camera_model: string | null;
  focal_length: string | null;
  aperture: string | null;
  shutter_speed: string | null;
  iso: number | null;
  date_taken: Date | null;
  status: MediaProcessingStatus;
  processing_error: string | null;
  processed_at: Date | null;
  faces_detected: number;
  watermark_applied: boolean;
  watermark_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface FaceDetection {
  id: string;
  event_id: string;
  media_id: string;
  face_index: number;
  box_x: number;
  box_y: number;
  box_w: number;
  box_h: number;
  confidence: number;
  landmarks?: Array<{ x: number; y: number }> | null;
  detector_name: string;
  detector_version: string;
  created_at: Date;
  updated_at: Date;
}

export interface FaceEmbedding {
  id: string;
  event_id: string;
  photo_id: string;
  face_index: number;
  box_x: number;
  box_y: number;
  box_w: number;
  box_h: number;
  confidence: number;
  model_name: string;
  model_version: string;
  embedding: number[];
  created_at: Date;
}

export interface ProcessingJob {
  id: string;
  event_id: string;
  media_id: string | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  total_items: number;
  processed_items: number;
  error_message: string | null;
  attempts: number;
  last_attempt_at: Date | null;
  completed_at: Date | null;
  job_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DownloadJob {
  id: string;
  event_id: string;
  status: JobStatus;
  storage_key: string | null;
  file_size: number | null;
  expires_at: Date;
  created_at: Date;
  completed_at: Date | null;
  media_ids?: string[] | null;
  requested_count?: number;
  processed_count?: number;
  progress?: number;
  error_message?: string | null;
  download_type?: string;
}

export interface GuestSession {
  id: string;
  event_id: string;
  token_hash: string;
  ip_address_hash: string | null;
  expires_at: Date;
  created_at: Date;
  last_used_at: Date;
}

export interface StorageUsage {
  id: string;
  event_id: string;
  original_bytes: number;
  preview_bytes: number;
  thumbnail_bytes: number;
  video_bytes: number;
  total_bytes: number;
  last_calculated_at: Date;
}

export interface SchemaMigration {
  id: number;
  name: string;
  applied_at: Date;
}
