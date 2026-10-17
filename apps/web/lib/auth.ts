'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { PhotographerProfile } from '@photography-saas/types';

export interface AuthSessionState {
  photographer: PhotographerProfile | null;
  status: 'checking' | 'authenticated' | 'unauthenticated' | 'error';
  error: string | null;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export function useAuthSession(): AuthSessionState {
  const router = useRouter();
  const [photographer, setPhotographer] = useState<PhotographerProfile | null>(null);
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'unauthenticated' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.photographer) {
          setPhotographer(json.data.photographer);
          setStatus('authenticated');
          setError(null);
          return;
        }
      }

      // Unauthenticated or expired session
      setPhotographer(null);
      setStatus('unauthenticated');
    } catch (err) {
      setPhotographer(null);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Network error verifying authentication session');
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network errors during logout
    }

    setPhotographer(null);
    setStatus('unauthenticated');
    router.push('/login');
  }, [router]);

  return {
    photographer,
    status,
    error,
    logout,
    refreshSession: checkSession,
  };
}
