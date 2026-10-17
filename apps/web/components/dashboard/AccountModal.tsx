'use client';

import React from 'react';
import { ShieldCheck, LogOut } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { PhotographerProfile } from '@photography-saas/types';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  photographer: PhotographerProfile;
  onLogout: () => void;
}

export function AccountModal({
  isOpen,
  onClose,
  photographer,
  onLogout,
}: AccountModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Photographer Account & Session"
      description="Administrative security context and owner profile information."
      maxWidth="max-w-md"
    >
      <div className="space-y-5">
        {/* Profile Details */}
        <div className="space-y-3">
          <div className="p-3.5 bg-[#111316] border border-[#20242a] rounded-[4px] space-y-2 text-xs">
            <div className="flex justify-between items-center text-[#9ca3af]">
              <span>Studio Name:</span>
              <span className="text-[#f3f4f6] font-medium">{photographer.businessName}</span>
            </div>
            <div className="flex justify-between items-center text-[#9ca3af]">
              <span>Owner Email:</span>
              <span className="text-[#f3f4f6] font-mono text-[11px]">{photographer.email}</span>
            </div>
            {photographer.tagline && (
              <div className="flex justify-between items-center text-[#9ca3af]">
                <span>Tagline:</span>
                <span className="text-[#f3f4f6] italic text-[11px] truncate max-w-[200px]">
                  {photographer.tagline}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Security / Architecture Details */}
        <div className="p-3.5 bg-[#0d0f12] border border-[#20242a] rounded-[4px] space-y-2 text-xs">
          <div className="flex items-center gap-2 text-[#c5a059] font-medium pb-1 border-b border-[#20242a]">
            <ShieldCheck className="w-4 h-4 text-[#10b981]" />
            <span>Architecture & Security Profile</span>
          </div>
          <div className="flex justify-between text-[#9ca3af] pt-1">
            <span>Access Model:</span>
            <span className="text-[#f3f4f6]">Sole Photographer (Zero RBAC)</span>
          </div>
          <div className="flex justify-between text-[#9ca3af]">
            <span>Session Strategy:</span>
            <span className="text-[#f3f4f6]">HttpOnly JWT Cookie (7d TTL)</span>
          </div>
          <div className="flex justify-between text-[#9ca3af]">
            <span>Storage Ownership:</span>
            <span className="text-[#f3f4f6]">Photographer-Direct Cloudflare R2</span>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#20242a]">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onLogout}
            leftIcon={<LogOut className="w-3.5 h-3.5" />}
          >
            Sign Out
          </Button>
        </div>
      </div>
    </Modal>
  );
}
