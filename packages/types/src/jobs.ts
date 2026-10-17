/**
 * Domain Background Queue & Job Types
 * Phase 13: Background Job & Worker Infrastructure
 * Phase 29: Background Job Reliability, Retries & Failure Recovery
 */

export const QUEUE_NAMES = {
  PHOTO: 'photo-processing',
  VIDEO: 'video-processing',
  PHOTO_PROCESSING: 'photo-processing',
  VIDEO_PROCESSING: 'video-processing',
  FACE_INDEXING: 'face-indexing',
  ZIP_GENERATION: 'zip-generation',
  GALLERY_EXPIRY: 'gallery-expiry',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

export type JobStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'retry_wait'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type JobType =
  | 'photo_processing'
  | 'face_indexing'
  | 'video_processing'
  | 'zip_generation';

export interface PhotoProcessingJobPayload {
  mediaId: string;
  eventId: string;
  version?: number;
  jobVersion?: number;
  timestamp?: number;
  correlationId?: string;
}

export interface VideoProcessingJobPayload {
  mediaId: string;
  eventId: string;
  version?: number;
  jobVersion?: number;
  timestamp?: number;
  correlationId?: string;
}

export interface GalleryExpiryJobPayload {
  eventId: string;
  expectedExpiresAt?: string;
  timestamp?: number;
}

export interface ZipGenerationJobPayload {
  jobId: string;
  eventId: string;
  mediaIds?: string[];
  timestamp?: number;
}

export interface QueueMetrics {
  queue: string;
  queueName?: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused?: number;
  isPaused?: boolean;
}

export interface WorkerStatus {
  name?: string;
  queue?: string;
  queueName: string;
  isRunning: boolean;
  concurrency: number;
  activeJobs?: number;
}

export interface BackgroundInfrastructureHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  redis?: unknown;
  redisConnected?: boolean;
  queues: QueueMetrics[];
  workers: WorkerStatus[];
  message?: string;
  stuckJobsReclaimed?: number;
}

export interface DurableProcessingJob {
  id: string;
  eventId: string;
  mediaId: string | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  totalItems: number;
  processedItems: number;
  attempts: number;
  maxAttempts: number;
  startedAt: string | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  workerId: string | null;
  leaseExpiresAt: string | null;
  idempotencyKey: string | null;
  correlationId: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}
