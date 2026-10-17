import React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed select-none rounded-[4px] focus-visible:outline-2 focus-visible:outline-[#c5a059] focus-visible:outline-offset-2';

    const variants = {
      primary: 'bg-[#c5a059] hover:bg-[#d4b26f] text-[#0a0b0d] font-semibold active:bg-[#b08d46]',
      secondary: 'bg-[#20242a] hover:bg-[#2c323b] text-[#f3f4f6] active:bg-[#181a1f]',
      outline:
        'border border-[#20242a] hover:border-[#c5a059] text-[#9ca3af] hover:text-[#f3f4f6] bg-transparent active:border-[#d4b26f]',
      ghost: 'text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#14171b] bg-transparent active:bg-[#111316]',
      destructive:
        'bg-[#e63946]/10 hover:bg-[#e63946]/20 text-[#e63946] border border-[#e63946]/30 active:bg-[#e63946]/25',
    };

    const sizes = {
      sm: 'text-[11px] px-3 py-1.5 gap-1.5 h-8',
      md: 'text-xs px-4 py-2.5 gap-2 h-10',
      lg: 'text-xs px-5 py-3 gap-2.5 h-12 tracking-widest',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          baseStyles,
          variants[variant],
          sizes[size],
          fullWidth && 'w-full',
          className
        )}
        {...props}
      >
        {isLoading ? (
          <div
            className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
        ) : (
          leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
        )}
        <span>{children}</span>
        {!isLoading && rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
