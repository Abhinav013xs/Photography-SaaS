'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface DeleteEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventName: string;
  onConfirm: () => Promise<void>;
}

export function DeleteEventModal({
  isOpen,
  onClose,
  eventName,
  onConfirm,
}: DeleteEventModalProps) {
  const [confirmInput, setConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMatch = confirmInput.trim().toLowerCase() === eventName.trim().toLowerCase();

  const handleDelete = async () => {
    if (!isMatch) return;
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Event Container"
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-[#e63946]/10 border border-[#e63946]/20 rounded-md">
          <AlertTriangle className="w-5 h-5 text-[#e63946] shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="font-medium text-[#e63946]">
              Warning: Permanent Deletion Action
            </p>
            <p className="text-[#9ca3af] leading-relaxed">
              This action will permanently purge the event container{' '}
              <strong className="text-white font-medium">"{eventName}"</strong> and its
              relational records from the database. This action cannot be undone.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-[#e63946]/10 border border-[#e63946]/30 text-[#e63946] text-xs rounded-md">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label
            htmlFor="confirm-event-name"
            className="block text-xs font-medium text-[#9ca3af]"
          >
            Type <span className="text-white font-mono select-all">"{eventName}"</span> to confirm:
          </label>
          <input
            id="confirm-event-name"
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={eventName}
            className="w-full bg-[#121418] border border-[#20242a] focus:border-[#e63946] focus:ring-1 focus:ring-[#e63946] text-white text-xs px-3 py-2 rounded-md outline-none transition-colors"
            autoComplete="off"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#20242a]">
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
            onClick={handleDelete}
            disabled={!isMatch || isDeleting}
            isLoading={isDeleting}
          >
            Delete Permanently
          </Button>
        </div>
      </div>
    </Modal>
  );
}
