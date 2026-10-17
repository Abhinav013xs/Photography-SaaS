import React from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, Sparkles, Layers } from 'lucide-react';
import { PublicNav, PublicFooter } from '../components/public/PublicNav';

export default function HomePage() {
  return (
    <div className="flex-1 flex flex-col justify-between min-h-screen">
      <PublicNav />
      <main id="main-content" className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="max-w-2xl w-full border border-[#20242a] bg-[#14171b] p-8 md:p-12 rounded-[6px] space-y-8 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
          <div className="space-y-3">
            <span className="text-[11px] uppercase tracking-[0.25em] text-[#c5a059] font-medium block">
              Professional Studio Platform
            </span>
            <h1 className="font-display text-3xl md:text-5xl font-normal text-[#f3f4f6] tracking-tight leading-tight">
              Studio Lumina
            </h1>
            <p className="text-xs md:text-sm text-[#9ca3af] leading-relaxed max-w-xl">
              Private production photography gallery management and neural face-search platform. Built exclusively for the sole studio owner.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-5 py-3 bg-[#c5a059] hover:bg-[#d4b26f] text-[#0a0b0d] text-xs uppercase tracking-widest font-semibold rounded-[4px] transition-colors"
            >
              <span>Enter Photographer Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-4 py-3 border border-[#20242a] hover:border-[#c5a059] text-[#9ca3af] hover:text-[#f3f4f6] text-xs uppercase tracking-wider font-medium rounded-[4px] transition-colors"
            >
              <span>Owner Portal</span>
            </Link>
          </div>

          <div className="border-t border-[#20242a] pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 border border-[#20242a] bg-[#111316] rounded-[4px] space-y-1">
              <div className="flex items-center gap-2 text-[#c5a059]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="font-medium text-[11px] uppercase tracking-wider">Security Core</span>
              </div>
              <p className="text-[11px] text-[#6b7280]">Single-owner authenticated boundary with 7-day HttpOnly sessions.</p>
            </div>
            <div className="p-3.5 border border-[#20242a] bg-[#111316] rounded-[4px] space-y-1">
              <div className="flex items-center gap-2 text-[#c5a059]">
                <Layers className="w-3.5 h-3.5" />
                <span className="font-medium text-[11px] uppercase tracking-wider">Event Isolation</span>
              </div>
              <p className="text-[11px] text-[#6b7280]">Strict per-event cryptographic and relational boundaries.</p>
            </div>
            <div className="p-3.5 border border-[#20242a] bg-[#111316] rounded-[4px] space-y-1">
              <div className="flex items-center gap-2 text-[#c5a059]">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="font-medium text-[11px] uppercase tracking-wider">AI Face Search</span>
              </div>
              <p className="text-[11px] text-[#6b7280]">Real 128-D vector embeddings with ephemeral zero-retention.</p>
            </div>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
