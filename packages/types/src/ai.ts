/**
 * AI Biometric Face Detection & Embedding Type Contracts
 * Phase 14 (YuNet Face Detection) and Phase 15 (SFace Vector Embeddings)
 */

export interface FaceLandmark {
  x: number;
  y: number;
}

export interface DetectedFaceDTO {
  faceIndex: number;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  confidence: number;
  landmarks?: FaceLandmark[];
}

export interface FaceDetectionResponseDTO {
  status: 'success' | 'error';
  faceCount: number;
  faces: DetectedFaceDTO[];
}

export interface ExtractedFaceEmbeddingDTO {
  faceIndex: number;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  confidence: number;
  modelName: string;
  modelVersion: string;
  embedding: number[];
}

export interface FaceEmbeddingResponseDTO {
  status: 'success' | 'error';
  faceCount: number;
  faces: ExtractedFaceEmbeddingDTO[];
}

export interface IndexPhotoFacesResult {
  mediaId: string;
  eventId: string;
  facesDetected: number;
  embeddingsCount: number;
  status: 'completed' | 'skipped' | 'failed';
  error?: string;
}

/**
 * Phase 16: AI Face Search & Intelligent Photo Matching
 */

export interface QueryFaceEmbeddingDTO {
  confidence: number;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  modelName: string;
  modelVersion: string;
  embedding: number[];
}

export interface ProcessQuerySelfieResponseDTO {
  status: 'success' | 'error';
  face: QueryFaceEmbeddingDTO;
}

export interface FaceSearchResultItemDTO {
  mediaId: string;
  filename: string;
  width: number | null;
  height: number | null;
  storageKeyPreview: string | null;
  storageKeyThumbnail: string | null;
  createdAt: string;
  matchRank: number;
  matchScore: number; // Cosine similarity calibrated [0, 1]
  cosineDistance: number; // pgvector cosine distance [0, 2]
}

export interface FaceSearchPaginationDTO {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface FaceSearchResponseDTO {
  status: 'completed' | 'no_matches';
  results: FaceSearchResultItemDTO[];
  pagination: FaceSearchPaginationDTO;
  queryFace: {
    confidence: number;
    boxX: number;
    boxY: number;
    boxW: number;
    boxH: number;
  };
  searchDurationMs: number;
}

export interface FaceSearchOptions {
  limit?: number;
  offset?: number;
  threshold?: number; // Cosine distance threshold (default 0.363)
}

