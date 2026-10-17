import React, { useState, useEffect } from 'react';
import {
  Sparkles, Download, Lock, Shield, Clock,
  ArrowRight, AlertCircle, ChevronLeft, ChevronRight, X,
  Check, CheckSquare, Loader2, RefreshCw,
  Heart, CheckCircle2, Send
} from 'lucide-react';
import api from '../api.js';
import FaceSearchModal from './FaceSearchModal.jsx';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function GuestGalleryView({ slug }) {
  const [event, setEvent] = useState(null);
  const [folders, setFolders] = useState([]);
  const [media, setMedia] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Progressive Pagination State
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);

  // PIN Protection State
  const [requiresPin, setRequiresPin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [guestToken, setGuestToken] = useState(() => localStorage.getItem(`guest_token_${slug}`));

  // Modals & Navigation
  const [showFaceSearch, setShowFaceSearch] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  // Phase 21: Multi-Select & Download State
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState(new Set());
  const [downloadingMediaId, setDownloadingMediaId] = useState(null);
  const [activeDownloadJob, setActiveDownloadJob] = useState(null);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [bulkError, setBulkError] = useState(null);

  // Phase 46: Client Photo Selection, Proofing & Favorites State
  const [clientSelection, setClientSelection] = useState(null);
  const [selectionItems, setSelectionItems] = useState({});
  const [selectionFilter, setSelectionFilter] = useState('all'); // 'all', 'favorites', 'selected'
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [clientNameInput, setClientNameInput] = useState('');
  const [clientEmailInput, setClientEmailInput] = useState('');
  const [clientNotesInput, setClientNotesInput] = useState('');
  const [submittingSelection, setSubmittingSelection] = useState(false);
  const [selectionToast, setSelectionToast] = useState(null);

  const showToast = (message, type = 'info') => {
    setSelectionToast({ message, type });
    setTimeout(() => {
      setSelectionToast(null);
    }, 4000);
  };

  const fetchClientSelection = async (token = guestToken) => {
    try {
      const res = await api.getGuestSelection(slug, token);
      if (res?.collection) {
        setClientSelection(res.collection);
        setSelectionItems(res.items || {});
        if (res.collection.client_name) setClientNameInput(res.collection.client_name);
        if (res.collection.client_email) setClientEmailInput(res.collection.client_email);
      }
    } catch (err) {
      console.warn('Selection not initialized or disabled:', err);
    }
  };

  const handleToggleFavorite = async (photoId, e) => {
    if (e) e.stopPropagation();
    const currentItem = selectionItems[photoId] || { isFavorite: false, isSelected: false };
    const nextFavorite = !currentItem.isFavorite;

    // Optimistic update
    setSelectionItems((prev) => ({
      ...prev,
      [photoId]: { ...currentItem, isFavorite: nextFavorite },
    }));
    setClientSelection((prev) => prev ? {
      ...prev,
      favorites_count: Math.max(0, (prev.favorites_count || 0) + (nextFavorite ? 1 : -1)),
    } : prev);

    try {
      const res = await api.updateGuestSelectionItem(slug, {
        photoId,
        isFavorite: nextFavorite,
      }, guestToken);
      if (res?.favoritesCount !== undefined) {
        setClientSelection((prev) => prev ? { ...prev, favorites_count: res.favoritesCount } : prev);
      }
    } catch (err) {
      // Revert optimistic update
      setSelectionItems((prev) => ({
        ...prev,
        [photoId]: currentItem,
      }));
      setClientSelection((prev) => prev ? {
        ...prev,
        favorites_count: Math.max(0, (prev.favorites_count || 0) + (nextFavorite ? -1 : 1)),
      } : prev);
      showToast(err.message || 'Failed to update favorite', 'error');
    }
  };

  const handleTogglePackageSelect = async (photoId, e) => {
    if (e) e.stopPropagation();
    const currentItem = selectionItems[photoId] || { isFavorite: false, isSelected: false };
    const nextSelected = !currentItem.isSelected;

    // Check status lock
    if (clientSelection && (clientSelection.status === 'locked' || clientSelection.status === 'completed')) {
      showToast('This selection is locked and cannot be edited.', 'error');
      return;
    }
    if (clientSelection && clientSelection.status === 'approved' && !event?.selection_allow_changes_after_submission) {
      showToast('Your selection has already been approved and finalized.', 'error');
      return;
    }
    if (clientSelection && clientSelection.status === 'submitted' && !event?.selection_allow_changes_after_submission) {
      showToast('Your selection has already been submitted for review.', 'error');
      return;
    }

    // Client-side quota guard
    if (nextSelected && clientSelection && clientSelection.quota > 0 && !clientSelection.allow_extra) {
      if ((clientSelection.selected_count || 0) >= clientSelection.quota) {
        showToast(`Your package allows ${clientSelection.quota} selected photos. Limit reached.`, 'warning');
        return;
      }
    }

    // Optimistic update
    setSelectionItems((prev) => ({
      ...prev,
      [photoId]: { ...currentItem, isSelected: nextSelected },
    }));
    setClientSelection((prev) => prev ? {
      ...prev,
      selected_count: Math.max(0, (prev.selected_count || 0) + (nextSelected ? 1 : -1)),
    } : prev);

    try {
      const res = await api.updateGuestSelectionItem(slug, {
        photoId,
        isSelected: nextSelected,
      }, guestToken);
      if (res?.selectedCount !== undefined) {
        setClientSelection((prev) => prev ? { ...prev, selected_count: res.selectedCount } : prev);
      }
    } catch (err) {
      // Revert optimistic update
      setSelectionItems((prev) => ({
        ...prev,
        [photoId]: currentItem,
      }));
      setClientSelection((prev) => prev ? {
        ...prev,
        selected_count: Math.max(0, (prev.selected_count || 0) + (nextSelected ? -1 : 1)),
      } : prev);
      showToast(err.message || 'Failed to update selection', 'error');
    }
  };

  const handleSubmitSelection = async (e) => {
    e.preventDefault();
    if (!clientSelection) return;

    if (clientSelection.min_quota > 0 && (clientSelection.selected_count || 0) < clientSelection.min_quota) {
      showToast(`Your package requires a minimum of ${clientSelection.min_quota} photos.`, 'error');
      return;
    }

    if ((clientSelection.selected_count || 0) === 0) {
      showToast('Please select at least 1 photo before submitting.', 'error');
      return;
    }

    try {
      setSubmittingSelection(true);
      const res = await api.submitGuestSelection(slug, {
        clientName: clientNameInput,
        clientEmail: clientEmailInput,
        notes: clientNotesInput,
      }, guestToken);

      setClientSelection(res.selection);
      setShowReviewModal(false);
      showToast('Your selection has been submitted to your photographer for review!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to submit selection.', 'error');
    } finally {
      setSubmittingSelection(false);
    }
  };

  // 1. Fetch Event Info
  const fetchEventInfo = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getGuestEvent(slug);
      setEvent(res.event);

      if (res.event.pin_protected && !guestToken) {
        setRequiresPin(true);
        setLoading(false);
        return;
      }

      if (res.event.client_selection_mode && res.event.client_selection_mode !== 'disabled') {
        fetchClientSelection(guestToken);
      }

      await loadGalleryMedia(res.event, guestToken, false, null, 1);
    } catch (err) {
      if (err.status === 401 || err.data?.requiresPin) {
        setRequiresPin(true);
      } else if (err.status === 410) {
        setError('The public viewing window for this gallery has expired.');
      } else if (err.status === 403) {
        setError('This gallery is currently set to private by the photographer.');
      } else {
        setError(err.message || 'Gallery not found.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 2. Fetch Media & Folders (Supports Progressive Keyset & Page Pagination)
  const loadGalleryMedia = async (ev, token, isAppend = false, cursorOverride = null, targetPage = 1) => {
    try {
      if (isAppend) {
        setLoadingMore(true);
      }
      const data = await api.getGuestGallery(slug, {
        folderId: activeFolderId,
        page: targetPage,
        limit: 50,
        cursor: cursorOverride,
        guestToken: token,
      });

      setFolders(data.folders || []);
      setTotalCount(data.totalCount || (data.media ? data.media.length : 0));
      setHasMore(Boolean(data.hasMore));
      setNextCursor(data.nextCursor || null);
      setPage(targetPage);

      if (isAppend) {
        setMedia((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newItems = (data.media || []).filter((m) => !existingIds.has(m.id));
          return [...prev, ...newItems];
        });
      } else {
        setMedia(data.media || []);
      }
      setRequiresPin(false);
    } catch (err) {
      if (err.status === 401 || err.data?.requiresPin) {
        setRequiresPin(true);
      } else if (err.status === 410) {
        setError('The public viewing window for this gallery has expired.');
      } else if (err.status === 403) {
        setError('This gallery is currently set to private.');
      } else {
        setError(err.message || 'Failed to load gallery');
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    loadGalleryMedia(event, guestToken, true, nextCursor, page + 1);
  };

  // Reset selection and gallery when slug changes
  // Reset selection and fetch event info when slug changes
useEffect(() => {
  setSelectedMediaIds(new Set());
  setSelectionMode(false);
  setActiveDownloadJob(null);
  setDownloadModalOpen(false);
  fetchEventInfo();
}, [slug]);

  useEffect(() => {
  if (event && !requiresPin) {
    loadGalleryMedia(event, guestToken, false, null, 1);
  }
}, [event, requiresPin, guestToken, activeFolderId]);

  // Phase 21: Bulk ZIP status polling
  useEffect(() => {
    if (!activeDownloadJob || !downloadModalOpen) return;
    if (activeDownloadJob.status === 'completed' || activeDownloadJob.status === 'failed') return;

    let isSubscribed = true;
    const pollInterval = setInterval(async () => {
      try {
        const updated = await api.getDownloadJobStatus(slug, activeDownloadJob.jobId, guestToken);
        if (!isSubscribed) return;
        setActiveDownloadJob(updated);

        if (updated.status === 'completed') {
          clearInterval(pollInterval);
          // Auto-trigger browser download
          if (updated.downloadUrl) {
            const a = document.createElement('a');
            a.href = updated.downloadUrl;
            a.download = `${event?.name || 'gallery'}_photos.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
        } else if (updated.status === 'failed') {
          clearInterval(pollInterval);
        }
      } catch (err) {
        if (!isSubscribed) return;
        setBulkError(err.message || 'Failed to poll download status');
        clearInterval(pollInterval);
      }
    }, 1500);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
    };
  }, [activeDownloadJob?.jobId, activeDownloadJob?.status, downloadModalOpen, slug, guestToken, event?.name]);

  // Handle PIN submission
  const handleVerifyPin = async (e) => {
    e.preventDefault();
    if (!pinInput.trim()) return;
    setPinError('');
    setVerifyingPin(true);

    try {
      const res = await api.verifyGuestPin(slug, pinInput.trim());
      if (res.guestToken) {
        localStorage.setItem(`guest_token_${slug}`, res.guestToken);
        setGuestToken(res.guestToken);
        setRequiresPin(false);
        await loadGalleryMedia(event, res.guestToken);
      }
    } catch (err) {
      if (err.status === 410) {
        setRequiresPin(false);
        setError('The public viewing window for this gallery has expired.');
      } else {
        setPinError(err.message || 'Incorrect PIN code');
      }
    } finally {
      setVerifyingPin(false);
    }
  };

  // Phase 21: Selection Management
  const toggleSelectMedia = (id) => {
    setSelectedMediaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 500) {
          alert('Maximum 500 items can be selected for download.');
          return next;
        }
        next.add(id);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    const next = new Set();
    const limit = Math.min(media.length, 500);
    for (let i = 0; i < limit; i++) {
      next.add(media[i].id);
    }
    setSelectedMediaIds(next);
  };

  const clearSelection = () => {
    setSelectedMediaIds(new Set());
  };

  // Phase 21: Individual Media Download
  const handleIndividualDownload = async (item, representation = 'original') => {
    try {
      setDownloadingMediaId(item.id);
      await api.downloadIndividualMedia(slug, item.id, representation, guestToken);
    } catch (err) {
      alert(err.message || 'Failed to download file');
    } finally {
      setDownloadingMediaId(null);
    }
  };

  // Phase 21: Bulk ZIP Download Request
  const startBulkDownload = async (mediaIds = null) => {
    try {
      setBulkError(null);
      setDownloadModalOpen(true);
      setActiveDownloadJob({
        jobId: null,
        status: 'pending',
        progress: 0,
        requestedCount: mediaIds ? mediaIds.length : (event?.photo_count || media.length),
        processedCount: 0,
      });

      const res = await api.requestBulkDownloadZip(slug, mediaIds, guestToken);
      setActiveDownloadJob(res);
    } catch (err) {
      setBulkError(err.message || 'Failed to start bulk download');
      setActiveDownloadJob(null);
    }
  };

  // Lightbox navigation
  const openLightbox = (index) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);
  const nextPhoto = () => {
    if (lightboxIndex !== null && lightboxIndex < media.length - 1) {
      setLightboxIndex(lightboxIndex + 1);
    }
  };
  const prevPhoto = () => {
    if (lightboxIndex !== null && lightboxIndex > 0) {
      setLightboxIndex(lightboxIndex - 1);
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-muted)',
      }}>
        Loading gallery...
      </div>
    );
  }

  // Error / Expired / Private Screen
  if (error) {
    const isExpired = error.toLowerCase().includes('expired');
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        padding: '24px',
      }}>
        <div
          className="glass-panel-strong"
          style={{
            maxWidth: 460,
            width: '100%',
            borderRadius: 'var(--radius-lg)',
            padding: '44px 36px',
            textAlign: 'center',
            boxShadow: 'var(--glass-shadow-lg)',
            backgroundColor: 'var(--glass-strong)',
            border: isExpired ? '1px solid rgba(194, 65, 62, 0.28)' : '1px solid var(--glass-border)',
          }}
        >
          <div style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            backgroundColor: isExpired ? 'rgba(194, 65, 62, 0.10)' : 'var(--accent-subtle)',
            border: isExpired ? '1px solid var(--status-error)' : '1px solid var(--accent-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isExpired ? 'var(--status-error)' : 'var(--accent-primary)',
            margin: '0 auto 20px',
          }}>
            {isExpired ? <Clock size={24} /> : <Lock size={24} />}
          </div>

          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {isExpired ? 'Gallery Expired' : 'Private Gallery'}
          </h2>

          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 10, lineHeight: 1.55 }}>
            {error}
          </p>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 28 }}>
            If you need access to this event, please contact the photographer directly.
          </p>
        </div>
      </div>
    );
  }

  // PIN Protection Screen
  if (requiresPin) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        padding: '24px',
      }}>
        <div
          className="glass-panel-strong"
          style={{
            maxWidth: 420,
            width: '100%',
            borderRadius: 'var(--radius-lg)',
            padding: '40px 32px',
            textAlign: 'center',
            boxShadow: 'var(--glass-shadow-lg)',
            backgroundColor: 'var(--glass-strong)',
            border: '1px solid var(--glass-border)',
          }}
        >
          <div style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            backgroundColor: 'var(--accent-subtle)',
            border: '1px solid var(--accent-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-primary)',
            margin: '0 auto 20px',
          }}>
            <Shield size={24} />
          </div>

          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Protected Gallery
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 6, marginBottom: 28 }}>
            Please enter the client PIN to access <strong style={{ color: 'var(--text-primary)' }}>{event?.name}</strong>.
          </p>

          <form onSubmit={handleVerifyPin}>
            {pinError && (
              <div style={{
                backgroundColor: 'rgba(194, 65, 62, 0.10)',
                border: '1px solid var(--status-error)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--status-error)',
                fontSize: '0.84rem',
                marginBottom: 18,
              }}>
                {pinError}
              </div>
            )}

            <input
              type="password"
              className="form-input"
              placeholder="Enter PIN..."
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              style={{
                textAlign: 'center',
                fontSize: '1.4rem',
                letterSpacing: '0.35em',
                marginBottom: 20,
                height: 50,
              }}
              autoFocus
              maxLength={10}
            />

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', height: 44, fontSize: '0.92rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              disabled={verifyingPin}
            >
              <span>{verifyingPin ? 'Verifying...' : 'Unlock Gallery'}</span>
              <ArrowRight size={16} />
            </button>
          </form>

          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 26 }}>
            Photographed by {event?.business_name || 'Studio Lumina'}
          </div>
        </div>
      </div>
    );
  }

  const currentPhoto = lightboxIndex !== null ? media[lightboxIndex] : null;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      {/* Editorial Hero Header with Atmospheric Photographic Glow */}
      <div className="guest-hero-container">
        {/* Subtle Ambient Vignette */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse 65% 55% at 50% 20%, rgba(167, 139, 250, 0.05) 0%, rgba(125, 211, 252, 0.04) 50%, transparent 80%)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ maxWidth: 880, margin: '0 auto', position: 'relative', zIndex: 2 }}>
          <div style={{
            fontSize: '0.76rem',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--accent-text)',
            fontWeight: 600,
            marginBottom: 14,
          }}>
            {event?.business_name || 'Studio Lumina'} • Fine Art Gallery
          </div>

          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(2.4rem, 5.5vw, 4rem)',
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: '-0.015em',
            color: 'var(--text-primary)',
          }}>
            {event?.name}
          </h1>

          <p style={{
            fontSize: '0.96rem',
            color: 'var(--text-secondary)',
            marginTop: 12,
          }}>
            Celebration of {event?.client_name} {event?.location ? `• ${event.location}` : ''} • {event?.event_date}
          </p>

          {/* Core Action: Find My Photos */}
          {Boolean(event?.face_search_enabled) && (
            <div style={{ marginTop: 32 }}>
              <button
                className="btn btn-primary"
                onClick={() => setShowFaceSearch(true)}
                style={{
                  padding: '13px 32px',
                  fontSize: '0.94rem',
                  borderRadius: 'var(--radius-pill)',
                  boxShadow: '0 4px 16px rgba(167, 139, 250, 0.25)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Sparkles size={18} />
                <span>Find My Photos (Take Selfie)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Gallery Workspace */}
      <div className="guest-workspace-container">
        {/* Gallery Controls & Folder Navigation */}
        <div className="guest-controls-bar">
          {/* Folders */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', maxWidth: '100%' }}>
            <button
              onClick={() => setActiveFolderId(null)}
              style={{
                padding: '7px 18px',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.84rem',
                fontWeight: activeFolderId === null ? 600 : 500,
                cursor: 'pointer',
                border: activeFolderId === null ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                backgroundColor: activeFolderId === null ? '#FFFFFF' : 'rgba(255, 255, 255, 0.65)',
                color: activeFolderId === null ? 'var(--accent-text)' : 'var(--text-secondary)',
                boxShadow: activeFolderId === null ? '0 1px 4px rgba(50, 45, 38, 0.06)' : 'none',
                whiteSpace: 'nowrap',
                transition: 'all var(--transition-fast)',
              }}
            >
              All Photos ({event?.photo_count || media.length})
            </button>

            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setActiveFolderId(f.id);
                  setSelectionFilter('all');
                }}
                style={{
                  padding: '7px 18px',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: '0.84rem',
                  fontWeight: activeFolderId === f.id && selectionFilter === 'all' ? 600 : 500,
                  cursor: 'pointer',
                  border: activeFolderId === f.id && selectionFilter === 'all' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  backgroundColor: activeFolderId === f.id && selectionFilter === 'all' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.65)',
                  color: activeFolderId === f.id && selectionFilter === 'all' ? 'var(--accent-text)' : 'var(--text-secondary)',
                  boxShadow: activeFolderId === f.id && selectionFilter === 'all' ? '0 1px 4px rgba(50, 45, 38, 0.06)' : 'none',
                  whiteSpace: 'nowrap',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {f.name} ({f.photo_count || 0})
              </button>
            ))}

            {/* Proofing Filter Tabs */}
            {event?.client_selection_mode && event.client_selection_mode !== 'disabled' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionFilter(selectionFilter === 'favorites' ? 'all' : 'favorites');
                    setActiveFolderId(null);
                  }}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: '0.84rem',
                    fontWeight: selectionFilter === 'favorites' ? 600 : 500,
                    cursor: 'pointer',
                    border: selectionFilter === 'favorites' ? '1px solid #e63946' : '1px solid var(--border-subtle)',
                    backgroundColor: selectionFilter === 'favorites' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.65)',
                    color: selectionFilter === 'favorites' ? '#e63946' : 'var(--text-secondary)',
                    boxShadow: selectionFilter === 'favorites' ? '0 1px 4px rgba(230, 57, 70, 0.12)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <Heart size={14} fill={selectionFilter === 'favorites' ? '#e63946' : 'none'} color="#e63946" />
                  <span>Favorites ({clientSelection?.favorites_count || 0})</span>
                </button>

                {(event.client_selection_mode === 'selection_required' || event.client_selection_mode === 'package_quota') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionFilter(selectionFilter === 'selected' ? 'all' : 'selected');
                      setActiveFolderId(null);
                    }}
                    style={{
                      padding: '7px 16px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: '0.84rem',
                      fontWeight: selectionFilter === 'selected' ? 600 : 500,
                      cursor: 'pointer',
                      border: selectionFilter === 'selected' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                      backgroundColor: selectionFilter === 'selected' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.65)',
                      color: selectionFilter === 'selected' ? 'var(--accent-text)' : 'var(--text-secondary)',
                      boxShadow: selectionFilter === 'selected' ? '0 1px 4px rgba(50, 45, 38, 0.06)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    <CheckCircle2 size={14} />
                    <span>Selected for Package ({clientSelection?.selected_count || 0}{clientSelection?.quota > 0 ? ` / ${clientSelection.quota}` : ''})</span>
                  </button>
                )}
              </>
            )}
          </div>

          {/* Phase 21 & Phase 24: Download & Multi-Select Actions */}
          {Boolean(event?.allow_downloads) && event?.allow_bulk_downloads !== false && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className={selectionMode ? 'btn btn-primary' : 'btn btn-secondary'}
                onClick={() => {
                  setSelectionMode(!selectionMode);
                  if (selectionMode) clearSelection();
                }}
                style={{ fontSize: '0.84rem', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}
                aria-pressed={selectionMode}
              >
                <CheckSquare size={14} />
                <span>{selectionMode ? 'Exit Selection' : 'Select Photos'}</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => startBulkDownload()}
                style={{ fontSize: '0.84rem', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}
                title="Download entire gallery as a high-resolution ZIP archive"
              >
                <Download size={14} />
                <span>Download All (ZIP)</span>
              </button>
            </div>
          )}
        </div>

        {/* Photography Grid */}
        {loading && media.length === 0 ? (
          <div className="photo-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="photo-card"
                style={{
                  aspectRatio: '3 / 2',
                  backgroundColor: '#EAE7E0',
                  borderRadius: 6,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                    animation: 'pulse 1.8s infinite',
                  }}
                />
              </div>
            ))}
          </div>
        ) : media.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
            No photos available in this section.
          </div>
        ) : (
          <>
            <div className="photo-grid">
              {media
                .filter((item) => {
                  if (selectionFilter === 'favorites') return Boolean(selectionItems[item.id]?.isFavorite);
                  if (selectionFilter === 'selected') return Boolean(selectionItems[item.id]?.isSelected);
                  return true;
                })
                .map((item, idx) => {
                const thumbUrl = `/api/media/stream?key=${encodeURIComponent(item.storage_key_thumbnail || item.storage_key_preview)}`;
                const isSelected = selectedMediaIds.has(item.id);
                const isFavorited = Boolean(selectionItems[item.id]?.isFavorite);
                const isPackageSelected = Boolean(selectionItems[item.id]?.isSelected);
                const isSelectionActive = event?.client_selection_mode && event.client_selection_mode !== 'disabled';

                return (
                  <div
                    key={item.id}
                    className={`photo-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      if (selectionMode) {
                        toggleSelectMedia(item.id);
                      } else {
                        openLightbox(idx);
                      }
                    }}
                    style={{
                      position: 'relative',
                      outline: isSelected ? '2px solid var(--accent-primary)' : 'none',
                      outlineOffset: '-2px',
                      cursor: 'pointer',
                      aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : '3 / 2',
                      backgroundColor: '#EAE7E0',
                      overflow: 'hidden',
                      boxShadow: isSelected ? '0 4px 16px rgba(167, 139, 250, 0.25)' : 'none',
                    }}
                  >
                    {/* Phase 46: Favorite Button (Top Right) */}
                    {isSelectionActive && (
                      <button
                        type="button"
                        aria-label="Toggle Favorite"
                        onClick={(e) => handleToggleFavorite(item.id, e)}
                        style={{
                          position: 'absolute',
                          top: 10,
                          right: 10,
                          zIndex: 4,
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isFavorited ? 'rgba(255, 255, 255, 0.95)' : 'rgba(20, 23, 27, 0.55)',
                          border: isFavorited ? '1px solid rgba(230, 57, 70, 0.4)' : '1px solid rgba(255, 255, 255, 0.25)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          backdropFilter: 'blur(4px)',
                        }}
                        title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Heart
                          size={16}
                          fill={isFavorited ? '#e63946' : 'none'}
                          color={isFavorited ? '#e63946' : '#ffffff'}
                        />
                      </button>
                    )}

                    {/* Phase 46: Package Selection Button (Top Left) */}
                    {isSelectionActive && (event.client_selection_mode === 'selection_required' || event.client_selection_mode === 'package_quota') && (
                      <button
                        type="button"
                        aria-label="Select for Package"
                        onClick={(e) => handleTogglePackageSelect(item.id, e)}
                        style={{
                          position: 'absolute',
                          top: 10,
                          left: 10,
                          zIndex: 4,
                          height: 28,
                          padding: '0 10px',
                          borderRadius: 'var(--radius-pill)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          backgroundColor: isPackageSelected ? 'var(--accent-primary)' : 'rgba(20, 23, 27, 0.55)',
                          border: isPackageSelected ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.25)',
                          color: isPackageSelected ? '#FFFFFF' : '#ffffff',
                          cursor: 'pointer',
                          fontSize: '0.74rem',
                          fontWeight: 600,
                          backdropFilter: 'blur(4px)',
                          boxShadow: isPackageSelected ? '0 2px 8px rgba(167, 139, 250, 0.3)' : 'none',
                        }}
                        title={isPackageSelected ? 'Remove from package selection' : 'Select for album package'}
                      >
                        <Check size={14} strokeWidth={isPackageSelected ? 3 : 2} />
                        <span>{isPackageSelected ? 'Selected' : 'Select'}</span>
                      </button>
                    )}

                    {/* Selection Checkbox (Visible in bulk ZIP selectionMode) */}
                    {Boolean(event?.allow_downloads) && selectionMode && (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={`Select ${item.original_name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectMedia(item.id);
                        }}
                        style={{
                          position: 'absolute',
                          bottom: 10,
                          left: 10,
                          zIndex: 3,
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isSelected ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.92)',
                          border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-medium)',
                          color: isSelected ? '#FFFFFF' : 'var(--text-primary)',
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                        }}
                      >
                        {isSelected && <Check size={16} strokeWidth={3} />}
                      </button>
                    )}

                    <img
                      src={thumbUrl}
                      alt={item.original_name}
                      loading="lazy"
                      decoding="async"
                      width={item.width || undefined}
                      height={item.height || undefined}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                    <div className="photo-overlay">
                      <span style={{ fontSize: '0.75rem', color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {item.original_name}
                      </span>
                      {Boolean(event?.allow_downloads) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleIndividualDownload(item, 'original');
                          }}
                          className="btn btn-ghost"
                          style={{ padding: 4, color: '#fff' }}
                          title="Download High-Res Original"
                          disabled={downloadingMediaId === item.id}
                        >
                          {downloadingMediaId === item.id ? (
                            <Loader2 size={15} className="spin" />
                          ) : (
                            <Download size={15} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Progressive Pagination Controls */}
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 40, marginBottom: 20 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  style={{
                    padding: '12px 28px',
                    fontSize: '0.88rem',
                    gap: 10,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      <span>Loading Photographs...</span>
                    </>
                  ) : (
                    <>
                      <span>Load More Photos</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        ({media.length} of {totalCount})
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Phase 21: Floating Multi-Select Action Bar */}
      {Boolean(event?.allow_downloads) && selectedMediaIds.size > 0 && (
        <div className="glass-panel-strong floating-action-bar">
          <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {selectedMediaIds.size} {selectedMediaIds.size === 1 ? 'photo' : 'photos'} selected
          </span>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => startBulkDownload(Array.from(selectedMediaIds))}
            style={{ fontSize: '0.85rem', padding: '8px 20px', borderRadius: 'var(--radius-pill)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={14} />
            <span>Download Selected (ZIP)</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={selectAllVisible}
            style={{ fontSize: '0.82rem', padding: '6px 12px' }}
          >
            Select All Visible
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={clearSelection}
            style={{ fontSize: '0.82rem', padding: '6px 12px', color: 'var(--text-muted)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Lightbox Modal */}
      {currentPhoto && (
        <div className="lightbox-backdrop" onClick={closeLightbox}>
          <div className="lightbox-header" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {lightboxIndex + 1} / {media.length}
              </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                {currentPhoto.original_name}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Phase 46: Lightbox Favorite & Selection Controls */}
              {event?.client_selection_mode && event.client_selection_mode !== 'disabled' && currentPhoto && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={(e) => handleToggleFavorite(currentPhoto.id, e)}
                    style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}
                    title={selectionItems[currentPhoto.id]?.isFavorite ? 'Favorited' : 'Add to Favorites'}
                  >
                    <Heart
                      size={15}
                      fill={selectionItems[currentPhoto.id]?.isFavorite ? '#e63946' : 'none'}
                      color={selectionItems[currentPhoto.id]?.isFavorite ? '#e63946' : 'currentColor'}
                    />
                    <span>{selectionItems[currentPhoto.id]?.isFavorite ? 'Favorited' : 'Favorite'}</span>
                  </button>

                  {(event.client_selection_mode === 'selection_required' || event.client_selection_mode === 'package_quota') && (
                    <button
                      type="button"
                      className={selectionItems[currentPhoto.id]?.isSelected ? 'btn btn-primary' : 'btn btn-secondary'}
                      onClick={(e) => handleTogglePackageSelect(currentPhoto.id, e)}
                      style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <Check size={15} />
                      <span>{selectionItems[currentPhoto.id]?.isSelected ? 'Selected in Package' : 'Select for Package'}</span>
                    </button>
                  )}
                </>
              )}

              {Boolean(event?.allow_downloads) && (currentPhoto?.type === 'video' ? event?.allow_video_downloads !== false : event?.allow_photo_downloads !== false) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.82rem' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleIndividualDownload(currentPhoto, 'original');
                  }}
                  disabled={downloadingMediaId === currentPhoto.id}
                >
                  {downloadingMediaId === currentPhoto.id ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  <span>Download High-Res Original</span>
                </button>
              )}
              <button className="btn btn-ghost" onClick={closeLightbox} style={{ padding: 6 }}>
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            {lightboxIndex > 0 && (
              <button
                onClick={prevPhoto}
                style={{
                  position: 'absolute',
                  left: 24,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(20, 23, 27, 0.75)',
                  border: '1px solid var(--border-medium)',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 10,
                }}
              >
                <ChevronLeft size={24} />
              </button>
            )}

            <img
              src={`/api/media/stream?key=${encodeURIComponent(currentPhoto.storage_key_preview || currentPhoto.storage_key_thumbnail)}`}
              alt={currentPhoto.original_name}
              className="lightbox-image"
            />

            {lightboxIndex < media.length - 1 && (
              <button
                onClick={nextPhoto}
                style={{
                  position: 'absolute',
                  right: 24,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(20, 23, 27, 0.75)',
                  border: '1px solid var(--border-medium)',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 10,
                }}
              >
                <ChevronRight size={24} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Phase 21: Bulk ZIP Download Progress Modal */}
      {downloadModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(37, 37, 37, 0.45)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 24,
        }}>
          <div
            className="glass-panel-strong"
            style={{
              maxWidth: 480,
              width: '100%',
              borderRadius: 'var(--radius-lg)',
              padding: '40px 32px',
              textAlign: 'center',
              boxShadow: 'var(--glass-shadow-lg)',
              position: 'relative',
              backgroundColor: 'var(--glass-strong)',
              border: '1px solid var(--glass-border)',
            }}
          >
            <button
              type="button"
              onClick={() => setDownloadModalOpen(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
              title="Close dialog"
            >
              <X size={20} />
            </button>

            <div style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              backgroundColor: activeDownloadJob?.status === 'completed'
                ? 'rgba(42, 157, 143, 0.12)'
                : activeDownloadJob?.status === 'failed'
                  ? 'rgba(194, 65, 62, 0.12)'
                  : 'var(--accent-subtle)',
              border: activeDownloadJob?.status === 'completed'
                ? '1px solid var(--status-success)'
                : activeDownloadJob?.status === 'failed'
                  ? '1px solid var(--status-error)'
                  : '1px solid var(--accent-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: activeDownloadJob?.status === 'completed'
                ? 'var(--status-success)'
                : activeDownloadJob?.status === 'failed'
                  ? 'var(--status-error)'
                  : 'var(--accent-primary)',
              margin: '0 auto 16px',
            }}>
              {activeDownloadJob?.status === 'completed' ? (
                <Check size={26} strokeWidth={2.5} />
              ) : activeDownloadJob?.status === 'failed' ? (
                <AlertCircle size={26} />
              ) : (
                <Download size={24} />
              )}
            </div>

            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 600 }}>
              {activeDownloadJob?.status === 'completed'
                ? 'Archive Ready'
                : activeDownloadJob?.status === 'failed'
                  ? 'Download Failed'
                  : 'Packaging ZIP Archive'}
            </h3>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 8, marginBottom: 24 }}>
              {bulkError ? (
                bulkError
              ) : activeDownloadJob?.status === 'completed' ? (
                `Your ZIP archive containing ${activeDownloadJob.requestedCount} high-resolution photos is ready. Your download should start automatically.`
              ) : activeDownloadJob?.status === 'failed' ? (
                activeDownloadJob.error || 'An error occurred during ZIP creation.'
              ) : activeDownloadJob?.status === 'processing' ? (
                `Streaming original files from storage (${activeDownloadJob.processedCount || 0} of ${activeDownloadJob.requestedCount} items)...`
              ) : (
                `Job queued. Preparing ${activeDownloadJob?.requestedCount || 0} photos...`
              )}
            </p>

            {/* Real Progress Bar */}
            {(!activeDownloadJob || activeDownloadJob.status === 'pending' || activeDownloadJob.status === 'processing') && (
              <div style={{ marginBottom: 24 }}>
                <div style={{
                  width: '100%',
                  height: 6,
                  backgroundColor: 'var(--surface-input)',
                  borderRadius: 9999,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${Math.max(5, activeDownloadJob?.progress || 0)}%`,
                    height: '100%',
                    backgroundColor: 'var(--accent-primary)',
                    transition: 'width 0.4s ease-in-out',
                  }} />
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 8 }}>
                  {activeDownloadJob?.progress || 0}% Complete
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              {activeDownloadJob?.status === 'completed' && activeDownloadJob.downloadUrl && (
                <a
                  href={activeDownloadJob.downloadUrl}
                  download={`${event?.name || 'gallery'}_photos.zip`}
                  className="btn btn-primary"
                  style={{ padding: '10px 24px', fontSize: '0.9rem', borderRadius: 'var(--radius-pill)' }}
                >
                  <Download size={16} />
                  <span>Download ZIP ({formatBytes(activeDownloadJob.fileSize)})</span>
                </a>
              )}

              {activeDownloadJob?.status === 'failed' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => startBulkDownload(selectedMediaIds.size > 0 ? Array.from(selectedMediaIds) : null)}
                  style={{ padding: '10px 24px', fontSize: '0.9rem' }}
                >
                  <RefreshCw size={16} />
                  <span>Try Again</span>
                </button>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDownloadModalOpen(false)}
                style={{ padding: '10px 20px', fontSize: '0.9rem' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Face Search Modal */}
      {showFaceSearch && (
        <FaceSearchModal
          eventSlug={slug}
          guestToken={guestToken}
          allowDownloads={Boolean(event?.allow_downloads)}
          onClose={() => setShowFaceSearch(false)}
          onSelectPhoto={(photo) => {
            const foundIdx = media.findIndex((m) => m.id === photo.id);
            if (foundIdx !== -1) {
              setLightboxIndex(foundIdx);
              setShowFaceSearch(false);
            }
          }}
        />
      )}

      {/* Phase 46: Floating Proofing & Quota Bar */}
      {event?.client_selection_mode && event.client_selection_mode !== 'disabled' && clientSelection && (
        <div
          className="glass-panel-strong"
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 900,
            width: 'calc(100% - 32px)',
            maxWidth: 860,
            borderRadius: 'var(--radius-lg)',
            padding: '12px 20px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.16)',
            border: '1px solid var(--glass-border)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          {/* Quota & Count Information */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {clientSelection.package_name || 'Full Collection'}
                </span>
                {clientSelection.status === 'submitted' && (
                  <span className="badge" style={{ backgroundColor: 'rgba(217, 119, 6, 0.15)', color: '#d97706', fontSize: '0.72rem' }}>
                    Under Review
                  </span>
                )}
                {clientSelection.status === 'approved' && (
                  <span className="badge" style={{ backgroundColor: 'rgba(42, 157, 143, 0.15)', color: 'var(--status-success)', fontSize: '0.72rem' }}>
                    Approved
                  </span>
                )}
                {clientSelection.status === 'changes_requested' && (
                  <span className="badge" style={{ backgroundColor: 'rgba(230, 57, 70, 0.15)', color: 'var(--status-error)', fontSize: '0.72rem' }}>
                    Feedback Received
                  </span>
                )}
              </div>

              {(event.client_selection_mode === 'selection_required' || event.client_selection_mode === 'package_quota') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <span style={{
                    fontSize: '0.78rem',
                    color: clientSelection.quota > 0 && clientSelection.selected_count >= clientSelection.quota ? 'var(--accent-text)' : 'var(--text-secondary)',
                    fontWeight: 600,
                  }}>
                    Selected: {clientSelection.selected_count || 0} {clientSelection.quota > 0 ? `/ ${clientSelection.quota}` : 'photos'}
                  </span>
                  {clientSelection.quota > 0 && (
                    <div style={{ width: 100, height: 5, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 99, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, ((clientSelection.selected_count || 0) / clientSelection.quota) * 100)}%`,
                          height: '100%',
                          backgroundColor: (clientSelection.selected_count || 0) >= clientSelection.quota ? 'var(--status-success)' : ((clientSelection.selected_count || 0) / clientSelection.quota >= 0.9 ? 'var(--accent-primary)' : 'var(--accent-primary)'),
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  )}
                  {clientSelection.quota > 0 && clientSelection.selected_count >= clientSelection.quota && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--accent-text)', fontWeight: 600 }}>Limit Reached</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Action Trigger */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {clientSelection.status === 'changes_requested' && clientSelection.photographer_feedback && (
              <span style={{ fontSize: '0.76rem', color: 'var(--status-error)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={clientSelection.photographer_feedback}>
                Note: {clientSelection.photographer_feedback}
              </span>
            )}

            {(event.client_selection_mode === 'selection_required' || event.client_selection_mode === 'package_quota') && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowReviewModal(true)}
                style={{
                  padding: '9px 18px',
                  fontSize: '0.84rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: 'var(--radius-pill)',
                  boxShadow: '0 2px 10px rgba(167, 139, 250, 0.25)',
                }}
              >
                <CheckCircle2 size={15} />
                <span>
                  {clientSelection.status === 'changes_requested'
                    ? 'Review & Resubmit'
                    : clientSelection.status === 'submitted'
                      ? 'View Submitted'
                      : 'Review & Submit'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Review & Submit Modal */}
      {showReviewModal && (
        <div className="modal-backdrop" onClick={() => setShowReviewModal(false)}>
          <div
            className="modal-container glass-panel-strong"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 580,
              padding: 28,
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'var(--surface-card)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Review Your Final Selection
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                  Package: <strong style={{ color: 'var(--text-primary)' }}>{clientSelection?.package_name || 'Full Collection'}</strong>
                </p>
              </div>
              <button className="btn btn-ghost" onClick={() => setShowReviewModal(false)} style={{ padding: 6 }}>
                <X size={18} />
              </button>
            </div>

            {/* Quota Summary Box */}
            <div style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 18,
            }}>
              <div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Selected Photos</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent-text)' }}>
                  {clientSelection?.selected_count || 0} {clientSelection?.quota > 0 ? `/ ${clientSelection.quota}` : ''}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Required Minimum</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {clientSelection?.min_quota > 0 ? `${clientSelection.min_quota} photos` : 'None'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Selection Status</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, textTransform: 'capitalize' }}>
                  {clientSelection?.status || 'Draft'}
                </div>
              </div>
            </div>

            {/* Photographer's Instructions if any */}
            {event?.selection_instructions && (
              <div style={{
                backgroundColor: 'var(--accent-subtle)',
                border: '1px solid var(--accent-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                marginBottom: 18,
              }}>
                <strong style={{ color: 'var(--accent-text)' }}>Photographer's Instructions: </strong>
                {event.selection_instructions}
              </div>
            )}

            {clientSelection?.photographer_feedback && (
              <div style={{
                backgroundColor: 'rgba(230, 57, 70, 0.08)',
                border: '1px solid rgba(230, 57, 70, 0.25)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                fontSize: '0.8rem',
                color: 'var(--status-error)',
                marginBottom: 18,
              }}>
                <strong>Revision Request: </strong>
                {clientSelection.photographer_feedback}
              </div>
            )}

            <form onSubmit={handleSubmitSelection} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Your Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={clientNameInput}
                    onChange={(e) => setClientNameInput(e.target.value)}
                    placeholder="e.g. Elena Rostova"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Your Email</label>
                  <input
                    type="email"
                    className="form-input"
                    value={clientEmailInput}
                    onChange={(e) => setClientEmailInput(e.target.value)}
                    placeholder="e.g. elena@example.com"
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Notes for Photographer (Optional)</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={clientNotesInput}
                  onChange={(e) => setClientNotesInput(e.target.value)}
                  placeholder="Any retouching requests, crop preferences, or album cover ideas..."
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowReviewModal(false)}>
                  Continue Browsing
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingSelection || (clientSelection?.selected_count || 0) === 0}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Send size={14} />
                  <span>{submittingSelection ? 'Submitting...' : 'Submit Final Selection'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {selectionToast && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 1200,
            padding: '12px 18px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: selectionToast.type === 'error' ? 'var(--status-error)' : (selectionToast.type === 'warning' ? '#d97706' : '#2A9D8F'),
            color: '#FFFFFF',
            fontSize: '0.85rem',
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <span>{selectionToast.message}</span>
          <button
            onClick={() => setSelectionToast(null)}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 2 }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

