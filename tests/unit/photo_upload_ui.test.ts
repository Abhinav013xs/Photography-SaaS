import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UploadModal } from '../../apps/web/components/dashboard/UploadModal.js';
import { MediaGallery } from '../../apps/web/components/dashboard/MediaGallery.js';
import type { FolderItem } from '@photography-saas/types';

describe('Photo Upload UI Components (Server & Static Rendering)', () => {
  const dummyFolders: FolderItem[] = [
    {
      id: 'f0000000-0000-0000-0000-000000000001',
      event_id: 'e0000000-0000-0000-0000-000000000001',
      name: 'Ceremony',
      sort_order: 0,
      media_count: 12,
      created_at: '2026-10-09T10:00:00.000Z',
      updated_at: '2026-10-09T10:00:00.000Z',
    },
    {
      id: 'f0000000-0000-0000-0000-000000000002',
      event_id: 'e0000000-0000-0000-0000-000000000001',
      name: 'Reception',
      sort_order: 1,
      media_count: 24,
      created_at: '2026-10-09T10:00:00.000Z',
      updated_at: '2026-10-09T10:00:00.000Z',
    },
  ];

  describe('UploadModal UI', () => {
    it('renders modal dialog with destination folder selector and dropzone', () => {
      const html = renderToStaticMarkup(
        React.createElement(UploadModal, {
          isOpen: true,
          onClose: () => {},
          eventId: 'e0000000-0000-0000-0000-000000000001',
          eventName: 'Highland Wedding 2026',
          folders: dummyFolders,
        })
      );

      expect(html).toContain('Photo Upload Engine');
      expect(html).toContain('Highland Wedding 2026');
      expect(html).toContain('Add High-Resolution Photographs');
      expect(html).toContain('Event Root (Uncategorized)');
      expect(html).toContain('Ceremony');
      expect(html).toContain('Reception');
      expect(html).toContain('Direct-to-R2');
      expect(html).toContain('Drag &amp; drop photos here');
      expect(html).toContain('role="dialog"');
    });

    it('returns empty string when isOpen=false', () => {
      const html = renderToStaticMarkup(
        React.createElement(UploadModal, {
          isOpen: false,
          onClose: () => {},
          eventId: 'e0000000-0000-0000-0000-000000000001',
          eventName: 'Highland Wedding 2026',
          folders: dummyFolders,
        })
      );

      expect(html).toBe('');
    });
  });

  describe('MediaGallery UI', () => {
    it('renders gallery action bar with folder filter and upload trigger button', () => {
      const html = renderToStaticMarkup(
        React.createElement(MediaGallery, {
          eventId: 'e0000000-0000-0000-0000-000000000001',
          eventName: 'Highland Wedding 2026',
        })
      );

      expect(html).toContain('Folder:');
      expect(html).toContain('All Photos');
      expect(html).toContain('Event Root (Uncategorized)');
      expect(html).toContain('Upload Photos');
    });
  });
});
