export type UploadItemStatus =
  | 'Selected'
  | 'Validating'
  | 'Waiting'
  | 'Uploading'
  | 'Finalizing'
  | 'Uploaded'
  | 'Failed'
  | 'Cancelled';

export interface UploadQueueItem {
  id: string; // client unique ID
  file: File;
  name: string;
  size: number;
  mimeType: string;
  mediaType: 'photo' | 'video';
  folderId: string | null;
  status: UploadItemStatus;
  progressPercent: number; // 0 - 100
  bytesUploaded: number;
  errorMessage?: string;
  mediaId?: string;
  storageKey?: string;
  uploadUrl?: string;
  xhr?: XMLHttpRequest;
}

export const MAX_PHOTO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_BATCH_FILES = 500;
export const DEFAULT_CONCURRENCY = 4;

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const ALLOWED_VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm'];

/**
 * Validates a candidate photo or video file on the client prior to queueing.
 * Returns { error: string | null, mediaType: 'photo' | 'video' }.
 */
export function validateClientMediaFile(file: File): {
  error: string | null;
  mediaType: 'photo' | 'video';
} {
  if (!file) return { error: 'No file provided', mediaType: 'photo' };

  const name = file.name.trim();
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === name.length - 1) {
    return {
      error: 'File has no extension. Supported: JPEG, PNG, WebP photos; MP4, MOV, WebM videos.',
      mediaType: 'photo',
    };
  }

  const ext = name.slice(dotIndex + 1).toLowerCase();

  // SVG check
  if (ext === 'svg' || file.type.includes('svg')) {
    return {
      error: 'Vector SVG files are not supported as photography assets.',
      mediaType: 'photo',
    };
  }

  // HEIC / HEIF check
  if (ext === 'heic' || ext === 'heif' || file.type.includes('heic') || file.type.includes('heif')) {
    return {
      error: 'HEIC/HEIF is not currently supported in browser processing. Please convert to JPEG or WebP.',
      mediaType: 'photo',
    };
  }

  const isPhoto = ALLOWED_EXTENSIONS.includes(ext);
  const isVideo = ALLOWED_VIDEO_EXTENSIONS.includes(ext);

  if (!isPhoto && !isVideo) {
    return {
      error: `Unsupported extension ".${ext}". Supported: JPEG, PNG, WebP photos; MP4, MOV, WebM videos.`,
      mediaType: 'photo',
    };
  }

  const mediaType: 'photo' | 'video' = isVideo ? 'video' : 'photo';

  // MIME type check
  if (file.type) {
    const fileType = file.type.toLowerCase();
    if (isPhoto && !ALLOWED_MIME_TYPES.includes(fileType)) {
      return {
        error: `Unsupported format "${file.type}". Supported photo formats: JPEG, PNG, and WebP.`,
        mediaType,
      };
    }
    if (isVideo && !ALLOWED_VIDEO_MIME_TYPES.includes(fileType)) {
      return {
        error: `Unsupported video format "${file.type}". Supported video formats: MP4, MOV, and WebM.`,
        mediaType,
      };
    }
  }

  // Size checks
  if (file.size <= 0) {
    return { error: 'File is empty (0 bytes).', mediaType };
  }

  const maxSize = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_PHOTO_SIZE_BYTES;
  if (file.size > maxSize) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    const maxMb = Math.round(maxSize / (1024 * 1024));
    return {
      error: `File size (${sizeMb} MB) exceeds maximum allowed size of ${maxMb} MB for ${mediaType}s.`,
      mediaType,
    };
  }

  return { error: null, mediaType };
}

/**
 * Validates a candidate photo file on the client prior to queueing.
 * Returns null if valid, or a descriptive error message if invalid.
 */
export function validateClientPhotoFile(file: File): string | null {
  const result = validateClientMediaFile(file);
  if (result.error) return result.error;
  if (result.mediaType !== 'photo') {
    return 'Only JPEG, PNG, and WebP photos are supported in this photo selection.';
  }
  return null;
}

/**
 * Formats byte values into human-readable strings.
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
