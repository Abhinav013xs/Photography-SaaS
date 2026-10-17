import { z } from 'zod';

export const createEventSchema = z.object({
  name: z.string().trim().min(1, 'Event name is required').max(255, 'Event name cannot exceed 255 characters'),
  client_name: z.string().trim().min(1, 'Client name is required').max(255, 'Client name cannot exceed 255 characters'),
  client_email: z.string().trim().email('Invalid client email address').max(255).optional().nullable(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Event date must be formatted as YYYY-MM-DD'),
  location: z.string().trim().max(255).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  slug: z
    .string()
    .trim()
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Custom slug must consist only of lowercase letters, numbers, and hyphens')
    .optional(),
  visibility: z.enum(['public', 'private']).default('private'),
  status: z.enum(['draft', 'active']).default('draft'),
  public_start: z.string().optional().nullable(),
  public_until: z.string().optional().nullable(),
  public_duration_days: z
    .number()
    .int('Public duration must be a whole number of days')
    .min(1, 'Public duration must be at least 1 day')
    .max(30, 'Public duration cannot exceed 30 days')
    .default(30),
  pin_enabled: z.boolean().default(false),
  pin: z.string().regex(/^\d{4,8}$/, 'PIN must consist of 4 to 8 numeric digits').optional().nullable(),
  allow_downloads: z.boolean().default(false),
  allow_photo_downloads: z.boolean().default(true),
  allow_bulk_downloads: z.boolean().default(true),
  allow_video_downloads: z.boolean().default(true),
  watermark_enabled: z.boolean().default(false),
  watermark_text: z.string().trim().max(100, 'Watermark text cannot exceed 100 characters').default('Studio Lumina'),
  watermark_opacity: z.coerce.number().min(0.05, 'Watermark opacity must be at least 5%').max(1.0, 'Watermark opacity cannot exceed 100%').default(0.35),
  watermark_size: z.enum(['small', 'medium', 'large']).default('medium'),
  watermark_position: z.enum(['center', 'bottom-right', 'bottom-center']).default('bottom-right'),
  watermark_color: z.enum(['white', 'black']).default('white'),
  face_search_enabled: z.boolean().default(true),
  cover_photo_id: z.string().uuid().optional().nullable(),
});

export const updateEventSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  client_name: z.string().trim().min(1).max(255).optional(),
  client_email: z.string().trim().email('Invalid client email address').max(255).optional().nullable(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Event date must be formatted as YYYY-MM-DD').optional(),
  location: z.string().trim().max(255).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  slug: z
    .string()
    .trim()
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Custom slug must consist only of lowercase letters, numbers, and hyphens')
    .optional(),
  visibility: z.enum(['public', 'private']).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  public_start: z.string().optional().nullable(),
  public_until: z.string().optional().nullable(),
  public_duration_days: z
    .number()
    .int('Public duration must be a whole number of days')
    .min(1, 'Public duration must be at least 1 day')
    .max(30, 'Public duration cannot exceed 30 days')
    .optional(),
  pin_enabled: z.boolean().optional(),
  pin: z.string().regex(/^\d{4,8}$/, 'PIN must consist of 4 to 8 numeric digits').optional().nullable(),
  allow_downloads: z.boolean().optional(),
  allow_photo_downloads: z.boolean().optional(),
  allow_bulk_downloads: z.boolean().optional(),
  allow_video_downloads: z.boolean().optional(),
  watermark_enabled: z.boolean().optional(),
  watermark_text: z.string().trim().max(100, 'Watermark text cannot exceed 100 characters').optional().nullable(),
  watermark_opacity: z.coerce.number().min(0.05, 'Watermark opacity must be at least 5%').max(1.0, 'Watermark opacity cannot exceed 100%').optional(),
  watermark_size: z.enum(['small', 'medium', 'large']).optional(),
  watermark_position: z.enum(['center', 'bottom-right', 'bottom-center']).optional(),
  watermark_color: z.enum(['white', 'black']).optional(),
  face_search_enabled: z.boolean().optional(),
  cover_photo_id: z.string().uuid().optional().nullable(),
});

export const listEventsQuerySchema = z.object({
  status: z.enum(['draft', 'active', 'archived', 'trashed', 'all']).optional(),
  visibility: z.enum(['public', 'private', 'all']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const eventIdParamSchema = z.object({
  id: z.string().uuid('Event identifier must be a valid UUID'),
});

export const deleteEventBodySchema = z
  .object({
    confirmEventName: z.string().optional(),
    confirmName: z.string().optional(),
    permanent: z.boolean().optional(),
  })
  .optional();

export const emptyBinBodySchema = z
  .object({
    confirm: z.boolean().optional(),
  })
  .optional();

export const publishEventBodySchema = z.object({
  public_start: z.string().optional(),
  public_until: z.string().optional(),
  public_duration_days: z
    .number()
    .int('Public duration must be a whole number of days')
    .min(1, 'Public duration must be at least 1 day')
    .max(30, 'Public duration cannot exceed 30 days')
    .optional(),
});

export const updateVisibilitySchema = z.object({
  visibility: z.enum(['public', 'private'], {
    errorMap: () => ({ message: "Visibility must be either 'public' or 'private'" }),
  }),
  public_duration_days: z
    .number()
    .int('Public duration must be a whole number of days')
    .min(1, 'Public duration must be at least 1 day')
    .max(30, 'Public duration cannot exceed 30 days')
    .optional(),
});

