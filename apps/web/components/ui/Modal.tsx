'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = 'max-w-md',
  className,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key and prevent background scroll
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        ref={modalRef}
        className={cn(
          'w-full border border-[#20242a] bg-[#14171b] rounded-[6px] shadow-[0_16px_48px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-200',
          maxWidth,
          className
        )}
      >
        <div className="flex items-start justify-between p-5 md:p-6 border-b border-[#20242a]">
          <div className="space-y-1 pr-6">
            <h2
              id="modal-title"
              className="text-base md:text-lg font-medium text-[#f3f4f6]"
            >
              {title}
            </h2>
            {description && (
              <p className="text-xs text-[#9ca3af] leading-relaxed">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#9ca3af] hover:text-[#f3f4f6] p-1 rounded-sm hover:bg-[#20242a] transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 md:p-6">{children}</div>
      </div>
    </div>
  );
}
