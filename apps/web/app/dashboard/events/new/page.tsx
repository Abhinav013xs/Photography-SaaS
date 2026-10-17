'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Calendar,
  Lock,
  Globe,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  Stamp,
  Users,
} from 'lucide-react';
import { PageHeader } from '../../../../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';

export default function NewEventPage() {
  const router = useRouter();

  // Basic Details
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [customSlug, setCustomSlug] = useState('');

  // Access & Visibility
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [publicStart, setPublicStart] = useState('');
  const [publicUntil, setPublicUntil] = useState('');

  // Protections & Options
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pin, setPin] = useState('');
  const [allowDownloads, setAllowDownloads] = useState(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState('Studio Lumina');
  const [faceSearchEnabled, setFaceSearchEnabled] = useState(true);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Calculate duration between public_start and public_until in days
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
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage('Event title is required');
      return;
    }
    if (!clientName.trim()) {
      setErrorMessage('Client name is required');
      return;
    }
    if (!eventDate) {
      setErrorMessage('Event date is required');
      return;
    }
    if (visibility === 'public') {
      if (!publicStart || !publicUntil) {
        setErrorMessage('Public events require both public start and expiry dates');
        return;
      }
      if (isWindowExceeded) {
        setErrorMessage('Public visibility cannot exceed the maximum 30-day limit');
        return;
      }
    }
    if (pinEnabled) {
      if (!pin || pin.length < 4 || pin.length > 8 || !/^\d+$/.test(pin)) {
        setErrorMessage('PIN must be 4 to 8 numeric digits');
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
        status: 'draft',
        allow_downloads: allowDownloads,
        watermark_enabled: watermarkEnabled,
        watermark_text: watermarkText.trim() || 'Studio Lumina',
        face_search_enabled: faceSearchEnabled,
      };

      if (customSlug.trim()) {
        payload.slug = customSlug.trim();
      }

      if (visibility === 'public' && publicStart && publicUntil) {
        payload.public_start = new Date(publicStart).toISOString();
        payload.public_until = new Date(publicUntil).toISOString();
      }

      if (pinEnabled && pin) {
        payload.pin_enabled = true;
        payload.pin = pin;
      }

      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Failed to create event');
      }

      const createdEvent = json.data.event;
      router.push(`/dashboard/events/${createdEvent.id}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
      <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
        <Link
          href="/dashboard/events"
          className="hover:text-white transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Events Workspace
        </Link>
      </div>

      <PageHeader
        eyebrow="New Event Workspace"
        title="Create Event Container"
        description="Establish an independent photography gallery container with safe default privacy and calibrated protections."
      />

      {errorMessage && (
        <div className="flex items-start gap-3 p-4 bg-[#e63946]/10 border border-[#e63946]/30 rounded-lg text-xs text-[#e63946] animate-in shake">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold">Unable to create event</p>
            <p className="text-[#9ca3af]">{errorMessage}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Basic Information */}
        <Card>
          <CardHeader className="p-5 border-b border-[#20242a]">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-white">
              <Calendar className="w-4 h-4 text-[#c5a059]" />
              1. Event & Client Details
            </CardTitle>
            <CardDescription className="text-xs">
              Primary identification and client contract information.
            </CardDescription>
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
                  placeholder="e.g. Ananya & Rahul — Wedding"
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none transition-colors"
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
                  placeholder="e.g. Ananya Sharma"
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none transition-colors"
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
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Client Email (Optional)
                </label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Location / Venue
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. The Oberoi Rajvilas, Jaipur"
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs px-3 py-2.5 rounded-md outline-none transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#9ca3af]">
                Custom URL Slug (Optional)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#6b7280] font-mono">/gallery/</span>
                <input
                  type="text"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="auto-generated-from-title"
                  className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs px-3 py-2 rounded-md outline-none font-mono"
                />
              </div>
              <p className="text-[11px] text-[#6b7280]">
                Leave blank to auto-generate a clean, URL-safe kebab-case slug.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#9ca3af]">
                Internal Description & Notes
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes for photographer, ceremony sequence, delivery notes..."
                className="w-full bg-[#121418] border border-[#20242a] focus:border-[#c5a059] focus:ring-1 focus:ring-[#c5a059] text-white text-xs p-3 rounded-md outline-none transition-colors resize-none"
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Access & Public Expiry */}
        <Card>
          <CardHeader className="p-5 border-b border-[#20242a]">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-white">
              <Globe className="w-4 h-4 text-[#c5a059]" />
              2. Gallery Visibility & 30-Day Expiry Window
            </CardTitle>
            <CardDescription className="text-xs">
              Govern public visibility. New events default to Private for maximum photographer control.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex-1 p-3.5 rounded-lg border text-left transition-all ${
                  visibility === 'private'
                    ? 'bg-[#c5a059]/10 border-[#c5a059] text-white'
                    : 'bg-[#121418] border-[#20242a] text-[#9ca3af] hover:border-[#2c323b]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold">Private Gallery (Default)</span>
                  <Badge variant={visibility === 'private' ? 'bronze' : 'outline'} size="sm">
                    Safe Default
                  </Badge>
                </div>
                <p className="text-[11px] text-[#9ca3af]">
                  Gallery is completely hidden from public access. Only you can view this workspace.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={`flex-1 p-3.5 rounded-lg border text-left transition-all ${
                  visibility === 'public'
                    ? 'bg-[#c5a059]/10 border-[#c5a059] text-white'
                    : 'bg-[#121418] border-[#20242a] text-[#9ca3af] hover:border-[#2c323b]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold">Public Gallery</span>
                  <Badge variant={visibility === 'public' ? 'bronze' : 'outline'} size="sm">
                    Gated Shareable
                  </Badge>
                </div>
                <p className="text-[11px] text-[#9ca3af]">
                  Accessible to clients and guests via public link/QR code for a maximum 30-day window.
                </p>
              </button>
            </div>

            {visibility === 'public' && (
              <div className="p-4 bg-[#121418] border border-[#20242a] rounded-lg space-y-3 animate-in fade-in">
                <div className="flex items-center gap-2 text-xs font-medium text-[#c5a059]">
                  <Clock className="w-3.5 h-3.5" />
                  Mandatory 30-Day Public Expiry Schedule
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-[#9ca3af]">
                      Public From (Start Date)
                    </label>
                    <input
                      type="date"
                      required={visibility === 'public'}
                      value={publicStart}
                      onChange={(e) => setPublicStart(e.target.value)}
                      className="w-full bg-[#0a0b0d] border border-[#20242a] text-white text-xs px-3 py-2 rounded-md outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-[#9ca3af]">
                      Public Until (Expiry Date)
                    </label>
                    <input
                      type="date"
                      required={visibility === 'public'}
                      value={publicUntil}
                      onChange={(e) => setPublicUntil(e.target.value)}
                      className="w-full bg-[#0a0b0d] border border-[#20242a] text-white text-xs px-3 py-2 rounded-md outline-none"
                    />
                  </div>
                </div>

                {publicDurationDays !== null && (
                  <div className="text-[11px] flex items-center justify-between pt-1">
                    <span className="text-[#9ca3af]">
                      Duration:{' '}
                      <strong className={isWindowExceeded ? 'text-[#e63946]' : 'text-white'}>
                        {publicDurationDays} days
                      </strong>{' '}
                      (Max 30 days allowed)
                    </span>
                    {isWindowExceeded && (
                      <span className="text-[#e63946] font-medium">
                        Exceeds 30-day limit by {publicDurationDays - 30} days
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 3: Protections & Feature Flags */}
        <Card>
          <CardHeader className="p-5 border-b border-[#20242a]">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-white">
              <Lock className="w-4 h-4 text-[#c5a059]" />
              3. Protection & Feature Settings
            </CardTitle>
            <CardDescription className="text-xs">
              Configure guest PIN lock, downloads, and watermarking foundation.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {/* PIN Protection */}
            <div className="flex items-start justify-between gap-4 p-3.5 bg-[#121418] border border-[#20242a] rounded-lg">
              <div className="space-y-0.5">
                <label
                  htmlFor="pin-toggle"
                  className="text-xs font-medium text-white cursor-pointer"
                >
                  Guest PIN Protection
                </label>
                <p className="text-[11px] text-[#9ca3af]">
                  Requires guests to enter a 4–8 digit numeric PIN before viewing photos.
                </p>
                {pinEnabled && (
                  <div className="pt-2">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="Enter 4-8 digit numeric PIN"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                      className="w-48 bg-[#0a0b0d] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-1.5 rounded-md outline-none font-mono"
                    />
                  </div>
                )}
              </div>
              <input
                id="pin-toggle"
                type="checkbox"
                checked={pinEnabled}
                onChange={(e) => setPinEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#c5a059] cursor-pointer mt-1"
              />
            </div>

            {/* Downloads Enabled */}
            <div className="flex items-start justify-between gap-4 p-3.5 bg-[#121418] border border-[#20242a] rounded-lg">
              <div className="space-y-0.5">
                <label
                  htmlFor="downloads-toggle"
                  className="text-xs font-medium text-white cursor-pointer flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-[#9ca3af]" />
                  Allow Guest Downloads
                </label>
                <p className="text-[11px] text-[#9ca3af]">
                  Permit guests to download single high-resolution photos or bulk ZIPs.
                </p>
              </div>
              <input
                id="downloads-toggle"
                type="checkbox"
                checked={allowDownloads}
                onChange={(e) => setAllowDownloads(e.target.checked)}
                className="w-4 h-4 accent-[#c5a059] cursor-pointer mt-1"
              />
            </div>

            {/* Watermark Configuration */}
            <div className="flex items-start justify-between gap-4 p-3.5 bg-[#121418] border border-[#20242a] rounded-lg">
              <div className="space-y-0.5 flex-1">
                <label
                  htmlFor="watermark-toggle"
                  className="text-xs font-medium text-white cursor-pointer flex items-center gap-1.5"
                >
                  <Stamp className="w-3.5 h-3.5 text-[#9ca3af]" />
                  Preview Watermarking
                </label>
                <p className="text-[11px] text-[#9ca3af]">
                  Overlay subtle branding on WebP preview derivatives.
                </p>
                {watermarkEnabled && (
                  <div className="pt-2">
                    <input
                      type="text"
                      maxLength={50}
                      placeholder="Watermark text"
                      value={watermarkText}
                      onChange={(e) => setWatermarkText(e.target.value)}
                      className="w-64 bg-[#0a0b0d] border border-[#20242a] focus:border-[#c5a059] text-white text-xs px-3 py-1.5 rounded-md outline-none"
                    />
                  </div>
                )}
              </div>
              <input
                id="watermark-toggle"
                type="checkbox"
                checked={watermarkEnabled}
                onChange={(e) => setWatermarkEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#c5a059] cursor-pointer mt-1"
              />
            </div>

            {/* Face Search Flag */}
            <div className="flex items-start justify-between gap-4 p-3.5 bg-[#121418] border border-[#20242a] rounded-lg">
              <div className="space-y-0.5">
                <label
                  htmlFor="facesearch-toggle"
                  className="text-xs font-medium text-white cursor-pointer flex items-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5 text-[#9ca3af]" />
                  AI Face-Search Indexing
                </label>
                <p className="text-[11px] text-[#9ca3af]">
                  Enable neural face detection and 128-D vector indexing for guests to find themselves.
                </p>
              </div>
              <input
                id="facesearch-toggle"
                type="checkbox"
                checked={faceSearchEnabled}
                onChange={(e) => setFaceSearchEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#c5a059] cursor-pointer mt-1"
              />
            </div>
          </CardContent>
        </Card>

        {/* Actions bar */}
        <div className="flex items-center justify-between pt-4 border-t border-[#20242a]">
          <Link href="/dashboard/events">
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
            Create Event Container
          </Button>
        </div>
      </form>
    </div>
  );
}
