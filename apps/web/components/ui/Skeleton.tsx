import React from 'react';
import { cn } from '../../lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
  rounded?: 'sm' | 'md' | 'full';
}

export function Skeleton({
  className,
  width,
  height,
  rounded = 'sm',
  style,
  ...props
}: SkeletonProps) {
  const roundedStyles = {
    sm: 'rounded-[3px]',
    md: 'rounded-[6px]',
    full: 'rounded-full',
  };

  return (
    <div
      className={cn('skeleton-shimmer', roundedStyles[rounded], className)}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        ...style,
      }}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'border border-[#20242a] bg-[#14171b] rounded-[6px] p-6 space-y-4',
        className
      )}
    >
      <div className="space-y-2">
        <Skeleton height={14} width="40%" />
        <Skeleton height={24} width="75%" />
      </div>
      <Skeleton height={12} width="90%" />
      <Skeleton height={12} width="60%" />
    </div>
  );
}
