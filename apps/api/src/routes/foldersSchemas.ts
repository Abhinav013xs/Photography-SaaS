import { z } from 'zod';

export const createFolderSchema = z.object({
  name: z
    .string({ required_error: 'Folder name is required' })
    .trim()
    .min(1, 'Folder name cannot be empty or whitespace-only')
    .max(255, 'Folder name cannot exceed 255 characters'),
  sort_order: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Folder name cannot be empty or whitespace-only')
    .max(255, 'Folder name cannot exceed 255 characters')
    .optional(),
  sort_order: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const eventParamsSchema = z.object({
  eventId: z.string().uuid('Event identifier must be a valid UUID'),
});

export const eventFolderParamsSchema = z.object({
  eventId: z.string().uuid('Event identifier must be a valid UUID'),
  folderId: z.string().uuid('Folder identifier must be a valid UUID'),
});

export const moveMediaParamsSchema = z.object({
  eventId: z.string().uuid('Event identifier must be a valid UUID'),
  mediaId: z.string().uuid('Media identifier must be a valid UUID'),
});

export const moveMediaBodySchema = z.object({
  folder_id: z.string().uuid('Folder identifier must be a valid UUID').nullable().optional(),
  folderId: z.string().uuid('Folder identifier must be a valid UUID').nullable().optional(),
});

export const batchMoveMediaBodySchema = z.object({
  media_ids: z.array(z.string().uuid('Each media ID must be a valid UUID')).optional(),
  mediaIds: z.array(z.string().uuid('Each media ID must be a valid UUID')).optional(),
  target_folder_id: z.string().uuid('Target folder identifier must be a valid UUID').nullable().optional(),
  targetFolderId: z.string().uuid('Target folder identifier must be a valid UUID').nullable().optional(),
});
