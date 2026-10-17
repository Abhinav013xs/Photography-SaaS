import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/utils';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  fullPage?: boolean;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'An unexpected error occurred while communicating with the server. Please try again.',
  onRetry,
  fullPage = false,
  className,
}: ErrorStateProps) {
  const content = (
    <div
      role="alert"
      className={cn(
        'border border-[#e63946]/30 bg-[#e63946]/5 rounded-[6px] p-6 md:p-8 text-center max-w-lg mx-auto space-y-4',
        className
      )}
    >
      <div className="w-10 h-10 rounded-full border border-[#e63946]/30 bg-[#e63946]/10 flex items-center justify-center text-[#e63946] mx-auto">
        <AlertTriangle className="w-5 h-5 stroke-[1.75]" />
      </div>

      <div className="space-y-1.5">
        <h3 className="font-medium text-base text-[#f3f4f6]">
          {title}
        </h3>
        <p className="text-xs text-[#9ca3af] leading-relaxed">
          {message}
        </p>
      </div>

      {onRetry && (
        <div className="pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Retry Request
          </Button>
        </div>
      )}
    </div>
  );

  if (fullPage) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 min-h-[60vh]">
        {content}
      </div>
    );
  }

  return content;
}
