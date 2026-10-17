'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  X,
  LayoutDashboard,
  Calendar,
  HardDrive,
  Trash2,
  Settings,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { PhotographerProfile } from '@photography-saas/types';

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  photographer: PhotographerProfile;
  onLogout: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  badge?: string;
}

export function MobileNav({ isOpen, onClose, photographer, onLogout }: MobileNavProps) {
  const pathname = usePathname();

  // Close when pathname changes
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const navItems: NavItem[] = [
    {
      label: 'Overview',
      href: '/dashboard',
      icon: LayoutDashboard,
      active: pathname === '/dashboard',
    },
    {
      label: 'Events Workspace',
      href: '/dashboard/events',
      icon: Calendar,
      active: pathname.startsWith('/dashboard/events'),
    },
    {
      label: 'Storage & R2',
      href: '/dashboard/storage',
      icon: HardDrive,
      active: pathname.startsWith('/dashboard/storage'),
    },
    {
      label: 'Recycle Bin',
      href: '/dashboard/trash',
      icon: Trash2,
      active: pathname.startsWith('/dashboard/trash') || pathname.startsWith('/dashboard/bin'),
    },
    {
      label: 'Studio Settings',
      href: '/dashboard/settings',
      icon: Settings,
      active: pathname.startsWith('/dashboard/settings'),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 md:hidden bg-black/80 backdrop-blur-xs flex"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Mobile Navigation"
    >
      <div className="w-72 max-w-[80vw] bg-[#111316] border-r border-[#20242a] h-full flex flex-col justify-between animate-in slide-in-from-left duration-200">
        <div>
          {/* Header */}
          <div className="p-5 border-b border-[#20242a] flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#c5a059] font-medium block">
                Studio Lumina
              </span>
              <span className="text-sm font-medium text-[#f3f4f6]">
                {photographer.businessName}
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-[#9ca3af] hover:text-[#f3f4f6] p-1.5 rounded-sm hover:bg-[#14171b] transition-colors cursor-pointer"
              aria-label="Close navigation menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1" aria-label="Mobile Navigation Links">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center justify-between px-3.5 py-3 rounded-[4px] text-xs font-medium transition-colors',
                    item.active
                      ? 'bg-[#181b20] text-[#c5a059] border-l-2 border-[#c5a059]'
                      : 'text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#14171b]'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={cn(
                        'w-4 h-4 stroke-[1.75]',
                        item.active ? 'text-[#c5a059]' : 'text-[#6b7280]'
                      )}
                    />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-xs border border-[#2c323b] bg-[#14171b] text-[#6b7280]">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#20242a] bg-[#0d0f12] space-y-3">
          <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
            <ShieldCheck className="w-4 h-4 text-[#10b981]" />
            <span className="truncate">{photographer.email}</span>
          </div>

          <button
            onClick={onLogout}
            className="w-full py-2.5 px-3 bg-[#20242a] hover:bg-[#2c323b] text-xs uppercase tracking-wider text-[#f3f4f6] font-medium rounded-[4px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
