'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FolderPlus,
  Edit3,
  Trash2,
  RefreshCw,
  Eye,
  Layers,
  Image as ImageIcon,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { SkeletonCard } from '../ui/Skeleton';
import {
  CreateFolderModal,
  RenameFolderModal,
  DeleteFolderModal,
  FolderDetailModal,
} from './FolderModals';
import type { FolderItem, FolderListResult } from '@photography-saas/types';

interface FolderManagementProps {
  eventId: string;
  eventName: string;
}

export function FolderManagement({ eventId, eventName }: FolderManagementProps) {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [rootMediaCount, setRootMediaCount] = useState(0);
  const [totalMediaCount, setTotalMediaCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedFolderForRename, setSelectedFolderForRename] = useState<FolderItem | null>(null);
  const [selectedFolderForDelete, setSelectedFolderForDelete] = useState<FolderItem | null>(null);
  const [selectedFolderForDetail, setSelectedFolderForDetail] = useState<FolderItem | null>(null);

  const showFeedback = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => {
      setFeedbackMessage(null);
    }, 4000);
  };

  const fetchFolders = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/folders`, {
        credentials: 'include',
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error?.message || 'Failed to retrieve event folders');
      }

      const json = await res.json();
      if (json.success && json.data) {
        const data: FolderListResult = json.data;
        setFolders(data.folders || []);
        setRootMediaCount(data.root_media_count ?? 0);
        setTotalMediaCount(data.total_media_count ?? 0);
      } else {
        throw new Error('Unexpected API response format');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading ceremony folders');
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const handleFolderCreated = (newFolder: FolderItem) => {
    setFolders((prev) => [...prev, newFolder].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
    showFeedback(`Folder "${newFolder.name}" created successfully.`);
  };

  const handleFolderRenamed = (updatedFolder: FolderItem) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === updatedFolder.id ? updatedFolder : f))
    );
    showFeedback(`Folder renamed to "${updatedFolder.name}".`);
  };

  const handleFolderDeleted = (deletedFolderId: string) => {
    const deleted = folders.find((f) => f.id === deletedFolderId);
    setFolders((prev) => prev.filter((f) => f.id !== deletedFolderId));
    // Re-fetch to accurately reflect updated media counts and root counts
    fetchFolders();
    showFeedback(
      deleted
        ? `Folder "${deleted.name}" deleted safely. Associated media reassigned to event root.`
        : 'Folder deleted safely.'
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center pb-2">
          <div className="h-4 w-32 bg-[#20242a] rounded animate-pulse" />
          <div className="h-8 w-28 bg-[#20242a] rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to Load Folders"
        message={error}
        onRetry={fetchFolders}
      />
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Feedback Banner */}
      {feedbackMessage && (
        <div
          className="flex items-center gap-2 p-3 bg-[#c5a059]/10 border border-[#c5a059]/30 rounded-md text-xs text-[#c5a059] animate-in fade-in"
          role="status"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* Header & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1 border-b border-[#20242a]">
        <div className="space-y-1">
          <h2 className="text-base font-medium text-white tracking-tight flex items-center gap-2">
            <Folder className="w-4 h-4 text-[#c5a059]" />
            Ceremony & Category Folders
          </h2>
          <p className="text-xs text-[#9ca3af]">
            Organize this event's photos and videos into structured ceremony moments.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchFolders}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            aria-label="Refresh folder list"
          >
            Refresh
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsCreateModalOpen(true)}
            leftIcon={<FolderPlus className="w-3.5 h-3.5" />}
          >
            New Folder
          </Button>
        </div>
      </div>

      {/* Summary Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="p-3 bg-[#121418] border border-[#20242a] rounded-lg">
          <span className="text-[10px] uppercase tracking-wider text-[#9ca3af] block">Total Folders</span>
          <span className="text-sm font-medium text-white font-mono mt-0.5 block">
            {folders.length}
          </span>
        </div>

        <div className="p-3 bg-[#121418] border border-[#20242a] rounded-lg">
          <span className="text-[10px] uppercase tracking-wider text-[#9ca3af] block">Event Root (Uncategorized)</span>
          <span className="text-sm font-medium text-white font-mono mt-0.5 block">
            {rootMediaCount} assets
          </span>
        </div>

        <div className="p-3 bg-[#121418] border border-[#20242a] rounded-lg col-span-2 sm:col-span-1">
          <span className="text-[10px] uppercase tracking-wider text-[#9ca3af] block">Total Event Media</span>
          <span className="text-sm font-medium text-[#c5a059] font-mono mt-0.5 block">
            {totalMediaCount} assets
          </span>
        </div>
      </div>

      {/* Empty State */}
      {folders.length === 0 ? (
        <EmptyState
          icon={<FolderPlus className="w-6 h-6 stroke-[1.5] text-[#c5a059]" />}
          title="No Folders Created Yet"
          description="Create folders to categorize your client's gallery into distinct moments like Haldi, Mehndi, Ceremony, Reception, or Portraits."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
              leftIcon={<FolderPlus className="w-3.5 h-3.5" />}
            >
              Create First Folder
            </Button>
          }
        />
      ) : (
        /* Folders Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {folders.map((f) => (
            <Card
              key={f.id}
              className="group hover:border-[#c5a059]/40 transition-all duration-200 bg-[#121418]"
            >
              <CardHeader className="p-4 pb-3 flex flex-row items-start justify-between space-y-0">
                <div className="flex items-start gap-3 overflow-hidden">
                  <div className="w-8 h-8 rounded bg-[#1a1d23] border border-[#20242a] flex items-center justify-center shrink-0 text-[#c5a059] group-hover:border-[#c5a059]/30 transition-colors">
                    <Folder className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 pr-1">
                    <CardTitle className="text-sm font-medium text-white truncate group-hover:text-[#c5a059] transition-colors">
                      {f.name}
                    </CardTitle>
                    <span className="text-[11px] text-[#9ca3af] font-mono mt-0.5 block">
                      Order #{f.sort_order}
                    </span>
                  </div>
                </div>

                <Badge variant="outline" size="sm" className="shrink-0 font-mono text-[10px]">
                  {f.media_count} {f.media_count === 1 ? 'asset' : 'assets'}
                </Badge>
              </CardHeader>

              <CardContent className="p-4 pt-1 border-t border-[#20242a]/60 mt-2 flex items-center justify-between text-xs text-[#9ca3af]">
                <span className="text-[10px] text-[#6b7280]">
                  {new Date(f.created_at).toLocaleDateString()}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSelectedFolderForDetail(f)}
                    className="p-1.5 rounded text-[#9ca3af] hover:text-white hover:bg-[#20242a] transition-colors cursor-pointer"
                    title="View Folder Details"
                    aria-label={`View details for folder ${f.name}`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => setSelectedFolderForRename(f)}
                    className="p-1.5 rounded text-[#9ca3af] hover:text-[#c5a059] hover:bg-[#20242a] transition-colors cursor-pointer"
                    title="Rename Folder"
                    aria-label={`Rename folder ${f.name}`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => setSelectedFolderForDelete(f)}
                    className="p-1.5 rounded text-[#9ca3af] hover:text-[#e63946] hover:bg-[#e63946]/10 transition-colors cursor-pointer"
                    title="Delete Folder Safely"
                    aria-label={`Delete folder ${f.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modals */}
      <CreateFolderModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        eventId={eventId}
        onCreated={handleFolderCreated}
      />

      <RenameFolderModal
        isOpen={Boolean(selectedFolderForRename)}
        onClose={() => setSelectedFolderForRename(null)}
        eventId={eventId}
        folder={selectedFolderForRename}
        onRenamed={handleFolderRenamed}
      />

      <DeleteFolderModal
        isOpen={Boolean(selectedFolderForDelete)}
        onClose={() => setSelectedFolderForDelete(null)}
        eventId={eventId}
        folder={selectedFolderForDelete}
        onDeleted={handleFolderDeleted}
      />

      <FolderDetailModal
        isOpen={Boolean(selectedFolderForDetail)}
        onClose={() => setSelectedFolderForDetail(null)}
        folder={selectedFolderForDetail}
        onOpenRename={(f) => setSelectedFolderForRename(f)}
        onOpenDelete={(f) => setSelectedFolderForDelete(f)}
      />
    </div>
  );
}
