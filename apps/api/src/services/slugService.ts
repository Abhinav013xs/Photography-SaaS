import { query } from '../infrastructure/database.js';

/**
 * Normalizes an arbitrary text string into a clean, URL-safe kebab-case slug.
 */
export function normalizeSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word characters (except spaces and hyphens)
    .replace(/[\s_-]+/g, '-') // Replace spaces, underscores, and multiple hyphens with a single hyphen
    .replace(/^-+|-+$/g, '') // Trim leading/trailing hyphens
    .substring(0, 80)
    .replace(/-+$/, ''); // Maximum 80 characters without trailing hyphen
}

/**
 * Resolves a unique slug in the database.
 * If the proposed slug already exists, appends incremental numeric suffixes (-2, -3, etc.).
 */
export async function resolveUniqueSlug(
  baseName: string,
  existingEventId?: string
): Promise<string> {
  let baseSlug = normalizeSlug(baseName);
  if (!baseSlug) {
    baseSlug = 'event';
  }

  let candidateSlug = baseSlug;
  let counter = 1;

  while (true) {
    const res = await query<{ id: string }>(
      'SELECT id FROM events WHERE slug = $1 LIMIT 1',
      [candidateSlug]
    );

    // If no collision or collision belongs to the event being edited
    if (res.rows.length === 0 || (existingEventId && res.rows[0].id === existingEventId)) {
      return candidateSlug;
    }

    counter++;
    candidateSlug = `${baseSlug}-${counter}`;
  }
}
