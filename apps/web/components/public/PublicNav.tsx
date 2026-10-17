import React from 'react';
import Link from 'next/link';

export function PublicNav() {
  return (
    <header className="border-b border-[#20242a] px-6 py-4 flex items-center justify-between bg-[#111316] shrink-0">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="font-display text-xl tracking-wider text-[#f3f4f6] hover:text-[#c5a059] transition-colors"
        >
          STUDIO LUMINA
        </Link>
        <span className="text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-full border border-[#2c323b] text-[#c5a059] bg-[#c5a059]/10">
          Security Core
        </span>
      </div>
      <nav className="flex items-center gap-4 text-xs">
        <Link
          href="/dashboard"
          className="px-3 py-1.5 bg-[#c5a059] hover:bg-[#d4b26f] text-[#0a0b0d] rounded-[3px] transition-colors uppercase tracking-wider text-[11px] font-semibold"
        >
          Dashboard
        </Link>
        <Link
          href="/login"
          className="px-3 py-1.5 border border-[#20242a] hover:border-[#c5a059] text-[#9ca3af] hover:text-[#f3f4f6] rounded-[3px] transition-colors uppercase tracking-wider text-[11px]"
        >
          Owner Portal
        </Link>
      </nav>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-[#20242a] px-6 py-4 text-center text-xs text-[#6b7280] bg-[#111316] shrink-0">
      Studio Lumina &copy; {new Date().getFullYear()} &mdash; Production Security Foundation
    </footer>
  );
}
