import React from 'react';
import { Camera } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  badge?: string;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  badge,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border border-dashed border-[#20242a] bg-[#111316]/60 rounded-[6px] p-8 md:p-14 text-center flex flex-col items-center justify-center space-y-4 max-w-xl mx-auto',
        className
      )}
    >
      <div className="w-12 h-12 rounded-full border border-[#2c323b] bg-[#14171b] flex items-center justify-center text-[#c5a059]">
        {icon || <Camera className="w-5 h-5 stroke-[1.5]" />}
      </div>

      <div className="space-y-1.5 max-w-md">
        {badge && (
          <span className="text-[10px] uppercase tracking-widest text-[#c5a059] font-medium px-2 py-0.5 rounded-full border border-[#c5a059]/20 bg-[#c5a059]/10 inline-block mb-1">
            {badge}
          </span>
        )}
        <h3 className="font-display text-xl md:text-2xl text-[#f3f4f6] font-normal">
          {title}
        </h3>
        <p className="text-xs text-[#9ca3af] leading-relaxed">
          {description}
        </p>
      </div>

      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
