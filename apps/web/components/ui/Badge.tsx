import React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'bronze' | 'success' | 'warning' | 'destructive' | 'outline';
  size?: 'sm' | 'md';
}

export function Badge({
  className,
  variant = 'default',
  size = 'md',
  children,
  ...props
}: BadgeProps) {
  const baseStyles =
    'inline-flex items-center font-medium uppercase tracking-wider rounded-sm select-none border';

  const variants = {
    default: 'bg-[#1a1d23] text-[#9ca3af] border-[#20242a]',
    bronze: 'bg-[#c5a059]/10 text-[#c5a059] border-[#c5a059]/30',
    success: 'bg-[#2ec4b6]/10 text-[#2ec4b6] border-[#2ec4b6]/30',
    warning: 'bg-[#e76f51]/10 text-[#e76f51] border-[#e76f51]/30',
    destructive: 'bg-[#e63946]/10 text-[#e63946] border-[#e63946]/30',
    outline: 'bg-transparent text-[#9ca3af] border-[#2c323b]',
  };

  const sizes = {
    sm: 'text-[10px] px-2 py-0.5 tracking-widest',
    md: 'text-[11px] px-2.5 py-1 tracking-wider',
  };

  return (
    <span className={cn(baseStyles, variants[variant], sizes[size], className)} {...props}>
      {children}
    </span>
  );
}
