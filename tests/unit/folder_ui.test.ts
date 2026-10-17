import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CreateFolderModal,
  RenameFolderModal,
  DeleteFolderModal,
  FolderDetailModal,
} from '../../apps/web/components/dashboard/FolderModals.js';
import { FolderManagement } from '../../apps/web/components/dashboard/FolderManagement.js';
import type { FolderItem } from '@photography-saas/types';

describe('Folder Management UI Components (Server & Node Rendering)', () => {
  const dummyFolder: FolderItem = {
    id: 'f0000000-0000-0000-0000-000000000001',
    event_id: 'e0000000-0000-0000-0000-000000000001',
    name: 'Ceremony & Vows',
    sort_order: 1,
    media_count: 42,
    created_at: '2026-10-09T10:00:00.000Z',
    updated_at: '2026-10-09T10:00:00.000Z',
  };

  describe('CreateFolderModal', () => {
    it('should render dialog with input, accessible label, and create CTA', () => {
      const html = renderToStaticMarkup(
        React.createElement(CreateFolderModal, {
          isOpen: true,
          onClose: () => {},
          eventId: 'e0000000-0000-0000-0000-000000000001',
          onCreated: () => {},
        })
      );

      expect(html).toContain('Create Ceremony Folder');
      expect(html).toContain('Folder Name');
      expect(html).toContain('create-folder-name');
      expect(html).toContain('Create Folder');
      expect(html).toContain('role="dialog"');
    });

    it('should return null when isOpen=false', () => {
      const html = renderToStaticMarkup(
        React.createElement(CreateFolderModal, {
          isOpen: false,
          onClose: () => {},
          eventId: 'e0000000-0000-0000-0000-000000000001',
          onCreated: () => {},
        })
      );
      expect(html).toBe('');
    });
  });

  describe('RenameFolderModal', () => {
    it('should render rename dialog with current folder name pre-filled', () => {
      const html = renderToStaticMarkup(
        React.createElement(RenameFolderModal, {
          isOpen: true,
          onClose: () => {},
          eventId: 'e0000000-0000-0000-0000-000000000001',
          folder: dummyFolder,
          onRenamed: () => {},
        })
      );

      expect(html).toContain('Rename Folder');
      expect(html).toContain('value="Ceremony &amp; Vows"');
      expect(html).toContain('Save Changes');
    });
  });

  describe('DeleteFolderModal (Safe Deletion)', () => {
    it('CRITICAL RULE: should display explicit Safe Deletion Guarantee and event root reassignment', () => {
      const html = renderToStaticMarkup(
        React.createElement(DeleteFolderModal, {
          isOpen: true,
          onClose: () => {},
          eventId: 'e0000000-0000-0000-0000-000000000001',
          folder: dummyFolder,
          onDeleted: () => {},
        })
      );

      expect(html).toContain('Safe Deletion Guarantee');
      expect(html).toContain('Deleting this folder will');
      expect(html).toContain('NOT');
      expect(html).toContain('delete any photos or videos');
      expect(html).toContain('Event Root (Uncategorized)');
      expect(html).toContain('42 media items will be reassigned to the event root');
      expect(html).toContain('Delete Folder Safely');
    });
  });

  describe('FolderDetailModal', () => {
    it('should render folder specifications and note regarding Phase 10 uploading', () => {
      const html = renderToStaticMarkup(
        React.createElement(FolderDetailModal, {
          isOpen: true,
          onClose: () => {},
          folder: dummyFolder,
          onOpenRename: () => {},
          onOpenDelete: () => {},
        })
      );

      expect(html).toContain('Ceremony &amp; Vows');
      expect(html).toContain('42 items');
      expect(html).toContain('#1');
      expect(html).toContain('Phase 10');
    });
  });

  describe('FolderManagement Component', () => {
    it('should render skeleton loading state initially during server rendering', () => {
      const html = renderToStaticMarkup(
        React.createElement(FolderManagement, {
          eventId: 'e0000000-0000-0000-0000-000000000001',
          eventName: 'Grand Wedding 2026',
        })
      );

      expect(html).toContain('animate-pulse');
    });
  });
});
