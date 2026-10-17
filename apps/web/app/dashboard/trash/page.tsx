'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Clock,
  Calendar,
  Camera,
  RefreshCw,
  Image as ImageIcon,
  Video,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { SkeletonCard } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Modal } from '../../../components/ui/Modal';
import type { TrashedEventListItem, EmptyBinResultDTO } from '@photography-saas/types';

export default function RecycleBinPage() {
  const [events, setEvents] = useState<TrashedEventListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Permanent Delete Modal state
  const [permanentDeleteEvent, setPermanentDeleteEvent] = useState<TrashedEventListItem | null>(
    null
  );
  const [confirmNameInput, setConfirmNameInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Empty Bin Modal state
  const [showEmptyModal, setShowEmptyModal] = useState(false);
  const [emptyConfirmInput, setEmptyConfirmInput] = useState('');
  const [isEmptying, setIsEmptying] = useState(false);
  const [emptyError, setEmptyError] = useState<string | null>(null);

  // Restore action state
  const [restoringEventId, setRestoringEventId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const fetchBinEvents = useCallback(async (isSilent = false) => {
    if (isSilent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const res = await fetch('/api/events/trash', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Failed to load Recycle Bin events (HTTP ${res.status})`);
      }

      const json = await res.json();
      if (json.success && json.data?.events) {
        setEvents(json.data.events);
      } else {
        setEvents([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error communicating with Recycle Bin service');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchBinEvents();
  }, [fetchBinEvents]);

  const handleRestore = async (event: TrashedEventListItem) => {
    try {
      setRestoringEventId(event.id);
      const res = await fetch(`/api/events/${event.id}/restore`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        throw new Error(
          errorJson?.error?.message || `Failed to restore event (HTTP ${res.status})`
        );
      }

      showToast(`Event "${event.name}" restored successfully to active status.`);
      fetchBinEvents(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restore event');
    } finally {
      setRestoringEventId(null);
    }
  };

  const handlePermanentDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permanentDeleteEvent) return;

    try {
      setIsDeleting(true);
      setDeleteError(null);

      const res = await fetch(`/api/events/${permanentDeleteEvent.id}/permanent`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          confirmEventName: confirmNameInput.trim(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(
          errJson?.error?.message || `Permanent deletion failed (HTTP ${res.status})`
        );
      }

      showToast(
        `Event "${permanentDeleteEvent.name}" permanently purged from storage and database.`
      );
      setPermanentDeleteEvent(null);
      setConfirmNameInput('');
      fetchBinEvents(true);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Permanent deletion failed');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEmptyBin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsEmptying(true);
      setEmptyError(null);

      const res = await fetch('/api/events/trash/empty', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ confirm: true }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(
          errJson?.error?.message || `Failed to empty Recycle Bin (HTTP ${res.status})`
        );
      }

      const json = await res.json();
      const result: EmptyBinResultDTO = json.data;
      showToast(
        `Recycle Bin emptied: ${result.successfullyDeleted} event(s) purged, ${result.failedCount} failed.`
      );
      setShowEmptyModal(false);
      setEmptyConfirmInput('');
      fetchBinEvents(true);
    } catch (err) {
      setEmptyError(err instanceof Error ? err.message : 'Failed to empty Recycle Bin');
    } finally {
      setIsEmptying(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-6 right-6 z-50 bg-[#16191e] border border-[#c5a059] text-[#f3f4f6] px-5 py-3 rounded-md shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-2 duration-200"
        >
          <CheckCircle2 className="w-4 h-4 text-[#c5a059] shrink-0" />
          <span className="text-xs font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <PageHeader
        eyebrow="Data Retention & Lifecycle"
        title="Recycle Bin"
        description="Soft-deleted client event containers are held for a 30-day retention window before permanent deletion. Photos, videos, and neural face embeddings remain intact until permanently purged."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchBinEvents(true)}
              disabled={isLoading || isRefreshing}
              leftIcon={
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              }
            >
              Refresh
            </Button>

            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setEmptyConfirmInput('');
                setEmptyError(null);
                setShowEmptyModal(true);
              }}
              disabled={isLoading || events.length === 0}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Empty Bin ({events.length})
            </Button>
          </div>
        }
      />

      {/* Retention Policy Banner */}
      <div className="p-4 bg-[#14171b] border border-[#20242a] rounded-lg flex items-start sm:items-center justify-between gap-4 text-xs text-[#9ca3af]">
        <div className="flex items-center gap-3">
          <Clock className="w-4 h-4 text-[#c5a059] shrink-0" />
          <span>
            Events in the Recycle Bin are isolated from public gallery access and guest search.
            Restoring an event returns it to your dashboard in private state.
          </span>
        </div>
        <Badge variant="outline" className="shrink-0 text-[11px] font-mono">
          30-Day Retention
        </Badge>
      </div>

      {/* Content Area */}
      {isLoading ? (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : error ? (
        <ErrorState
          title="Error Loading Recycle Bin"
          message={error}
          onRetry={() => fetchBinEvents()}
        />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<Trash2 className="w-8 h-8 stroke-[1.5]" />}
          title="Recycle Bin is Empty"
          description="No client events have been moved to the Recycle Bin. When you delete an event from your dashboard, it will appear here for 30 days before automatic permanent deletion."
        />
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const isUrgent = event.days_remaining <= 3;
            const isRestoring = restoringEventId === event.id;

            return (
              <div
                key={event.id}
                className="bg-[#121418] border border-[#20242a] hover:border-[#2e343d] rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-5 transition-colors"
              >
                {/* Left: Thumbnail and Metadata */}
                <div className="flex items-start sm:items-center gap-4 min-w-0 flex-1">
                  {/* Cover Thumbnail */}
                  <div className="w-16 h-16 rounded-md bg-[#181b20] border border-[#20242a] overflow-hidden flex items-center justify-center shrink-0">
                    {event.cover_preview_url ? (
                      <img
                        src={event.cover_preview_url}
                        alt={event.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Camera className="w-6 h-6 text-[#4b5563]" />
                    )}
                  </div>

                  {/* Details */}
                  <div className="min-w-0 space-y-1.5 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-sm font-semibold text-[#f3f4f6] truncate font-display tracking-wide text-base">
                        {event.name}
                      </h3>
                      <Badge variant="warning" className="text-[10px] uppercase font-mono">
                        {event.status}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-[#9ca3af] flex-wrap">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#6b7280]" />
                        {event.event_date}
                      </span>

                      <span className="flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5 text-[#6b7280]" />
                        {event.photo_count ?? 0} {event.photo_count === 1 ? 'photo' : 'photos'}
                      </span>

                      {Boolean(event.video_count) && (
                        <span className="flex items-center gap-1.5">
                          <Video className="w-3.5 h-3.5 text-[#6b7280]" />
                          {event.video_count} {event.video_count === 1 ? 'video' : 'videos'}
                        </span>
                      )}

                      <span className="flex items-center gap-1.5">
                        <Trash2 className="w-3.5 h-3.5 text-[#6b7280]" />
                        Moved to bin: {new Date(event.deleted_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Center / Right: Retention Badge & Actions */}
                <div className="flex items-center justify-between md:justify-end gap-4 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-[#20242a]">
                  {/* Retention Countdown */}
                  <div className="text-left md:text-right">
                    <div
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                        isUrgent
                          ? 'bg-[#e63946]/10 border-[#e63946]/30 text-[#e63946]'
                          : 'bg-[#181b20] border-[#2c323b] text-[#c5a059]'
                      }`}
                    >
                      {isUrgent ? (
                        <AlertTriangle className="w-3 h-3 text-[#e63946]" />
                      ) : (
                        <Clock className="w-3 h-3 text-[#c5a059]" />
                      )}
                      <span>
                        {event.days_remaining} {event.days_remaining === 1 ? 'day' : 'days'}{' '}
                        remaining
                      </span>
                    </div>
                    <p className="text-[10px] text-[#6b7280] mt-1 font-mono">
                      Purge: {new Date(event.purge_after).toLocaleDateString()}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestore(event)}
                      disabled={isRestoring}
                      leftIcon={
                        <RotateCcw
                          className={`w-3.5 h-3.5 text-[#c5a059] ${isRestoring ? 'animate-spin' : ''}`}
                        />
                      }
                    >
                      Restore
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPermanentDeleteEvent(event);
                        setConfirmNameInput('');
                        setDeleteError(null);
                      }}
                      className="text-[#9ca3af] hover:text-[#e63946] hover:bg-[#e63946]/10"
                      leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Permanently Delete Confirmation Modal */}
      {permanentDeleteEvent && (
        <Modal
          isOpen={true}
          onClose={() => setPermanentDeleteEvent(null)}
          title="Permanently Delete Event"
        >
          <form onSubmit={handlePermanentDelete} className="space-y-4">
            <div className="p-4 bg-[#e63946]/10 border border-[#e63946]/30 rounded-md flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-[#e63946] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#f3f4f6]">
                  Irreversible Destructive Action
                </p>
                <p className="text-xs text-[#9ca3af] leading-relaxed">
                  Permanently deleting <strong>{permanentDeleteEvent.name}</strong> will completely
                  purge all original photos, WebP derivatives, videos, and facial vector embeddings
                  from Cloudflare R2 and PostgreSQL.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 bg-[#e63946]/15 border border-[#e63946]/40 text-[#fca5a5] rounded-md text-xs">
                {deleteError}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs text-[#9ca3af]">
                Type the event name{' '}
                <strong className="text-[#f3f4f6] font-mono">{permanentDeleteEvent.name}</strong> to
                confirm:
              </label>
              <input
                type="text"
                value={confirmNameInput}
                onChange={(e) => setConfirmNameInput(e.target.value)}
                placeholder={permanentDeleteEvent.name}
                className="w-full bg-[#14171b] border border-[#20242a] focus:border-[#e63946] focus:ring-1 focus:ring-[#e63946] text-[#f3f4f6] text-xs px-3 py-2 rounded-md outline-none transition-colors"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setPermanentDeleteEvent(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>

              <Button
                variant="destructive"
                size="sm"
                type="submit"
                disabled={
                  isDeleting ||
                  confirmNameInput.trim().toLowerCase() !==
                    permanentDeleteEvent.name.trim().toLowerCase()
                }
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              >
                {isDeleting ? 'Purging Storage...' : 'Permanently Delete'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Empty Recycle Bin Modal */}
      {showEmptyModal && (
        <Modal isOpen={true} onClose={() => setShowEmptyModal(false)} title="Empty Recycle Bin">
          <form onSubmit={handleEmptyBin} className="space-y-4">
            <div className="p-4 bg-[#e63946]/10 border border-[#e63946]/30 rounded-md flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-[#e63946] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#f3f4f6]">Purge All Trashed Events</p>
                <p className="text-xs text-[#9ca3af] leading-relaxed">
                  This will queue permanent deletion jobs for all <strong>{events.length}</strong>{' '}
                  event(s) currently in the Recycle Bin. All associated photos, videos, and
                  embeddings will be irreversibly removed.
                </p>
              </div>
            </div>

            {emptyError && (
              <div className="p-3 bg-[#e63946]/15 border border-[#e63946]/40 text-[#fca5a5] rounded-md text-xs">
                {emptyError}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs text-[#9ca3af]">
                Type <strong className="text-[#f3f4f6] font-mono">EMPTY BIN</strong> to confirm:
              </label>
              <input
                type="text"
                value={emptyConfirmInput}
                onChange={(e) => setEmptyConfirmInput(e.target.value)}
                placeholder="EMPTY BIN"
                className="w-full bg-[#14171b] border border-[#20242a] focus:border-[#e63946] focus:ring-1 focus:ring-[#e63946] text-[#f3f4f6] text-xs px-3 py-2 rounded-md outline-none transition-colors"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setShowEmptyModal(false)}
                disabled={isEmptying}
              >
                Cancel
              </Button>

              <Button
                variant="destructive"
                size="sm"
                type="submit"
                disabled={isEmptying || emptyConfirmInput.trim() !== 'EMPTY BIN'}
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              >
                {isEmptying ? 'Queuing Purge Jobs...' : 'Empty Recycle Bin'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
