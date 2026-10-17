'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  UploadCloud,
  Folder as FolderIcon,
  FileImage,
  Film,
  RefreshCw,
  Clock,
  HardDrive,
  Info,
  CheckCircle2,
  AlertCircle,
  Filter,
  Play,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonCard } from '../ui/Skeleton';
import { UploadModal } from './UploadModal';
import { formatBytes } from '../../lib/uploadManager';
import type { FolderItem, MediaListItem } from '@photography-saas/types';

export interface MediaGalleryProps {
  eventId: string;
  eventName: string;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function MediaGallery({ eventId, eventName }: MediaGalleryProps) {
  const [mediaItems, setMediaItems] = useState<MediaListItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string>('all');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'all' | 'photo' | 'video'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedMediaDetail, setSelectedMediaDetail] = useState<MediaListItem | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // Fetch folders for filtering and destination selection
  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/folders`, {
        credentials: 'include',
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.folders) {
          setFolders(json.data.folders);
        }
      }
    } catch {
      // Non-blocking error
    }
  }, [eventId]);

  // Fetch media assets
  const fetchMedia = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let url = `/api/events/${eventId}/media?limit=100`;
      if (selectedFolderFilter !== 'all') {
        url += `&folderId=${encodeURIComponent(selectedFolderFilter)}`;
      }
      if (selectedTypeFilter !== 'all') {
        url += `&type=${encodeURIComponent(selectedTypeFilter)}`;
      }

      const res = await fetch(url, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Failed to load event media assets');
      }

      const json = await res.json();
      if (json.success && json.data?.media) {
        setMediaItems(json.data.media);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error retrieving media');
    } finally {
      setIsLoading(false);
    }
  }, [eventId, selectedFolderFilter, selectedTypeFilter]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  const handleRetryProcessing = async (mediaId: string) => {
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/events/${eventId}/media/${mediaId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (res.ok) {
        await fetchMedia();
        setSelectedMediaDetail(null);
      }
    } catch {
      // Non-blocking retry failure
    } finally {
      setIsRetrying(false);
    }
  };

  const totalBytes = mediaItems.reduce((sum, item) => sum + item.fileSize, 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return <Badge variant="success" size="sm" className="font-mono">READY</Badge>;
      case 'processing':
        return <Badge variant="bronze" size="sm" className="font-mono animate-pulse">PROCESSING</Badge>;
      case 'failed':
        return <Badge variant="destructive" size="sm" className="font-mono">FAILED</Badge>;
      default:
        return <Badge variant="default" size="sm" className="font-mono">UPLOADED</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-[#14171b] border border-[#20242a] rounded-[6px]">
        <div className="flex flex-wrap items-center gap-3">
          {/* Folder filter */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Filter className="w-3.5 h-3.5 text-[#c5a059]" />
            <span>Folder:</span>
          </div>
          <select
            value={selectedFolderFilter}
            onChange={(e) => setSelectedFolderFilter(e.target.value)}
            className="bg-[#191d22] border border-[#262b32] text-white px-2.5 py-1.5 rounded-[4px] text-xs focus:outline-hidden focus:border-[#c5a059] cursor-pointer"
          >
            <option value="all">All Photos</option>
            <option value="root">Event Root (Uncategorized)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.media_count})
              </option>
            ))}
          </select>

          {/* Type filter */}
          <select
            value={selectedTypeFilter}
            onChange={(e) => setSelectedTypeFilter(e.target.value as any)}
            className="bg-[#191d22] border border-[#262b32] text-white px-2.5 py-1.5 rounded-[4px] text-xs focus:outline-hidden focus:border-[#c5a059] cursor-pointer"
          >
            <option value="all">All Media</option>
            <option value="photo">Photos Only</option>
            <option value="video">Videos Only</option>
          </select>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchMedia}
            title="Refresh media"
            className="text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>

          {mediaItems.length > 0 && (
            <span className="text-xs text-gray-400 font-mono hidden md:inline">
              • {mediaItems.length} {mediaItems.length === 1 ? 'asset' : 'assets'} • {formatBytes(totalBytes)} total
            </span>
          )}
        </div>

        <Button
          variant="primary"
          onClick={() => setIsUploadModalOpen(true)}
          className="flex items-center gap-2"
        >
          <UploadCloud className="w-4 h-4" />
          <span>Upload Photos</span>
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <SkeletonCard className="h-56" />
          <SkeletonCard className="h-56" />
          <SkeletonCard className="h-56" />
          <SkeletonCard className="h-56" />
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="p-4 bg-red-950/30 border border-red-900/40 rounded-[6px] text-sm text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={fetchMedia}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && mediaItems.length === 0 && (
        <EmptyState
          icon={<FileImage className="w-6 h-6 stroke-[1.5]" />}
          badge="Event Media Storage"
          title="No Media Assets Uploaded Yet"
          description="Upload high-resolution master photographs and videos into this event container. Files are safely ingested into Cloudflare R2 object storage."
          action={
            <Button
              variant="primary"
              onClick={() => setIsUploadModalOpen(true)}
              className="flex items-center gap-2 mt-4"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Upload Media Now</span>
            </Button>
          }
        />
      )}

      {/* Media Grid */}
      {!isLoading && !error && mediaItems.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {mediaItems.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedMediaDetail(item)}
              className="group bg-[#14171b] border border-[#20242a] hover:border-[#38404a] rounded-[6px] overflow-hidden transition-all duration-200 cursor-pointer flex flex-col"
            >
              {/* Media Preview Box */}
              <div className="aspect-4/3 bg-[#0a0b0d] border-b border-[#20242a] relative flex items-center justify-center p-4 overflow-hidden">
                {item.type === 'video' ? (
                  <Film className="w-10 h-10 text-[#c5a059]/70 group-hover:text-[#c5a059] transition-colors stroke-[1.2]" />
                ) : (
                  <FileImage className="w-10 h-10 text-[#2a3038] group-hover:text-[#c5a059] transition-colors stroke-[1.2]" />
                )}

                {/* Status Badge */}
                <div className="absolute top-2 right-2">
                  {getStatusBadge(item.status)}
                </div>

                {/* Media Type / Video Duration indicator */}
                {item.type === 'video' && (
                  <div className="absolute bottom-2 left-2 bg-black/80 border border-[#2a3038] text-white font-mono text-[10px] px-1.5 py-0.5 rounded-[3px] flex items-center gap-1">
                    <Film className="w-2.5 h-2.5 text-[#c5a059]" />
                    <span>{item.videoDuration ? formatDuration(item.videoDuration) : 'VIDEO'}</span>
                  </div>
                )}
              </div>

              {/* Media Card Details */}
              <div className="p-3 space-y-1.5 flex-1 flex flex-col justify-between">
                <div>
                  <h4
                    className="text-xs font-medium text-gray-200 truncate group-hover:text-white transition-colors"
                    title={item.originalName}
                  >
                    {item.originalName}
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-1">
                    <span className="font-mono">{formatBytes(item.fileSize)}</span>
                    <span>•</span>
                    <span className="truncate max-w-[100px]">
                      {item.folderName || 'Event Root'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#1c2026] flex items-center justify-between text-[10px] text-gray-500">
                  <span className="font-mono">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                  <span className="text-[#c5a059] group-hover:underline flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Details
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Media Asset Details Modal */}
      {selectedMediaDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedMediaDetail(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md bg-[#14171b] border border-[#20242a] rounded-[6px] shadow-[0_16px_48px_rgba(0,0,0,0.9)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-[#20242a] flex items-center justify-between">
              <div className="flex items-center gap-2 max-w-[280px]">
                {selectedMediaDetail.type === 'video' ? (
                  <Film className="w-4 h-4 text-[#c5a059] shrink-0" />
                ) : (
                  <FileImage className="w-4 h-4 text-[#c5a059] shrink-0" />
                )}
                <h3 className="text-base font-medium text-white truncate">
                  {selectedMediaDetail.originalName}
                </h3>
              </div>
              <button
                onClick={() => setSelectedMediaDetail(null)}
                className="text-gray-400 hover:text-white p-1 rounded-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                <span className="text-gray-400">Media Type</span>
                <span className="text-white font-medium uppercase font-mono">
                  {selectedMediaDetail.type}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                <span className="text-gray-400">Media ID</span>
                <span className="text-white font-mono select-all text-[11px]">
                  {selectedMediaDetail.id}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                <span className="text-gray-400">Folder</span>
                <span className="text-white font-medium">
                  {selectedMediaDetail.folderName || 'Event Root (Uncategorized)'}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                <span className="text-gray-400">File Size</span>
                <span className="text-white font-mono">
                  {formatBytes(selectedMediaDetail.fileSize)} ({selectedMediaDetail.fileSize} bytes)
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                <span className="text-gray-400">MIME Type</span>
                <span className="text-white font-mono">{selectedMediaDetail.mimeType}</span>
              </div>
              {selectedMediaDetail.type === 'video' && selectedMediaDetail.videoDuration && (
                <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                  <span className="text-gray-400">Duration</span>
                  <span className="text-white font-mono">
                    {formatDuration(selectedMediaDetail.videoDuration)} ({selectedMediaDetail.videoDuration.toFixed(1)}s)
                  </span>
                </div>
              )}
              {selectedMediaDetail.type === 'video' && (selectedMediaDetail.videoCodec || selectedMediaDetail.audioCodec) && (
                <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                  <span className="text-gray-400">Codecs</span>
                  <span className="text-white font-mono uppercase">
                    {selectedMediaDetail.videoCodec || 'N/A'} {selectedMediaDetail.audioCodec ? `/ ${selectedMediaDetail.audioCodec}` : ''}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                <span className="text-gray-400">R2 Object Key</span>
                <span className="text-white font-mono text-[10px] select-all truncate max-w-[240px]">
                  {selectedMediaDetail.storageKeyOriginal}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                <span className="text-gray-400">Status</span>
                <div>{getStatusBadge(selectedMediaDetail.status)}</div>
              </div>
              {selectedMediaDetail.processingError && (
                <div className="py-1.5 border-b border-[#1c2026] text-red-400">
                  <span className="text-gray-400 block mb-1">Processing Error:</span>
                  <span className="text-[11px] font-mono break-all">{selectedMediaDetail.processingError}</span>
                </div>
              )}
              <div className="flex justify-between py-1.5 border-b border-[#1c2026]">
                <span className="text-gray-400">Ingestion Timestamp</span>
                <span className="text-gray-300 font-mono">
                  {new Date(selectedMediaDetail.createdAt).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="p-4 bg-[#0e1013] border-t border-[#20242a] flex justify-between items-center">
              <div>
                {selectedMediaDetail.status === 'failed' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isRetrying}
                    onClick={() => handleRetryProcessing(selectedMediaDetail.id)}
                    className="text-[#c5a059] border-[#c5a059]/40 hover:bg-[#c5a059]/10"
                  >
                    {isRetrying ? 'Retrying...' : 'Retry Processing'}
                  </Button>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedMediaDetail(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        eventId={eventId}
        eventName={eventName}
        folders={folders}
        defaultFolderId={
          selectedFolderFilter !== 'all' && selectedFolderFilter !== 'root'
            ? selectedFolderFilter
            : null
        }
        onUploadComplete={() => {
          fetchMedia();
          fetchFolders();
        }}
      />
    </div>
  );
}
