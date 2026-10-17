/**
 * Phase 18: Guest PIN Protection & Temporary Sessions Types
 */

export interface VerifyPinRequestDTO {
  pin: string;
}

export interface VerifyPinResponseDTO {
  success: boolean;
  guestToken: string;
  expiresInSeconds: number;
  eventId: string;
}

export interface GuestEventMetadataDTO {
  id: string;
  slug: string;
  name: string;
  client_name: string;
  event_date: string;
  location: string | null;
  description: string | null;
  status: string;
  visibility: string;
  public_until: string | null;
  is_expired: boolean;
  pin_protected: boolean;
  allow_downloads: boolean;
  watermark_enabled: boolean;
  watermark_text: string | null;
  face_search_enabled: boolean;
  cover_photo_id: string | null;
  cover_preview_url?: string | null;
  photographer: {
    business_name: string;
    tagline: string | null;
    instagram: string | null;
    website: string | null;
  };
}

export interface GuestSessionTokenPayload {
  eventId: string;
  sessionId: string;
  role: 'guest';
  iat?: number;
  exp?: number;
}

export interface DownloadJobResponseDTO {
  jobId: string;
  eventId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  requestedCount: number;
  processedCount: number;
  fileSize: number | null;
  storageKey: string | null;
  downloadUrl?: string | null;
  expiresAt: string;
  completedAt?: string | null;
  error?: string | null;
}

export interface IndividualDownloadResponseDTO {
  mediaId: string;
  eventId: string;
  filename: string;
  downloadUrl: string;
  expiresInSeconds: number;
  expiresAt: string;
  fileSize: number;
  mimeType: string;
}
