'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Calendar,
  HardDrive,
  Trash2,
  Settings,
  ShieldCheck,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { PhotographerProfile } from '@photography-saas/types';

interface SidebarProps {
  photographer: PhotographerProfile;
  onLogout: () => void;
  onOpenAccount: () => void;
  className?: string;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  badge?: string;
}

export function Sidebar({ photographer, onLogout, onOpenAccount, className }: SidebarProps) {
  const pathname = usePathname();

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
    <aside
      className={cn(
        'w-64 border-r border-[#20242a] bg-[#111316] flex flex-col justify-between shrink-0 select-none',
        className
      )}
    >
      {/* Brand Header */}
      <div>
        <div className="p-6 border-b border-[#20242a]">
          <Link href="/dashboard" className="group block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#c5a059] font-medium block">
              Sole Owner Platform
            </span>
            <span className="font-display text-2xl font-normal text-[#f3f4f6] tracking-wide group-hover:text-[#c5a059] transition-colors block">
              STUDIO LUMINA
            </span>
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
            <span className="text-[11px] text-[#9ca3af] font-mono truncate">
              {photographer.businessName}
            </span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 space-y-1" aria-label="Main Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center justify-between px-3.5 py-2.5 rounded-[4px] text-xs font-medium transition-colors group',
                  item.active
                    ? 'bg-[#181b20] text-[#c5a059] border-l-2 border-[#c5a059]'
                    : 'text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#14171b]'
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={cn(
                      'w-4 h-4 stroke-[1.75] transition-colors',
                      item.active ? 'text-[#c5a059]' : 'text-[#6b7280] group-hover:text-[#f3f4f6]'
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

      {/* Footer / Account & Session */}
      <div className="p-4 border-t border-[#20242a] space-y-3 bg-[#0d0f12]">
        <button
          onClick={onOpenAccount}
          className="w-full text-left p-2 rounded-[4px] hover:bg-[#14171b] transition-colors flex items-center justify-between group cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-[#c5a059]/15 border border-[#c5a059]/30 flex items-center justify-center text-[#c5a059] text-[11px] font-semibold shrink-0">
              {photographer.businessName.charAt(0) || 'P'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#f3f4f6] truncate group-hover:text-[#c5a059] transition-colors">
                {photographer.businessName}
              </p>
              <p className="text-[10px] text-[#6b7280] truncate font-mono">{photographer.email}</p>
            </div>
          </div>
          <ExternalLink className="w-3.5 h-3.5 text-[#6b7280] group-hover:text-[#f3f4f6] shrink-0" />
        </button>

        <div className="flex items-center justify-between pt-1 px-1">
          <div className="flex items-center gap-1.5 text-[10px] text-[#10b981]">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Encrypted Session</span>
          </div>

          <button
            onClick={onLogout}
            className="text-[11px] text-[#9ca3af] hover:text-[#e63946] flex items-center gap-1 transition-colors cursor-pointer"
            title="Sign out of photographer dashboard"
          >
            <LogOut className="w-3 h-3" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
