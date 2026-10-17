'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Folder, AlertTriangle, ShieldCheck, Info, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { FolderItem } from '@photography-saas/types';

// ============================================================================
// CREATE FOLDER MODAL
// ============================================================================

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  onCreated: (folder: FolderItem) => void;
}

export function CreateFolderModal({
  isOpen,
  onClose,
  eventId,
  onCreated,
}: CreateFolderModalProps) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Folder name cannot be empty or whitespace-only.');
      return;
    }
    if (trimmed.length > 255) {
      setError('Folder name cannot exceed 255 characters.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/events/${eventId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: trimmed }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        if (json.error?.code === 'FOLDER_NAME_CONFLICT') {
          throw new Error(`A folder named "${trimmed}" already exists in this event.`);
        }
        throw new Error(json.error?.message || 'Failed to create folder.');
      }

      onCreated(json.data.folder);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Ceremony Folder"
      description="Create a category folder to organize moments within this event."
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            className="p-3 bg-[#e63946]/10 border border-[#e63946]/30 text-[#e63946] text-xs rounded-md animate-in fade-in"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="create-folder-name"
            className="block text-xs font-medium text-[#9ca3af]"
          >
            Folder Name <span className="text-[#c5a059]">*</span>
          </label>
          <input
            id="create-folder-name"
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. Ceremony, Reception, Portraits, Haldi"
            maxLength={255}
            disabled={isSubmitting}
            className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs px-3.5 py-2.5 rounded-md outline-none transition-colors"
            autoComplete="off"
            required
          />
          <div className="flex justify-between text-[10px] text-[#6b7280]">
            <span>Must be unique within this event.</span>
            <span>{name.length}/255</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#20242a]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={isSubmitting}
            leftIcon={<Folder className="w-3.5 h-3.5" />}
          >
            Create Folder
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// RENAME FOLDER MODAL
// ============================================================================

interface RenameFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  folder: FolderItem | null;
  onRenamed: (updatedFolder: FolderItem) => void;
}

export function RenameFolderModal({
  isOpen,
  onClose,
  eventId,
  folder,
  onRenamed,
}: RenameFolderModalProps) {
  const [name, setName] = useState(folder ? folder.name : '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && folder) {
      setName(folder.name);
      setError(null);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [isOpen, folder]);

  if (!folder) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Folder name cannot be empty or whitespace-only.');
      return;
    }
    if (trimmed.length > 255) {
      setError('Folder name cannot exceed 255 characters.');
      return;
    }

    // If unchanged, simply close
    if (trimmed === folder.name) {
      onClose();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/events/${eventId}/folders/${folder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: trimmed }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        if (json.error?.code === 'FOLDER_NAME_CONFLICT') {
          throw new Error(`A folder named "${trimmed}" already exists in this event.`);
        }
        throw new Error(json.error?.message || 'Failed to rename folder.');
      }

      onRenamed(json.data.folder);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Rename Folder"
      description={`Renaming folder "${folder.name}". Media contents remain unaffected.`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            className="p-3 bg-[#e63946]/10 border border-[#e63946]/30 text-[#e63946] text-xs rounded-md animate-in fade-in"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="rename-folder-name"
            className="block text-xs font-medium text-[#9ca3af]"
          >
            New Folder Name <span className="text-[#c5a059]">*</span>
          </label>
          <input
            id="rename-folder-name"
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            maxLength={255}
            disabled={isSubmitting}
            className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs px-3.5 py-2.5 rounded-md outline-none transition-colors"
            autoComplete="off"
            required
          />
          <div className="flex justify-between text-[10px] text-[#6b7280]">
            <span>Must be unique within this event.</span>
            <span>{name.length}/255</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#20242a]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={isSubmitting}
          >
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// SAFE DELETE FOLDER MODAL
// ============================================================================

interface DeleteFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  folder: FolderItem | null;
  onDeleted: (folderId: string) => void;
}

export function DeleteFolderModal({
  isOpen,
  onClose,
  eventId,
  folder,
  onDeleted,
}: DeleteFolderModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!folder) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/events/${eventId}/folders/${folder.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Failed to delete folder.');
      }

      onDeleted(folder.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete folder.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Folder"
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        {/* Safety Guarantee Notice */}
        <div className="flex items-start gap-3 p-3.5 bg-[#121418] border border-[#20242a] rounded-md">
          <ShieldCheck className="w-5 h-5 text-[#c5a059] shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="font-medium text-white">
              Safe Deletion Guarantee
            </p>
            <p className="text-[#9ca3af] leading-relaxed">
              Deleting this folder will <strong className="text-white">NOT</strong> delete any photos or videos.
              All media currently in <span className="text-[#c5a059] font-medium">"{folder.name}"</span> will remain safely intact in the event and be moved to the <strong className="text-white">Event Root (Uncategorized)</strong>.
            </p>
          </div>
        </div>

        {folder.media_count > 0 && (
          <div className="p-3 bg-[#c5a059]/10 border border-[#c5a059]/20 rounded-md text-xs text-[#c5a059]">
            {folder.media_count} media item{folder.media_count === 1 ? '' : 's'} will be reassigned to the event root.
          </div>
        )}

        {error && (
          <div
            className="p-3 bg-[#e63946]/10 border border-[#e63946]/30 text-[#e63946] text-xs rounded-md"
            role="alert"
          >
            {error}
          </div>
        )}

        <p className="text-xs text-[#9ca3af]">
          Are you sure you want to remove the category folder{' '}
          <strong className="text-white">"{folder.name}"</strong>?
        </p>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#20242a]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            isLoading={isDeleting}
            onClick={handleDelete}
          >
            Delete Folder Safely
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// FOLDER DETAILS / INSPECT MODAL
// ============================================================================

interface FolderDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: FolderItem | null;
  onOpenRename: (folder: FolderItem) => void;
  onOpenDelete: (folder: FolderItem) => void;
}

export function FolderDetailModal({
  isOpen,
  onClose,
  folder,
  onOpenRename,
  onOpenDelete,
}: FolderDetailModalProps) {
  if (!folder) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={folder.name}
      description="Category Folder Details"
      maxWidth="max-w-md"
    >
      <div className="space-y-5 text-xs">
        <div className="p-4 bg-[#121418] border border-[#20242a] rounded-md space-y-3">
          <div className="flex justify-between py-1 border-b border-[#20242a]">
            <span className="text-[#9ca3af]">Folder Name</span>
            <span className="text-white font-medium">{folder.name}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-[#20242a]">
            <span className="text-[#9ca3af]">Organized Media</span>
            <span className="text-white font-mono">{folder.media_count} items</span>
          </div>
          <div className="flex justify-between py-1 border-b border-[#20242a]">
            <span className="text-[#9ca3af]">Display Order</span>
            <span className="text-white font-mono">#{folder.sort_order}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-[#20242a]">
            <span className="text-[#9ca3af]">Created At</span>
            <span className="text-[#9ca3af] font-mono">
              {new Date(folder.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-[#9ca3af]">Folder ID</span>
            <span className="text-[#9ca3af] font-mono select-all truncate max-w-[200px]">
              {folder.id}
            </span>
          </div>
        </div>

        {/* Informative notice regarding media uploading */}
        <div className="flex items-start gap-2.5 p-3 bg-[#20242a]/40 border border-[#20242a] rounded-md text-[11px] text-[#9ca3af]">
          <Info className="w-4 h-4 text-[#c5a059] shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Batch media uploading and Cloudflare R2 object storage will be integrated in Phase 10. Once media is added, photos and videos can be organized into this folder.
          </p>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-[#20242a]">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              onClose();
              onOpenDelete(folder);
            }}
          >
            Delete Folder
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                onOpenRename(folder);
              }}
            >
              Rename
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
