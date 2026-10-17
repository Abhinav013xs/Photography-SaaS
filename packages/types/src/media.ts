import type { MediaType, MediaProcessingStatus } from './database.js';

export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedPhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

export const ALLOWED_PHOTO_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
] as const;

export type AllowedPhotoExtension = (typeof ALLOWED_PHOTO_EXTENSIONS)[number];

export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;

export type AllowedVideoMimeType = (typeof ALLOWED_VIDEO_MIME_TYPES)[number];

export const ALLOWED_VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'webm',
] as const;

export type AllowedVideoExtension = (typeof ALLOWED_VIDEO_EXTENSIONS)[number];

export const MAX_PHOTO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB per photo
export const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB per video
export const MAX_UPLOAD_BATCH_SIZE = 500; // 500 items per batch
export const DEFAULT_UPLOAD_CONCURRENCY = 4; // 4 simultaneous client uploads

export type AllowedMediaMimeType = AllowedPhotoMimeType | AllowedVideoMimeType;
export type AllowedMediaExtension = AllowedPhotoExtension | AllowedVideoExtension;

export interface PresignPhotoItemDTO {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  folderId?: string | null;
  type?: MediaType;
}

export type PresignMediaItemDTO = PresignPhotoItemDTO;

export interface PresignBatchRequestDTO {
  folderId?: string | null;
  items: PresignPhotoItemDTO[];
}

export interface PresignedUploadItem {
  mediaId: string;
  originalName: string;
  filename: string;
  storageKey: string;
  uploadUrl: string;
  expiresAt: string;
  folderId: string | null;
}

export interface PresignBatchResponseDTO {
  items: PresignedUploadItem[];
}

export interface ConfirmPhotoItemDTO {
  mediaId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  folderId?: string | null;
  type?: MediaType;
}

export type ConfirmMediaItemDTO = ConfirmPhotoItemDTO;

export interface ConfirmBatchRequestDTO {
  items: ConfirmPhotoItemDTO[];
}

export interface ConfirmedMediaItem {
  id: string;
  eventId: string;
  folderId: string | null;
  type: MediaType;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storageKeyOriginal: string;
  status: MediaProcessingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmBatchResponseDTO {
  confirmed: ConfirmedMediaItem[];
  failed: Array<{ mediaId: string; error: string }>;
}

export interface MediaListItem {
  id: string;
  eventId: string;
  folderId: string | null;
  folderName?: string | null;
  type: MediaType;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storageKeyOriginal: string;
  storageKeyPreview: string | null;
  storageKeyThumbnail: string | null;
  thumbnailSize?: number | null;
  previewSize?: number | null;
  videoDuration?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  processingError?: string | null;
  processedAt?: string | null;
  status: MediaProcessingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MediaListQueryDTO {
  folderId?: string;
  type?: 'photo' | 'video' | 'all';
  status?: MediaProcessingStatus | 'all';
  page?: number;
  limit?: number;
}

export interface ProcessPhotoResponseDTO {
  mediaId: string;
  status: MediaProcessingStatus;
  thumbnailKey?: string | null;
  previewKey?: string | null;
  thumbnailSize?: number | null;
  previewSize?: number | null;
  width?: number | null;
  height?: number | null;
  error?: string | null;
  skipped?: boolean;
}

export interface ProcessBatchResponseDTO {
  processed: ProcessPhotoResponseDTO[];
  failed: Array<{ mediaId: string; error: string }>;
}

export interface VideoProbeMetadata {
  duration: number; // Duration in seconds
  width: number;
  height: number;
  videoCodec: string;
  audioCodec?: string | null;
  bitrate?: number | null;
  frameRate?: number | null;
}

export interface ProcessVideoResponseDTO {
  mediaId: string;
  status: MediaProcessingStatus;
  posterKey?: string | null;
  playbackKey?: string | null;
  posterSize?: number | null;
  playbackSize?: number | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  error?: string | null;
}
