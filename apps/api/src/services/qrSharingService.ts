import QRCode from 'qrcode';
import { getConfig } from '@photography-saas/config';
import { ValidationError } from '@photography-saas/errors';
import type { EventQrShareDTO, EventVisibility } from '@photography-saas/types';
import { isEventExpired } from './galleryExpiryService.js';

/**
 * Builds the canonical guest gallery URL for an event.
 * Uses the strictly configured application origin and the public event slug.
 * Prevents HTTP Host header poisoning, path traversal, and leaking private tokens/PINs.
 */
export function buildCanonicalGuestUrl(slug: string, customAppUrl?: string): string {
  if (!slug || typeof slug !== 'string' || !slug.trim()) {
    throw new ValidationError('A valid event slug is required to build the canonical gallery URL.');
  }

  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, '');

  if (cleanSlug.includes('?') || cleanSlug.includes('#') || cleanSlug.includes('..')) {
    throw new ValidationError('Event slug contains invalid characters for URL generation.');
  }

  const rawBase = customAppUrl || getConfig().appUrl;
  if (!rawBase || typeof rawBase !== 'string') {
    throw new ValidationError('Application base URL configuration is missing or invalid.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawBase);
  } catch {
    throw new ValidationError(`Invalid application base URL configured: "${rawBase}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`Application base URL must use http or https protocol: "${rawBase}"`);
  }

  // Remove trailing slashes from the configured origin/base path
  const normalizedBase = rawBase.replace(/\/+$/, '');

  return `${normalizedBase}/gallery/${encodeURIComponent(cleanSlug)}`;
}

/**
 * Sanitizes an event name to produce a safe, descriptive download filename for QR codes.
 * Replaces non-alphanumeric characters with underscores and prevents path traversal.
 */
export function sanitizeQrFilename(eventName: string, extension: 'png' | 'svg'): string {
  if (extension !== 'png' && extension !== 'svg') {
    throw new ValidationError(`Unsupported QR file extension: "${extension}". Only "png" and "svg" are permitted.`);
  }

  const rawClean = (eventName || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '');

  const hasAlphanumeric = /[a-zA-Z0-9]/.test(rawClean);
  const baseName = hasAlphanumeric ? rawClean : 'Event';
  return `${baseName}_QR.${extension}`;
}

export interface EventForQrGeneration {
  id: string;
  slug: string;
  name: string;
  client_name: string;
  event_date: string | Date;
  pin_enabled: boolean;
  visibility: EventVisibility;
  public_until: string | Date | null;
}

/**
 * Generates both high-resolution PNG data URL and SVG vector markup for an event's canonical guest URL.
 * Employs local in-process QR generation without third-party external services.
 */
export async function generateEventQrCode(
  event: EventForQrGeneration,
  customAppUrl?: string
): Promise<EventQrShareDTO> {
  const shareUrl = buildCanonicalGuestUrl(event.slug, customAppUrl);

  // Generate high-resolution PNG Data URL (1000px, print-ready, high error correction)
  const qrDataUrl = await QRCode.toDataURL(shareUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 1000,
    color: {
      dark: '#0a0b0d', // Deep carbon brand accent
      light: '#ffffff', // Clean white background
    },
  });

  // Generate clean SVG vector string
  const rawSvg = await QRCode.toString(shareUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: {
      dark: '#0a0b0d',
      light: '#ffffff',
    },
  });

  // Ensure SVG markup is safe (starts with <svg and contains no executable script)
  if (!rawSvg.startsWith('<svg') || rawSvg.toLowerCase().includes('<script')) {
    throw new Error('Failed to generate safe SVG QR code markup.');
  }

  const isExpired = isEventExpired(event.public_until);
  const eventDateStr =
    typeof event.event_date === 'string'
      ? event.event_date.split('T')[0]
      : new Date(event.event_date).toISOString().split('T')[0];

  return {
    shareUrl,
    qrDataUrl,
    qrSvg: rawSvg,
    eventName: event.name,
    clientName: event.client_name,
    eventDate: eventDateStr,
    pinProtected: Boolean(event.pin_enabled),
    visibility: event.visibility,
    isExpired,
    publicUntil: event.public_until ? new Date(event.public_until).toISOString() : null,
  };
}
