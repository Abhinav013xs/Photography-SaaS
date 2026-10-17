import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ToastProps {
  type?: 'success' | 'warning' | 'error' | 'info';
  message: string;
  onDismiss?: () => void;
  className?: string;
}

export function Toast({
  type = 'info',
  message,
  onDismiss,
  className,
}: ToastProps) {
  const styles = {
    info: 'border-[#20242a] bg-[#14171b] text-[#f3f4f6]',
    success: 'border-[#2ec4b6]/30 bg-[#2ec4b6]/10 text-[#2ec4b6]',
    warning: 'border-[#e76f51]/30 bg-[#e76f51]/10 text-[#e76f51]',
    error: 'border-[#e63946]/30 bg-[#e63946]/10 text-[#e63946]',
  };

  const icons = {
    info: <Info className="w-4 h-4 text-[#c5a059] shrink-0" />,
    success: <CheckCircle2 className="w-4 h-4 text-[#2ec4b6] shrink-0" />,
    warning: <AlertCircle className="w-4 h-4 text-[#e76f51] shrink-0" />,
    error: <AlertCircle className="w-4 h-4 text-[#e63946] shrink-0" />,
  };

  return (
    <div
      role="status"
      className={cn(
        'border rounded-[4px] px-3.5 py-2.5 text-xs flex items-center justify-between gap-3 shadow-lg',
        styles[type],
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        {icons[type]}
        <span className="leading-snug">{message}</span>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-current opacity-70 hover:opacity-100 p-0.5 transition-opacity cursor-pointer"
          aria-label="Dismiss notification"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
