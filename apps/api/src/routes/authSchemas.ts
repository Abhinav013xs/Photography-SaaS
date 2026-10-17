import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Valid email address required')
    .max(255, 'Email cannot exceed 255 characters'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password cannot be empty')
    .max(128, 'Password cannot exceed 128 characters'),
});

export const passwordChangeSchema = z.object({
  currentPassword: z
    .string({ required_error: 'Current password is required' })
    .min(1, 'Current password cannot be empty'),
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(8, 'New password must be at least 8 characters long')
    .max(128, 'New password cannot exceed 128 characters'),
});

export const profileUpdateSchema = z.object({
  businessName: z.string().min(1).max(255).optional(),
  tagline: z.string().max(255).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  website: z.string().url('Must be a valid URL').optional().nullable().or(z.literal('')),
  instagram: z.string().max(100).optional().nullable(),
});
