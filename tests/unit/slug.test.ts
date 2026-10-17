import { describe, it, expect } from 'vitest';
import { normalizeSlug } from '../../apps/api/src/services/slugService.js';

describe('Slug Generation & Normalization Unit Tests', () => {
  it('should convert standard names to lowercase kebab-case', () => {
    expect(normalizeSlug('Wedding Reception')).toBe('wedding-reception');
    expect(normalizeSlug('Summer Festival 2026')).toBe('summer-festival-2026');
  });

  it('should strip special characters, punctuation, and ampersands', () => {
    expect(normalizeSlug('Ananya & Rahul — Wedding')).toBe('ananya-rahul-wedding');
    expect(normalizeSlug("Aarav's 5th Birthday!")).toBe('aaravs-5th-birthday');
    expect(normalizeSlug('Corporate Gala: Leadership Summit #1')).toBe('corporate-gala-leadership-summit-1');
  });

  it('should collapse multiple spaces, underscores, and consecutive hyphens', () => {
    expect(normalizeSlug('Pre-Wedding   Photoshoot___2026')).toBe('pre-wedding-photoshoot-2026');
    expect(normalizeSlug('---Leading---and---Trailing---')).toBe('leading-and-trailing');
  });

  it('should truncate strings exceeding maximum base length of 80 characters', () => {
    const veryLongName = 'This is an exceedingly long photography event title intended to test truncation boundaries in slug generation';
    const slug = normalizeSlug(veryLongName);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).toBe('this-is-an-exceedingly-long-photography-event-title-intended-to-test-truncation');
  });
});
