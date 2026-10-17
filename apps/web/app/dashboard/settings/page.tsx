'use client';

import React, { useState } from 'react';
import { ShieldCheck, Lock, User, LogOut } from 'lucide-react';
import { useAuthSession } from '../../../lib/auth';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Toast } from '../../../components/ui/Toast';

export default function SettingsPage() {
  const { photographer, logout } = useAuthSession();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!photographer) return null;

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    if (!currentPassword || !newPassword) {
      setErrorMessage('Please fill in both current and new password fields.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('New password and confirmation password do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setErrorMessage(json.error?.message || 'Failed to update administrative password.');
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage('Password changed successfully. Active session token rotated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setErrorMessage('Network error connecting to authentication server.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-4xl">
      <PageHeader
        eyebrow="Administrative Controls"
        title="Studio Settings"
        description="Manage your single-owner administrative profile, security credentials, and active session."
      />

      {successMessage && (
        <Toast
          type="success"
          message={successMessage}
          onDismiss={() => setSuccessMessage(null)}
        />
      )}

      {errorMessage && (
        <Toast
          type="error"
          message={errorMessage}
          onDismiss={() => setErrorMessage(null)}
        />
      )}

      {/* Studio Profile Card */}
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-[#c5a059]" />
            <CardTitle>Photographer Profile</CardTitle>
          </div>
          <CardDescription>
            Master studio identity and client-facing branding metadata.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3 bg-[#111316] border border-[#20242a] rounded-[4px] space-y-1">
              <span className="text-[#9ca3af] uppercase tracking-wider text-[10px]">Studio Name</span>
              <p className="text-sm font-medium text-[#f3f4f6]">{photographer.businessName}</p>
            </div>
            <div className="p-3 bg-[#111316] border border-[#20242a] rounded-[4px] space-y-1">
              <span className="text-[#9ca3af] uppercase tracking-wider text-[10px]">Owner Email</span>
              <p className="text-sm font-mono text-[#f3f4f6]">{photographer.email}</p>
            </div>
            <div className="p-3 bg-[#111316] border border-[#20242a] rounded-[4px] space-y-1">
              <span className="text-[#9ca3af] uppercase tracking-wider text-[10px]">Tagline</span>
              <p className="text-sm italic text-[#f3f4f6]">{photographer.tagline || 'Fine Art Photography'}</p>
            </div>
            <div className="p-3 bg-[#111316] border border-[#20242a] rounded-[4px] space-y-1">
              <span className="text-[#9ca3af] uppercase tracking-wider text-[10px]">Role Matrix</span>
              <p className="text-sm text-[#f3f4f6]">Sole Owner (Zero RBAC)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password Card */}
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#c5a059]" />
            <CardTitle>Security Credentials</CardTitle>
          </div>
          <CardDescription>
            Update your administrative password. Password will be hashed using salted bcrypt (cost 10) and session will be automatically rotated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
            <div className="space-y-1.5">
              <label
                htmlFor="current-password"
                className="block text-xs uppercase tracking-wider text-[#9ca3af] font-medium"
              >
                Current Password
              </label>
              <input
                id="current-password"
                type="password"
                required
                disabled={isSubmitting}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 bg-[#111316] border border-[#20242a] rounded-[4px] text-sm text-[#f3f4f6] placeholder-[#4b5563] focus:border-[#c5a059] focus:outline-none transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="new-password"
                className="block text-xs uppercase tracking-wider text-[#9ca3af] font-medium"
              >
                New Password (Minimum 8 Characters)
              </label>
              <input
                id="new-password"
                type="password"
                required
                disabled={isSubmitting}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 bg-[#111316] border border-[#20242a] rounded-[4px] text-sm text-[#f3f4f6] placeholder-[#4b5563] focus:border-[#c5a059] focus:outline-none transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="confirm-password"
                className="block text-xs uppercase tracking-wider text-[#9ca3af] font-medium"
              >
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                disabled={isSubmitting}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 bg-[#111316] border border-[#20242a] rounded-[4px] text-sm text-[#f3f4f6] placeholder-[#4b5563] focus:border-[#c5a059] focus:outline-none transition-colors"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
            >
              Update Password
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Session Management Card */}
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#10b981]" />
            <CardTitle>Session Security</CardTitle>
          </div>
          <CardDescription>
            Your session is stored in an encrypted, HttpOnly, SameSite cookie with a 7-day TTL.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <div className="space-y-0.5 text-xs text-[#9ca3af]">
            <p className="text-[#f3f4f6] font-medium">Terminate Administrative Session</p>
            <p>Clears the server-side session cookie and redirects to the login screen.</p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={logout}
            leftIcon={<LogOut className="w-3.5 h-3.5" />}
          >
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
