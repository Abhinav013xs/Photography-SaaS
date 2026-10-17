'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Calendar,
  Lock,
  Globe,
  ArrowLeft,
  Clock,
  Download,
  Stamp,
  Users,
  Edit3,
  Archive,
  RefreshCw,
  Trash2,
  Share2,
  Folder,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '../../../../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { SkeletonCard } from '../../../../components/ui/Skeleton';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { DeleteEventModal } from '../../../../components/dashboard/DeleteEventModal';
import { ShareModal } from '../../../../components/dashboard/ShareModal';
import { FolderManagement } from '../../../../components/dashboard/FolderManagement';
import { MediaGallery } from '../../../../components/dashboard/MediaGallery';
import type { EventDetail } from '@photography-saas/types';

export default function EventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'folders' | 'media' | 'facesearch'>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const fetchEvent = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Event not found or unauthorized');
      }

      const json = await res.json();
      if (json.success && json.data?.event) {
        setEvent(json.data.event);
      } else {
        throw new Error('Failed to retrieve event');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching event details');
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  const handleTogglePublish = async () => {
    if (!event) return;
    setIsActionLoading(true);
    try {
      const endpoint =
        event.visibility === 'public'
          ? `/api/events/${eventId}/unpublish`
          : `/api/events/${eventId}/publish`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || 'Failed to update visibility');
      }

      await fetchEvent();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update visibility');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!event) return;
    setIsActionLoading(true);
    try {
      const endpoint =
        event.status === 'archived'
          ? `/api/events/${eventId}/restore`
          : `/api/events/${eventId}/archive`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || 'Failed to update status');
      }

      await fetchEvent();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update lifecycle state');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!event) return;
    const res = await fetch(`/api/events/${eventId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ confirmEventName: event.name }),
    });

    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error?.message || 'Failed to delete event');
    }

    router.push('/dashboard/events');
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error || !event) {
    return (
      <ErrorState
        title="Event Not Found"
        message={error || 'The requested event could not be found or you do not have permission to view it.'}
        onRetry={fetchEvent}
      />
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
        <Link href="/dashboard/events" className="hover:text-white transition-colors flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          Events
        </Link>
        <span>/</span>
        <span className="text-white font-medium truncate max-w-xs">{event.name}</span>
      </div>

      {/* Page Header with Actions */}
      <PageHeader
        eyebrow={`${event.client_name} • ${event.event_date}${event.location ? ` • ${event.location}` : ''}`}
        title={event.name}
        description={event.description || 'No internal notes provided for this event container.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={event.visibility === 'public' ? 'outline' : 'primary'}
              size="sm"
              onClick={handleTogglePublish}
              disabled={isActionLoading}
              leftIcon={<Globe className="w-3.5 h-3.5" />}
            >
              {event.visibility === 'public'
                ? 'Make Private'
                : event.is_expired || event.expired_at
                ? 'Republish Gallery'
                : 'Publish Gallery'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsShareModalOpen(true)}
              leftIcon={<Share2 className="w-3.5 h-3.5" />}
            >
              Share & QR
            </Button>

            <Link href={`/dashboard/events/${event.id}/edit`}>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Edit3 className="w-3.5 h-3.5" />}
              >
                Edit Settings
              </Button>
            </Link>

            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleArchive}
              disabled={isActionLoading}
              leftIcon={<Archive className="w-3.5 h-3.5" />}
            >
              {event.status === 'archived' ? 'Restore' : 'Archive'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsDeleteModalOpen(true)}
              className="text-[#e63946] hover:bg-[#e63946]/10"
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Delete
            </Button>
          </div>
        }
      />

      {/* Status & Protection Overview Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 bg-[#121418] border border-[#20242a] rounded-lg space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[#9ca3af]">Status</span>
          <div className="flex items-center gap-1.5 pt-0.5">
            <Badge
              variant={
                event.status === 'active'
                  ? 'success'
                  : event.status === 'draft'
                  ? 'warning'
                  : 'default'
              }
              size="sm"
            >
              {event.status.toUpperCase()}
            </Badge>
          </div>
        </div>

        <div className="p-3.5 bg-[#121418] border border-[#20242a] rounded-lg space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[#9ca3af]">Visibility</span>
          <div className="flex items-center gap-1.5 pt-0.5">
            <Badge
              variant={
                event.visibility === 'public'
                  ? event.is_expired
                    ? 'destructive'
                    : 'bronze'
                  : event.is_expired || event.expired_at
                  ? 'destructive'
                  : 'outline'
              }
              size="sm"
            >
              {event.visibility === 'public'
                ? event.is_expired
                  ? 'EXPIRED'
                  : 'PUBLIC'
                : event.is_expired || event.expired_at
                ? 'EXPIRED'
                : 'PRIVATE'}
            </Badge>
          </div>
        </div>

        <div className="p-3.5 bg-[#121418] border border-[#20242a] rounded-lg space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[#9ca3af]">Security</span>
          <div className="text-xs font-medium text-white flex items-center gap-1 pt-0.5">
            {event.pin_enabled ? (
              <span className="text-[#c5a059] flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" /> PIN Protected
              </span>
            ) : (
              <span className="text-[#9ca3af]">Open Access</span>
            )}
          </div>
        </div>

        <div className="p-3.5 bg-[#121418] border border-[#20242a] rounded-lg space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-[#9ca3af]">Downloads</span>
          <div className="text-xs font-medium text-white flex items-center gap-1 pt-0.5">
            {event.allow_downloads ? (
              <span className="text-emerald-400">Enabled</span>
            ) : (
              <span className="text-[#9ca3af]">Disabled</span>
            )}
          </div>
        </div>
      </div>

      {/* Workspace Tabs */}
      <div className="flex items-center gap-1 border-b border-[#20242a]">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'overview'
              ? 'border-[#c5a059] text-white'
              : 'border-transparent text-[#9ca3af] hover:text-white'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('folders')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'folders'
              ? 'border-[#c5a059] text-white'
              : 'border-transparent text-[#9ca3af] hover:text-white'
          }`}
        >
          <Folder className="w-3.5 h-3.5" />
          Folders
        </button>
        <button
          onClick={() => setActiveTab('media')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'media'
              ? 'border-[#c5a059] text-white'
              : 'border-transparent text-[#9ca3af] hover:text-white'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          Media <Badge variant="outline" size="sm">Phase 10</Badge>
        </button>
        <button
          onClick={() => setActiveTab('facesearch')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'facesearch'
              ? 'border-[#c5a059] text-white'
              : 'border-transparent text-[#9ca3af] hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Face Search <Badge variant="outline" size="sm">Phase 16</Badge>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'overview' && (
        <div className="space-y-6 animate-in fade-in">
          <Card>
            <CardHeader className="p-5 border-b border-[#20242a]">
              <CardTitle className="text-sm font-medium text-white">
                Container Specifications & Metadata
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
              <div className="space-y-3">
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">URL Slug</span>
                  <span className="font-mono text-white select-all">/gallery/{event.slug}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">Client Name</span>
                  <span className="text-white font-medium">{event.client_name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">Client Email</span>
                  <span className="text-white">{event.client_email || '—'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">Event Date</span>
                  <span className="text-white font-mono">{event.event_date}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">Location / Venue</span>
                  <span className="text-white">{event.location || '—'}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">Watermark Branding</span>
                  <span className="text-white">
                    {event.watermark_enabled ? event.watermark_text : 'Disabled'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">AI Biometric Index</span>
                  <span className="text-white">
                    {event.face_search_enabled ? 'Active (Ready)' : 'Disabled'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">Public Duration</span>
                  <span className="text-white">
                    {event.public_duration_days || 30} Days (Max 30)
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">Public Window</span>
                  <span className="text-white">
                    {event.public_until
                      ? `Until ${new Date(event.public_until).toLocaleString()}`
                      : 'Not scheduled'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">Created At</span>
                  <span className="text-[#9ca3af] font-mono">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#20242a]">
                  <span className="text-[#9ca3af]">Last Updated</span>
                  <span className="text-[#9ca3af] font-mono">
                    {new Date(event.updated_at).toLocaleString()}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'folders' && (
        <FolderManagement eventId={event.id} eventName={event.name} />
      )}

      {activeTab === 'media' && (
        <MediaGallery eventId={event.id} eventName={event.name} />
      )}

      {activeTab === 'facesearch' && (
        <EmptyState
          icon={<Users className="w-6 h-6 stroke-[1.5]" />}
          badge="Phase 16 Implementation Target"
          title="Neural Face-Search Biometrics"
          description="OpenCV YuNet face detection and 128-dimensional SFace vector embeddings will be implemented in Phase 14-16 with zero guest selfie retention."
        />
      )}

      {/* Delete Confirmation Modal */}
      <DeleteEventModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        eventName={event.name}
        onConfirm={handleDeleteConfirm}
      />

      {/* Share & QR Code Modal */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        event={event}
      />
    </div>
  );
}
