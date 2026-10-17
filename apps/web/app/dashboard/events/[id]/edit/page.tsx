'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Calendar,
  Lock,
  Globe,
  ArrowLeft,
  AlertCircle,
  Clock,
  Download,
  Stamp,
  Users,
} from 'lucide-react';
import { PageHeader } from '../../../../../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { SkeletonCard } from '../../../../../components/ui/Skeleton';
import { ErrorState } from '../../../../../components/ui/ErrorState';
import type { EventDetail } from '@photography-saas/types';

export default function EditEventPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [customSlug, setCustomSlug] = useState('');

  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [publicStart, setPublicStart] = useState('');
  const [publicUntil, setPublicUntil] = useState('');

  const [pinEnabled, setPinEnabled] = useState(false);
  const [pin, setPin] = useState('');
  const [allowDownloads, setAllowDownloads] = useState(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState('Studio Lumina');
  const [faceSearchEnabled, setFaceSearchEnabled] = useState(true);
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>('draft');

  const fetchEvent = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Event not found or unauthorized');
      }
      const json = await res.json();
      if (json.success && json.data?.event) {
        const ev: EventDetail = json.data.event;
        setName(ev.name);
        setClientName(ev.client_name);
        setClientEmail(ev.client_email || '');
        setEventDate(ev.event_date);
        setLocation(ev.location || '');
        setDescription(ev.description || '');
        setCustomSlug(ev.slug);
        setVisibility(ev.visibility);
        setStatus(ev.status as any);
        if (ev.public_start) setPublicStart(ev.public_start.split('T')[0]);
        if (ev.public_until) setPublicUntil(ev.public_until.split('T')[0]);
        setPinEnabled(ev.pin_enabled);
        setAllowDownloads(ev.allow_downloads);
        setWatermarkEnabled(ev.watermark_enabled);
        setWatermarkText(ev.watermark_text || 'Studio Lumina');
        setFaceSearchEnabled(ev.face_search_enabled);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error fetching event');
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  // Public duration calculation
  const getPublicDurationDays = (): number | null => {
    if (!publicStart || !publicUntil) return null;
    const start = new Date(publicStart);
    const until = new Date(publicUntil);
    if (isNaN(start.getTime()) || isNaN(until.getTime())) return null;
    const diffMs = until.getTime() - start.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  };

  const publicDurationDays = getPublicDurationDays();
  const isWindowExceeded = publicDurationDays !== null && publicDurationDays > 30;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!name.trim()) {
      setSubmitError('Event title is required');
      return;
    }
    if (!clientName.trim()) {
      setSubmitError('Client name is required');
      return;
    }
    if (!eventDate) {
      setSubmitError('Event date is required');
      return;
    }
    if (visibility === 'public') {
      if (!publicStart || !publicUntil) {
        setSubmitError('Public events require both public start and expiry dates');
        return;
      }
      if (isWindowExceeded) {
        setSubmitError('Public visibility cannot exceed the maximum 30-day limit');
        return;
      }
    }
    if (pinEnabled && pin) {
      if (pin.length < 4 || pin.length > 8 || !/^\d+$/.test(pin)) {
        setSubmitError('PIN must consist of 4 to 8 numeric digits');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        client_name: clientName.trim(),
        client_email: clientEmail.trim() || null,
        event_date: eventDate,
        location: location.trim() || null,
        description: description.trim() || null,
        visibility,
        status,
        allow_downloads: allowDownloads,
        watermark_enabled: watermarkEnabled,
        watermark_text: watermarkText.trim() || 'Studio Lumina',
        face_search_enabled: faceSearchEnabled,
        pin_enabled: pinEnabled,
      };

      if (customSlug.trim()) {
        payload.slug = customSlug.trim();
      }

      if (visibility === 'public' && publicStart && publicUntil) {
        payload.public_start = new Date(publicStart).toISOString();
        payload.public_until = new Date(publicUntil).toISOString();
      } else if (visibility === 'private') {
        payload.public_start = null;
        payload.public_until = null;
      }

      if (pinEnabled && pin) {
        payload.pin = pin;
      }

      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Failed to update event');
      }

      router.push(`/dashboard/events/${eventId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An error occurred updating the event');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        title="Event Load Error"
        message={loadError}
        onRetry={fetchEvent}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
      <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
        <Link
          href={`/dashboard/events/${eventId}`}
          className="hover:text-white transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Event Overview
        </Link>
      </div>

      <PageHeader
        eyebrow="Configuration & Settings"
        title="Edit Event Container"
        description="Update metadata, gallery visibility, PIN protection, and lifecycle state."
      />

      {submitError && (
        <div className="flex items-start gap-3 p-4 bg-[#e63946]/10 border border-[#e63946]/30 rounded-lg text-xs text-[#e63946]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold">Unable to save changes</p>
            <p className="text-[#9ca3af]">{submitError}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Basic Information */}
        <Card>
          <CardHeader className="p-5 border-b border-[#20242a]">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-white">
              <Calendar className="w-4 h-4 text-[#c5a059]" />
              Event Details & Lifecycle
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Event Title <span className="text-[#c5a059]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Client Name <span className="text-[#c5a059]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Event Date <span className="text-[#c5a059]">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Client Email
                </label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Lifecycle Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#9ca3af]">
                Location / Venue
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#9ca3af]">
                URL Slug
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#6b7280] font-mono">/gallery/</span>
                <input
                  type="text"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-2 rounded-md outline-none font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#9ca3af]">
                Description & Notes
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] text-white text-xs p-3 rounded-md outline-none resize-none"
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Visibility & Expiry */}
        <Card>
          <CardHeader className="p-5 border-b border-[#20242a]">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-white">
              <Globe className="w-4 h-4 text-[#c5a059]" />
              Gallery Visibility & Expiry
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex-1 p-3.5 rounded-lg border text-left transition-all ${
                  visibility === 'private'
                    ? 'bg-[#c5a059]/10 border-[#c5a059] text-white'
                    : 'bg-[#121418] border-[#20242a] text-[#9ca3af]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold">Private</span>
                  <Badge variant={visibility === 'private' ? 'bronze' : 'outline'} size="sm">
                    Protected
                  </Badge>
                </div>
                <p className="text-[11px] text-[#9ca3af]">
                  Only accessible to authenticated photographer.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={`flex-1 p-3.5 rounded-lg border text-left transition-all ${
                  visibility === 'public'
                    ? 'bg-[#c5a059]/10 border-[#c5a059] text-white'
                    : 'bg-[#121418] border-[#20242a] text-[#9ca3af]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold">Public</span>
                  <Badge variant={visibility === 'public' ? 'bronze' : 'outline'} size="sm">
                    Gated
                  </Badge>
                </div>
                <p className="text-[11px] text-[#9ca3af]">
                  Visible to guests via link for up to 30 days.
                </p>
              </button>
            </div>

            {visibility === 'public' && (
              <div className="p-4 bg-[#121418] border border-[#20242a] rounded-lg space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-[#9ca3af]">
                      Public Start
                    </label>
                    <input
                      type="date"
                      value={publicStart}
                      onChange={(e) => setPublicStart(e.target.value)}
                      className="w-full bg-[#0a0b0d] border border-[#20242a] text-white text-xs px-3 py-2 rounded-md outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-[#9ca3af]">
                      Public Until (Max 30 Days)
                    </label>
                    <input
                      type="date"
                      value={publicUntil}
                      onChange={(e) => setPublicUntil(e.target.value)}
                      className="w-full bg-[#0a0b0d] border border-[#20242a] text-white text-xs px-3 py-2 rounded-md outline-none"
                    />
                  </div>
                </div>

                {publicDurationDays !== null && (
                  <div className="text-[11px] flex items-center justify-between">
                    <span className="text-[#9ca3af]">
                      Duration:{' '}
                      <strong className={isWindowExceeded ? 'text-[#e63946]' : 'text-white'}>
                        {publicDurationDays} days
                      </strong>
                    </span>
                    {isWindowExceeded && (
                      <span className="text-[#e63946] font-medium">
                        Exceeds 30-day limit
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 3: Protections & Toggles */}
        <Card>
          <CardHeader className="p-5 border-b border-[#20242a]">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-white">
              <Lock className="w-4 h-4 text-[#c5a059]" />
              Protections & Guest Controls
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {/* PIN Protection */}
            <div className="flex items-start justify-between gap-4 p-3.5 bg-[#121418] border border-[#20242a] rounded-lg">
              <div className="space-y-0.5">
                <label htmlFor="pin-edit-toggle" className="text-xs font-medium text-white cursor-pointer">
                  Guest PIN Protection
                </label>
                <p className="text-[11px] text-[#9ca3af]">
                  {pinEnabled ? 'PIN protection is currently active.' : 'PIN protection is disabled.'}
                </p>
                {pinEnabled && (
                  <div className="pt-2">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="Enter new 4-8 digit PIN (or leave blank to keep current)"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                      className="w-64 bg-[#0a0b0d] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-1.5 rounded-md outline-none font-mono"
                    />
                  </div>
                )}
              </div>
              <input
                id="pin-edit-toggle"
                type="checkbox"
                checked={pinEnabled}
                onChange={(e) => setPinEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#c5a059] cursor-pointer mt-1"
              />
            </div>

            {/* Downloads */}
            <div className="flex items-start justify-between gap-4 p-3.5 bg-[#121418] border border-[#20242a] rounded-lg">
              <div className="space-y-0.5">
                <label htmlFor="downloads-edit-toggle" className="text-xs font-medium text-white cursor-pointer flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 text-[#9ca3af]" />
                  Allow Guest Downloads
                </label>
                <p className="text-[11px] text-[#9ca3af]">
                  Permit guests to download photo originals and ZIP packages.
                </p>
              </div>
              <input
                id="downloads-edit-toggle"
                type="checkbox"
                checked={allowDownloads}
                onChange={(e) => setAllowDownloads(e.target.checked)}
                className="w-4 h-4 accent-[#c5a059] cursor-pointer mt-1"
              />
            </div>

            {/* Watermark */}
            <div className="flex items-start justify-between gap-4 p-3.5 bg-[#121418] border border-[#20242a] rounded-lg">
              <div className="space-y-0.5 flex-1">
                <label htmlFor="watermark-edit-toggle" className="text-xs font-medium text-white cursor-pointer flex items-center gap-1.5">
                  <Stamp className="w-3.5 h-3.5 text-[#9ca3af]" />
                  Preview Watermarking
                </label>
                <p className="text-[11px] text-[#9ca3af]">
                  Overlay studio branding on WebP preview images.
                </p>
                {watermarkEnabled && (
                  <div className="pt-2">
                    <input
                      type="text"
                      maxLength={50}
                      value={watermarkText}
                      onChange={(e) => setWatermarkText(e.target.value)}
                      className="w-64 bg-[#0a0b0d] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-1.5 rounded-md outline-none"
                    />
                  </div>
                )}
              </div>
              <input
                id="watermark-edit-toggle"
                type="checkbox"
                checked={watermarkEnabled}
                onChange={(e) => setWatermarkEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#c5a059] cursor-pointer mt-1"
              />
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-[#20242a]">
          <Link href={`/dashboard/events/${eventId}`}>
            <Button variant="ghost" size="md" type="button">
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={isSubmitting}
            disabled={isSubmitting || isWindowExceeded}
          >
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
