'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, ShieldCheck, User } from 'lucide-react';
import type { PhotographerProfile } from '@photography-saas/types';

interface HeaderProps {
  photographer: PhotographerProfile;
  onOpenMobileNav: () => void;
  onOpenAccount: () => void;
}

export function Header({
  photographer,
  onOpenMobileNav,
  onOpenAccount,
}: HeaderProps) {
  const pathname = usePathname();

  function getBreadcrumb() {
    if (pathname === '/dashboard') return 'Studio Overview';
    if (pathname.startsWith('/dashboard/events')) return 'Events Workspace';
    if (pathname.startsWith('/dashboard/storage')) return 'Storage Management';
    if (pathname.startsWith('/dashboard/settings')) return 'Studio Settings';
    return 'Dashboard';
  }

  return (
    <header className="border-b border-[#20242a] bg-[#111316] h-16 px-4 md:px-8 flex items-center justify-between shrink-0 select-none">
      {/* Left: Mobile trigger & Breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileNav}
          className="md:hidden text-[#9ca3af] hover:text-[#f3f4f6] p-1.5 rounded-sm hover:bg-[#14171b] transition-colors cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-xs">
          <Link
            href="/dashboard"
            className="text-[#6b7280] hover:text-[#9ca3af] transition-colors"
          >
            Dashboard
          </Link>
          <span className="text-[#4b5563]">/</span>
          <span className="text-[#f3f4f6] font-medium">{getBreadcrumb()}</span>
        </div>
      </div>

      {/* Right: Security Badge & Account Trigger */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#20242a] bg-[#14171b] text-[11px] text-[#9ca3af]">
          <ShieldCheck className="w-3.5 h-3.5 text-[#10b981]" />
          <span>Single-Owner Session</span>
        </div>

        <button
          onClick={onOpenAccount}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-[4px] border border-[#20242a] hover:border-[#c5a059] bg-[#14171b] hover:bg-[#181b20] transition-colors group cursor-pointer"
        >
          <div className="w-6 h-6 rounded-full bg-[#c5a059]/20 flex items-center justify-center text-[#c5a059] text-[11px] font-semibold">
            {photographer.businessName.charAt(0) || <User className="w-3.5 h-3.5" />}
          </div>
          <span className="text-xs font-medium text-[#f3f4f6] group-hover:text-[#c5a059] transition-colors hidden md:inline">
            {photographer.businessName}
          </span>
        </button>
      </div>
    </header>
  );
}
