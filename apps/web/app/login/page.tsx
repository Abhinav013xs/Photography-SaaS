'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { PhotographerProfile } from '@photography-saas/types';
import { PublicNav, PublicFooter } from '../../components/public/PublicNav';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'submitting' | 'authenticated'>('checking');
  const [photographer, setPhotographer] = useState<PhotographerProfile | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);

  // Check existing session on load
  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'include',
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data?.photographer) {
            setPhotographer(json.data.photographer);
            setStatus('authenticated');
            router.push('/dashboard');
            return;
          }
        }
      } catch {
        // Unauthenticated or network error
      }
      setStatus('idle');
    }

    checkSession();
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setIsRateLimited(false);

    // Client validation
    if (!email.trim() || !password) {
      setErrorMessage('Please provide both email address and password.');
      return;
    }

    setStatus('submitting');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        const error = json.error;
        if (res.status === 429 || error?.code === 'RATE_LIMITED') {
          setIsRateLimited(true);
          setErrorMessage(
            error?.message || 'Too many failed attempts. Security cooldown active. Please try again later.'
          );
        } else {
          setErrorMessage(error?.message || 'Invalid email or password.');
        }
        setStatus('idle');
        return;
      }

      setPhotographer(json.data.photographer);
      setStatus('authenticated');
      setPassword('');
      router.push('/dashboard');
    } catch {
      setErrorMessage('Unable to connect to authentication server. Please check your network.');
      setStatus('idle');
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network error on logout
    }

    setPhotographer(null);
    setStatus('idle');
    setEmail('');
    setPassword('');
    setErrorMessage(null);
  }

  if (status === 'checking') {
    return (
      <div className="flex-1 flex flex-col justify-between min-h-screen">
        <PublicNav />
        <main className="flex-1 flex items-center justify-center p-6 min-h-[60vh]">
          <div className="text-center space-y-3">
            <div className="w-6 h-6 border-2 border-[#c5a059] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs uppercase tracking-widest text-[#6b7280]">
              Verifying Session...
            </p>
          </div>
        </main>
        <PublicFooter />
      </div>
    );
  }

  if (status === 'authenticated' && photographer) {
    return (
      <div className="flex-1 flex flex-col justify-between min-h-screen">
        <PublicNav />
        <main className="flex-1 flex items-center justify-center p-6 md:p-12 min-h-[80vh]">
          <div className="max-w-md w-full border border-[#20242a] bg-[#14171b] p-8 md:p-10 rounded-sm space-y-6">
            <div className="space-y-1">
              <span className="text-[11px] uppercase tracking-[0.2em] text-[#c5a059] font-medium block">
                Active Security Session
              </span>
              <h1 className="font-display text-2xl md:text-3xl font-normal text-[#f3f4f6]">
                {photographer.businessName}
              </h1>
              <p className="text-xs text-[#9ca3af]">
                Authenticated as <span className="text-[#f3f4f6] font-mono">{photographer.email}</span>
              </p>
            </div>

            <div className="p-4 border border-[#20242a] bg-[#111316] rounded-sm space-y-2 text-xs">
              <div className="flex justify-between text-[#9ca3af]">
                <span>Role:</span>
                <span className="text-[#f3f4f6] font-medium">Sole Photographer / Owner</span>
              </div>
              <div className="flex justify-between text-[#9ca3af]">
                <span>Session Type:</span>
                <span className="text-[#f3f4f6] font-medium">HttpOnly Cookie (7-Day TTL)</span>
              </div>
              <div className="flex justify-between text-[#9ca3af]">
                <span>Security State:</span>
                <span className="text-[#10b981] font-medium">Protected & Verified</span>
              </div>
            </div>

            <div className="border-t border-[#20242a] pt-4 flex gap-3">
              <button
                onClick={() => router.push('/dashboard')}
                className="flex-1 py-2.5 px-4 bg-[#c5a059] hover:bg-[#d4b26f] text-[#0a0b0d] text-xs uppercase tracking-wider font-semibold rounded-sm transition-colors cursor-pointer"
              >
                Open Dashboard
              </button>
              <button
                onClick={handleLogout}
                className="py-2.5 px-4 bg-[#20242a] hover:bg-[#2c323b] text-xs uppercase tracking-wider text-[#f3f4f6] font-medium rounded-sm transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </main>
        <PublicFooter />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-between min-h-screen">
      <PublicNav />
      <main className="flex-1 flex items-center justify-center p-6 md:p-12 min-h-[80vh]">
        <div className="max-w-md w-full border border-[#20242a] bg-[#14171b] p-8 md:p-10 rounded-sm space-y-6">
          <div className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.2em] text-[#c5a059] font-medium block">
              Sole Owner Portal
            </span>
            <h1 className="font-display text-2xl md:text-3xl font-normal text-[#f3f4f6]">
              Studio Lumina
            </h1>
            <p className="text-xs text-[#9ca3af]">
              Administrative authentication for the professional gallery owner.
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className={`p-3.5 border rounded-sm text-xs leading-relaxed ${
                isRateLimited
                  ? 'border-red-900/60 bg-red-950/20 text-red-300'
                  : 'border-[#3f2a1d] bg-[#221711] text-[#e0a96d]'
              }`}
            >
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="login-email"
                className="block text-xs uppercase tracking-wider text-[#9ca3af] font-medium"
              >
                Photographer Email
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={status === 'submitting'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@studiolumina.photo"
                className="w-full px-3.5 py-2.5 bg-[#111316] border border-[#20242a] rounded-sm text-sm text-[#f3f4f6] placeholder-[#4b5563] focus:border-[#c5a059] focus:outline-none transition-colors disabled:opacity-50"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="login-password"
                className="block text-xs uppercase tracking-wider text-[#9ca3af] font-medium"
              >
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={status === 'submitting'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 bg-[#111316] border border-[#20242a] rounded-sm text-sm text-[#f3f4f6] placeholder-[#4b5563] focus:border-[#c5a059] focus:outline-none transition-colors disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full mt-2 py-3 px-4 bg-[#c5a059] hover:bg-[#d4b26f] text-[#0a0b0d] text-xs uppercase tracking-widest font-semibold rounded-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {status === 'submitting' ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-[#0a0b0d] border-t-transparent rounded-full animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <span>Sign In to Studio</span>
              )}
            </button>
          </form>

          <div className="border-t border-[#20242a] pt-4">
            <p className="text-[11px] text-[#6b7280] leading-normal text-center">
              Single-owner platform. Password attempts are rate-limited via sliding IP window.
            </p>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
