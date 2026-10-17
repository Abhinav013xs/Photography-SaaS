'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthSession } from '../../lib/auth';
import { Sidebar } from '../../components/dashboard/Sidebar';
import { Header } from '../../components/dashboard/Header';
import { MobileNav } from '../../components/dashboard/MobileNav';
import { AccountModal } from '../../components/dashboard/AccountModal';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { photographer, status, logout } = useAuthSession();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);

  // If unauthenticated, redirect to login
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Loading / verifying session state
  if (status === 'checking' || (status === 'unauthenticated' && !photographer)) {
    return (
      <div className="min-h-screen bg-[#0a0b0d] flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-[#c5a059] border-t-transparent rounded-full animate-spin mx-auto" />
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-[#c5a059] font-medium">
              Studio Lumina
            </p>
            <p className="text-xs text-[#9ca3af]">
              Verifying authenticated photographer session...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state connecting to backend
  if (status === 'error' && !photographer) {
    return (
      <div className="min-h-screen bg-[#0a0b0d] flex items-center justify-center p-6">
        <div className="max-w-md w-full border border-[#e63946]/30 bg-[#14171b] p-8 rounded-[6px] text-center space-y-4">
          <div className="w-10 h-10 rounded-full border border-[#e63946]/30 bg-[#e63946]/10 flex items-center justify-center text-[#e63946] mx-auto text-lg font-bold">
            !
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-medium text-[#f3f4f6]">
              Session Verification Failed
            </h2>
            <p className="text-xs text-[#9ca3af] leading-relaxed">
              Unable to communicate with the authentication service. Please ensure the backend server is active.
            </p>
          </div>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={() => router.push('/login')}
              className="py-2.5 px-4 bg-[#c5a059] hover:bg-[#d4b26f] text-[#0a0b0d] text-xs uppercase tracking-wider font-semibold rounded-[4px] transition-colors cursor-pointer"
            >
              Return to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!photographer) return null;

  return (
    <div className="min-h-screen bg-[#0a0b0d] flex flex-col md:flex-row text-[#f3f4f6]">
      {/* Desktop Sidebar */}
      <Sidebar
        photographer={photographer}
        onLogout={logout}
        onOpenAccount={() => setIsAccountModalOpen(true)}
        className="hidden md:flex min-h-screen sticky top-0"
      />

      {/* Mobile Drawer */}
      <MobileNav
        isOpen={isMobileNavOpen}
        onClose={() => setIsMobileNavOpen(false)}
        photographer={photographer}
        onLogout={logout}
      />

      {/* Account Details Modal */}
      <AccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        photographer={photographer}
        onLogout={logout}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          photographer={photographer}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          onOpenAccount={() => setIsAccountModalOpen(true)}
        />

        <main id="dashboard-content" className="flex-1 p-5 md:p-8 lg:p-10 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
