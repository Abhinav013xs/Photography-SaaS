'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  UploadCloud,
  X,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Folder as FolderIcon,
  FileImage,
  Film,
  Ban,
  Trash2,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import {
  type UploadQueueItem,
  type UploadItemStatus,
  validateClientMediaFile,
  validateClientPhotoFile,
  formatBytes,
  DEFAULT_CONCURRENCY,
  MAX_BATCH_FILES,
} from '../../lib/uploadManager';
import type { FolderItem } from '@photography-saas/types';

export interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  eventName: string;
  folders: FolderItem[];
  defaultFolderId?: string | null;
  onUploadComplete?: () => void;
}

export function UploadModal({
  isOpen,
  onClose,
  eventId,
  eventName,
  folders,
  defaultFolderId = null,
  onUploadComplete,
}: UploadModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(defaultFolderId);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep ref to queue for worker pool access
  const queueRef = useRef<UploadQueueItem[]>(queue);
  queueRef.current = queue;

  // Active XHR requests tracked by client ID
  const activeXhrsRef = useRef<Map<string, XMLHttpRequest>>(new Map());

  // Concurrency tracker
  const activeCountRef = useRef(0);
  const isProcessingRef = useRef(false);
  isProcessingRef.current = isProcessing;

  // Update selected folder if defaultFolderId changes
  useEffect(() => {
    setSelectedFolderId(defaultFolderId);
  }, [defaultFolderId]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      // Abort any ongoing uploads when modal unmounts
      activeXhrsRef.current.forEach((xhr) => xhr.abort());
      activeXhrsRef.current.clear();
    };
  }, []);

  const addFilesToQueue = useCallback((files: FileList | File[]) => {
    const newItems: UploadQueueItem[] = [];
    const rejectedErrors: string[] = [];

    const fileArray = Array.from(files);

    if (queueRef.current.length + fileArray.length > MAX_BATCH_FILES) {
      rejectedErrors.push(
        `Batch limit exceeded: You can upload up to ${MAX_BATCH_FILES} photos per batch.`
      );
      setValidationErrors(rejectedErrors);
      return;
    }

    fileArray.forEach((file) => {
      const { error, mediaType } = validateClientMediaFile(file);
      if (error) {
        rejectedErrors.push(`${file.name}: ${error}`);
      } else {
        newItems.push({
          id: Math.random().toString(36).substring(2, 11) + Date.now().toString(36),
          file,
          name: file.name,
          size: file.size,
          mimeType: file.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg'),
          mediaType,
          folderId: selectedFolderId,
          status: 'Selected',
          progressPercent: 0,
          bytesUploaded: 0,
        });
      }
    });

    if (rejectedErrors.length > 0) {
      setValidationErrors(rejectedErrors);
    } else {
      setValidationErrors([]);
    }

    if (newItems.length > 0) {
      setQueue((prev) => [...prev, ...newItems]);
    }
  }, [selectedFolderId]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeItem = (id: string) => {
    const xhr = activeXhrsRef.current.get(id);
    if (xhr) {
      xhr.abort();
      activeXhrsRef.current.delete(id);
    }
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const cancelItem = (id: string) => {
    const xhr = activeXhrsRef.current.get(id);
    if (xhr) {
      xhr.abort();
      activeXhrsRef.current.delete(id);
    }
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: 'Cancelled', progressPercent: 0 } : item
      )
    );
  };

  const retryItem = (id: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'Waiting',
              progressPercent: 0,
              bytesUploaded: 0,
              errorMessage: undefined,
            }
          : item
      )
    );
  };

  const clearCompleted = () => {
    setQueue((prev) => prev.filter((item) => item.status !== 'Uploaded'));
  };

  /**
   * Process individual upload transfer using presigned URL and XMLHttpRequest.
   */
  const uploadSingleItem = async (item: UploadQueueItem): Promise<void> => {
    return new Promise((resolve) => {
      if (!item.uploadUrl || !item.storageKey || !item.mediaId) {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: 'Failed', errorMessage: 'Missing presigned URL' }
              : q
          )
        );
        resolve();
        return;
      }

      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: 'Uploading' } : q))
      );

      const xhr = new XMLHttpRequest();
      activeXhrsRef.current.set(item.id, xhr);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? { ...q, progressPercent: percent, bytesUploaded: event.loaded }
                : q
            )
          );
        }
      };

      xhr.onload = async () => {
        activeXhrsRef.current.delete(item.id);
        if (xhr.status >= 200 && xhr.status < 300) {
          // Transfer to R2 succeeded; now confirm in database
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? { ...q, status: 'Finalizing', progressPercent: 100, bytesUploaded: item.size }
                : q
            )
          );

          try {
            const confirmRes = await fetch(`/api/events/${eventId}/media/confirm-upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                items: [
                  {
                    mediaId: item.mediaId,
                    storageKey: item.storageKey,
                    originalName: item.name,
                    mimeType: item.mimeType,
                    sizeBytes: item.size,
                    folderId: item.folderId,
                  },
                ],
              }),
            });

            if (!confirmRes.ok) {
              const errJson = await confirmRes.json().catch(() => ({}));
              throw new Error(errJson.error?.message || 'Database confirmation failed');
            }

            const confirmData = await confirmRes.json();
            if (confirmData.data?.failed?.length > 0) {
              throw new Error(confirmData.data.failed[0].error || 'Confirmation failed in storage');
            }

            setQueue((prev) =>
              prev.map((q) => (q.id === item.id ? { ...q, status: 'Uploaded' } : q))
            );
          } catch (err) {
            setQueue((prev) =>
              prev.map((q) =>
                q.id === item.id
                  ? {
                      ...q,
                      status: 'Failed',
                      errorMessage: err instanceof Error ? err.message : 'Confirmation error',
                    }
                  : q
              )
            );
          }
        } else {
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? {
                    ...q,
                    status: 'Failed',
                    errorMessage: `HTTP ${xhr.status}: Storage PUT rejected`,
                  }
                : q
            )
          );
        }
        resolve();
      };

      xhr.onerror = () => {
        activeXhrsRef.current.delete(item.id);
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: 'Failed',
                  errorMessage: 'Network error transferring to R2',
                }
              : q
          )
        );
        resolve();
      };

      xhr.onabort = () => {
        activeXhrsRef.current.delete(item.id);
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'Cancelled' } : q))
        );
        resolve();
      };

      xhr.open('PUT', item.uploadUrl, true);
      xhr.setRequestHeader('Content-Type', item.mimeType);
      xhr.send(item.file);
    });
  };

  /**
   * Orchestrates the upload queue with bounded concurrency (4 parallel transfers).
   */
  const startUpload = async () => {
    setIsProcessing(true);
    setValidationErrors([]);

    // 1. Identify items requiring presign
    const itemsToPresign = queueRef.current.filter(
      (item) => item.status === 'Selected' || (item.status === 'Waiting' && !item.uploadUrl)
    );

    if (itemsToPresign.length > 0) {
      setQueue((prev) =>
        prev.map((item) =>
          itemsToPresign.some((p) => p.id === item.id)
            ? { ...item, status: 'Validating' }
            : item
        )
      );

      try {
        const presignRes = await fetch(`/api/events/${eventId}/media/presign-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            folderId: selectedFolderId,
            items: itemsToPresign.map((item) => ({
              filename: item.name,
              mimeType: item.mimeType,
              sizeBytes: item.size,
              folderId: item.folderId,
            })),
          }),
        });

        if (!presignRes.ok) {
          const errData = await presignRes.json().catch(() => ({}));
          throw new Error(errData.error?.message || 'Server rejected presign batch request');
        }

        const presignData = await presignRes.json();
        const presignedItems = presignData.data.items;

        // Map presigned metadata back to queue items
        setQueue((prev) =>
          prev.map((qItem) => {
            const index = itemsToPresign.findIndex((p) => p.id === qItem.id);
            if (index !== -1 && presignedItems[index]) {
              const meta = presignedItems[index];
              return {
                ...qItem,
                status: 'Waiting',
                mediaId: meta.mediaId,
                storageKey: meta.storageKey,
                uploadUrl: meta.uploadUrl,
              };
            }
            return qItem;
          })
        );
      } catch (err) {
        setValidationErrors([err instanceof Error ? err.message : 'Presign error']);
        setQueue((prev) =>
          prev.map((item) =>
            itemsToPresign.some((p) => p.id === item.id)
              ? {
                  ...item,
                  status: 'Failed',
                  errorMessage: err instanceof Error ? err.message : 'Presign rejected',
                }
              : item
          )
        );
        setIsProcessing(false);
        return;
      }
    }

    // 2. Worker concurrency loop
    const runWorkerLoop = async () => {
      while (true) {
        // Find next item waiting to upload
        const currentQueue = queueRef.current;
        const waitingItem = currentQueue.find((i) => i.status === 'Waiting');

        if (!waitingItem) {
          // Check if any uploads are still in progress
          const stillActive = currentQueue.some(
            (i) => i.status === 'Uploading' || i.status === 'Finalizing'
          );
          if (!stillActive && activeCountRef.current === 0) {
            setIsProcessing(false);
            if (onUploadComplete) onUploadComplete();
            break;
          }
          // Sleep briefly before polling queue state again
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        if (activeCountRef.current < DEFAULT_CONCURRENCY) {
          activeCountRef.current++;
          uploadSingleItem(waitingItem).finally(() => {
            activeCountRef.current--;
          });
        } else {
          // Concurrency limit reached; yield to let an active transfer complete
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    };

    runWorkerLoop();
  };

  if (!isOpen) return null;

  // Batch summary calculations
  const totalCount = queue.length;
  const uploadedCount = queue.filter((i) => i.status === 'Uploaded').length;
  const failedCount = queue.filter((i) => i.status === 'Failed').length;
  const cancelledCount = queue.filter((i) => i.status === 'Cancelled').length;
  const inProgressCount = queue.filter(
    (i) => i.status === 'Uploading' || i.status === 'Finalizing' || i.status === 'Validating'
  ).length;

  const totalBytes = queue.reduce((sum, item) => sum + item.size, 0);
  const totalBytesUploaded = queue.reduce((sum, item) => sum + item.bytesUploaded, 0);
  const overallPercent =
    totalBytes > 0 ? Math.min(100, Math.round((totalBytesUploaded / totalBytes) * 100)) : 0;

  const getStatusBadge = (status: UploadItemStatus, error?: string) => {
    switch (status) {
      case 'Selected':
        return <Badge variant="outline" className="text-gray-400 border-[#20242a]">Selected</Badge>;
      case 'Validating':
        return <Badge variant="bronze" className="animate-pulse">Validating</Badge>;
      case 'Waiting':
        return <Badge variant="warning">Waiting</Badge>;
      case 'Uploading':
        return <Badge variant="bronze" className="bg-[#c5a059]/20 text-[#c5a059] border-[#c5a059]/30">Uploading</Badge>;
      case 'Finalizing':
        return <Badge variant="bronze" className="bg-purple-950/40 text-purple-300 border-purple-800/40">Finalizing</Badge>;
      case 'Uploaded':
        return <Badge variant="success">Uploaded</Badge>;
      case 'Failed':
        return (
          <Badge variant="destructive" title={error} className="cursor-help">
            Failed
          </Badge>
        );
      case 'Cancelled':
        return <Badge variant="outline" className="text-gray-500 border-gray-700">Cancelled</Badge>;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-4xl bg-[#14171b] border border-[#20242a] rounded-[6px] shadow-[0_24px_64px_rgba(0,0,0,0.9)] flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="p-5 md:p-6 border-b border-[#20242a] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-mono tracking-wider uppercase text-[#c5a059]">
                Photo Upload Engine
              </span>
              <span className="text-gray-600">•</span>
              <span className="text-xs text-gray-400 font-medium truncate max-w-[280px]">
                {eventName}
              </span>
            </div>
            <h2 className="text-lg md:text-xl font-medium text-white tracking-tight">
              Add High-Resolution Photographs & Videos
            </h2>
          </div>
          <button
            onClick={() => {
              if (!isProcessing) onClose();
            }}
            disabled={isProcessing}
            className="text-gray-400 hover:text-white p-1.5 rounded-sm hover:bg-[#20242a] transition-colors disabled:opacity-40 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Destination folder bar */}
        <div className="px-5 py-3 bg-[#0e1013] border-b border-[#20242a] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-gray-300">
            <FolderIcon className="w-4 h-4 text-[#c5a059]" />
            <span className="text-gray-400">Destination:</span>
            <select
              value={selectedFolderId || ''}
              onChange={(e) => {
                const val = e.target.value || null;
                setSelectedFolderId(val);
                // Also update queued unstarted items
                setQueue((prev) =>
                  prev.map((i) =>
                    i.status === 'Selected' ? { ...i, folderId: val } : i
                  )
                );
              }}
              disabled={isProcessing}
              className="bg-[#191d22] border border-[#262b32] text-white px-2.5 py-1 rounded-[4px] text-xs focus:outline-hidden focus:border-[#c5a059] disabled:opacity-60 cursor-pointer"
            >
              <option value="">Event Root (Uncategorized)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="text-gray-400 text-[11px] font-mono">
            Direct-to-R2 • Max 100MB photo / 500MB video • Up to 500 items
          </div>
        </div>

        {/* Body content */}
        <div className="p-5 md:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-[6px] p-6 text-center cursor-pointer transition-all duration-200 ${
              isDragging
                ? 'border-[#c5a059] bg-[#c5a059]/5'
                : 'border-[#262b32] hover:border-[#38404a] bg-[#0f1114]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
              onChange={handleFileInputChange}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-full bg-[#1a1e24] border border-[#282e37] flex items-center justify-center mx-auto mb-3 text-[#c5a059]">
              <UploadCloud className="w-6 h-6 stroke-[1.5]" />
            </div>
            <div className="text-sm font-medium text-white mb-1">
              Drag & drop photos here, or <span className="text-[#c5a059] hover:underline">browse files</span>
            </div>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Supports master JPEG, PNG, WebP photos and MP4, MOV, WebM videos. Uploads directly to Cloudflare R2 storage without server buffering.
            </p>
          </div>

          {/* Validation errors banner */}
          {validationErrors.length > 0 && (
            <div className="p-3.5 bg-red-950/30 border border-red-900/40 rounded-[4px] text-xs text-red-300 space-y-1">
              <div className="flex items-center gap-2 font-medium text-red-200">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>File Validation Notice</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] pl-1 text-red-300/90">
                {validationErrors.slice(0, 5).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
                {validationErrors.length > 5 && (
                  <li>...and {validationErrors.length - 5} more files rejected</li>
                )}
              </ul>
            </div>
          )}

          {/* Queue List */}
          {queue.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <div className="flex items-center gap-2 font-medium text-gray-300">
                  <Layers className="w-4 h-4 text-[#c5a059]" />
                  <span>
                    Upload Queue ({queue.length} {queue.length === 1 ? 'file' : 'files'} • {formatBytes(totalBytes)})
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {uploadedCount > 0 && (
                    <button
                      onClick={clearCompleted}
                      className="text-gray-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Clear Completed
                    </button>
                  )}
                  {failedCount > 0 && (
                    <button
                      onClick={() => {
                        queue
                          .filter((i) => i.status === 'Failed')
                          .forEach((i) => retryItem(i.id));
                      }}
                      className="text-[#c5a059] hover:underline transition-colors cursor-pointer"
                    >
                      Retry All Failed
                    </button>
                  )}
                </div>
              </div>

              {/* Table / List */}
              <div className="border border-[#20242a] rounded-[4px] bg-[#0f1114] divide-y divide-[#1c2026] max-h-72 overflow-y-auto">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-[#14171b] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-8 h-8 rounded-xs bg-[#191d22] border border-[#262b32] flex items-center justify-center shrink-0 text-gray-400">
                        {item.mediaType === 'video' ? (
                          <Film className="w-4 h-4 text-[#c5a059]" />
                        ) : (
                          <FileImage className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-gray-200 font-medium truncate" title={item.name}>
                            {item.name}
                          </span>
                          <span className="text-gray-400 font-mono text-[11px] shrink-0">
                            {formatBytes(item.size)}
                          </span>
                        </div>

                        {/* Progress Bar for Uploading / Finalizing */}
                        {(item.status === 'Uploading' || item.status === 'Finalizing') && (
                          <div className="w-full bg-[#1e2329] rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-[#c5a059] h-full transition-all duration-150"
                              style={{ width: `${item.progressPercent}%` }}
                            />
                          </div>
                        )}

                        {item.status === 'Failed' && item.errorMessage && (
                          <p className="text-[11px] text-red-400 truncate" title={item.errorMessage}>
                            {item.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Status & Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {getStatusBadge(item.status, item.errorMessage)}

                      {/* Action buttons */}
                      {item.status === 'Selected' && (
                        <button
                          onClick={() => removeItem(item.id)}
                          className="p-1 text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
                          title="Remove file"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}

                      {item.status === 'Uploading' && (
                        <button
                          onClick={() => cancelItem(item.id)}
                          className="p-1 text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
                          title="Cancel upload"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      )}

                      {(item.status === 'Failed' || item.status === 'Cancelled') && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => retryItem(item.id)}
                            className="p-1 text-[#c5a059] hover:text-[#e0bc75] transition-colors cursor-pointer"
                            title="Retry file"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeItem(item.id)}
                            className="p-1 text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
                            title="Remove file"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {item.status === 'Uploaded' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer with Summary and Action */}
        <div className="p-4 md:p-5 bg-[#0e1013] border-t border-[#20242a] flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-gray-400 flex items-center gap-4">
            {totalCount > 0 && (
              <>
                <div>
                  <span className="text-white font-medium">{uploadedCount}</span> of{' '}
                  <span className="text-white font-medium">{totalCount}</span> uploaded
                </div>
                {failedCount > 0 && (
                  <div className="text-red-400">
                    <span>{failedCount} failed</span>
                  </div>
                )}
                {cancelledCount > 0 && (
                  <div className="text-gray-500">
                    <span>{cancelledCount} cancelled</span>
                  </div>
                )}
                {isProcessing && (
                  <div className="font-mono text-[#c5a059]">
                    {formatBytes(totalBytesUploaded)} / {formatBytes(totalBytes)} ({overallPercent}%)
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {uploadedCount === totalCount && totalCount > 0 ? (
              <Button
                variant="primary"
                onClick={() => {
                  onClose();
                  if (onUploadComplete) onUploadComplete();
                }}
              >
                Done
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Uploading...' : 'Cancel'}
                </Button>
                <Button
                  variant="primary"
                  onClick={startUpload}
                  disabled={
                    isProcessing ||
                    queue.filter((i) => i.status === 'Selected' || i.status === 'Waiting').length === 0
                  }
                  isLoading={isProcessing}
                >
                  {isProcessing
                    ? `Uploading (${inProgressCount} active)...`
                    : `Start Upload (${queue.filter((i) => i.status === 'Selected' || i.status === 'Waiting').length})`}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
