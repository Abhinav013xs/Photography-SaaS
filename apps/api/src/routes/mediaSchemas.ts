import { z } from 'zod';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const eventParamsSchema = z.object({
  eventId: z.string().regex(uuidRegex, { message: 'eventId must be a valid UUID' }),
});

export const presignPhotoItemSchema = z.object({
  filename: z.string().min(1, 'Filename is required').max(255, 'Filename is too long'),
  mimeType: z.string().min(1, 'MIME type is required').max(100),
  sizeBytes: z.number().int().positive('Size must be a positive integer'),
  folderId: z.string().regex(uuidRegex, 'folderId must be a valid UUID').nullable().optional(),
});

export const presignBatchBodySchema = z.object({
  folderId: z.string().regex(uuidRegex, 'folderId must be a valid UUID').nullable().optional(),
  items: z
    .array(presignPhotoItemSchema)
    .min(1, 'At least one photo item is required')
    .max(500, 'Batch upload cannot exceed 500 items'),
});

export const confirmPhotoItemSchema = z.object({
  mediaId: z.string().regex(uuidRegex, 'mediaId must be a valid UUID'),
  storageKey: z.string().min(1, 'storageKey is required').max(500),
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive('sizeBytes must be a positive integer'),
  folderId: z.string().regex(uuidRegex, 'folderId must be a valid UUID').nullable().optional(),
});

export const confirmBatchBodySchema = z.object({
  items: z
    .array(confirmPhotoItemSchema)
    .min(1, 'At least one photo item is required for confirmation')
    .max(500, 'Confirm batch cannot exceed 500 items'),
});

export const listMediaQuerySchema = z.object({
  folderId: z.string().optional(),
  type: z.enum(['photo', 'video', 'all']).optional(),
  status: z.enum(['uploaded', 'processing', 'ready', 'failed', 'all']).optional(),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(1, parseInt(val, 10) || 1) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(200, Math.max(1, parseInt(val, 10) || 50)) : 50)),
});

export const processMediaParamsSchema = z.object({
  eventId: z.string().regex(uuidRegex, { message: 'eventId must be a valid UUID' }),
  mediaId: z.string().regex(uuidRegex, { message: 'mediaId must be a valid UUID' }),
});

export const processBatchBodySchema = z.object({
  mediaIds: z
    .array(z.string().regex(uuidRegex, { message: 'Each item must be a valid UUID' }))
    .min(1, 'At least one mediaId is required')
    .max(500, 'Batch processing limit is 500 items'),
});

