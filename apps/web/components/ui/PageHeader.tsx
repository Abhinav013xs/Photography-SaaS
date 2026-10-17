import React from 'react';
import { cn } from '../../lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  displayFont?: boolean;
  className?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  displayFont = true,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'border-b border-[#20242a] pb-6 mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4',
        className
      )}
    >
      <div className="space-y-1.5 max-w-2xl">
        {eyebrow && (
          <div className="text-[11px] uppercase tracking-[0.2em] text-[#c5a059] font-medium">
            {eyebrow}
          </div>
        )}
        <h1
          className={cn(
            'text-2xl md:text-3xl text-[#f3f4f6] font-normal tracking-tight',
            displayFont && 'font-display text-3xl md:text-4xl'
          )}
        >
          {title}
        </h1>
        {description && (
          <p className="text-xs md:text-sm text-[#9ca3af] leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  );
}
