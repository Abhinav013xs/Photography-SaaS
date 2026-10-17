import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, UploadCloud, FolderPlus, QrCode, Settings,
  Trash2, Download, Image,
  Users, CheckSquare, Square, Folder, RefreshCw,
  Globe
} from 'lucide-react';
import api from '../api.js';
import UploadModal from './UploadModal.jsx';
import QrModal from './QrModal.jsx';
import EventSettingsModal from './EventSettingsModal.jsx';
import EventSelectionsPanel from './EventSelectionsPanel.jsx';

export default function EventDetailView({ eventId, onBack }) {
  const [eventData, setEventData] = useState(null);
  const [folders, setFolders] = useState([]);
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFolderId, setActiveFolderId] = useState(null); // null = all
  const [activeJob, setActiveJob] = useState(null);

  // Visibility toggle state
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [visibilityConfirm, setVisibilityConfirm] = useState(null);

  // Phase 46: Selections View toggle
  const [viewingSelections, setViewingSelections] = useState(false);

  // Selection state
  const [selectedMediaIds, setSelectedMediaIds] = useState([]);
  const [selectMode, setSelectMode] = useState(false);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState('');

  // Lightbox
  const [previewMedia, setPreviewMedia] = useState(null);

  // Event Bin / Deletion
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const fetchEventData = async () => {
    try {
      const data = await api.getEvent(eventId);
      setEventData(data.event);
      setFolders(data.folders || []);
      setActiveJob(data.activeJob);
    } catch (err) {
      console.error('Failed to load event:', err);
    }
  };

  const fetchMedia = async () => {
    try {
      setLoading(true);
      const res = await api.getMedia(eventId, { folderId: activeFolderId });
      setMedia(res.media || []);
    } catch (err) {
      console.error('Failed to load media:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEventData();
  }, [eventId]);

  useEffect(() => {
    fetchMedia();
    setSelectedMediaIds([]);
  }, [eventId, activeFolderId]);

  // Poll active processing job if one is pending/processing
  useEffect(() => {
    if (!activeJob || activeJob.status === 'completed' || activeJob.status === 'failed') return;

    const timer = setInterval(async () => {
      const data = await api.getEvent(eventId);
      setActiveJob(data.activeJob);
      if (!data.activeJob || data.activeJob.status === 'completed') {
        fetchMedia();
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [activeJob, eventId]);

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const res = await api.createFolder(eventId, newFolderName.trim());
      setFolders((prev) => [...prev, res.folder]);
      setNewFolderName('');
      setShowNewFolderModal(false);
    } catch (err) {
      alert(err.message || 'Failed to create folder');
    }
  };

  const handleDeleteFolder = async (folderId) => {
    if (!confirm('Are you sure you want to remove this folder? Photos will safely remain in the gallery.')) return;
    try {
      await api.deleteFolder(eventId, folderId);
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (activeFolderId === folderId) setActiveFolderId(null);
      fetchMedia();
    } catch (err) {
      alert(err.message || 'Failed to delete folder');
    }
  };

  const toggleSelectMedia = (id) => {
    setSelectedMediaIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedMediaIds.length === media.length) {
      setSelectedMediaIds([]);
    } else {
      setSelectedMediaIds(media.map((m) => m.id));
    }
  };

  const handleBatchDelete = async () => {
    if (!confirm(`Permanently delete ${selectedMediaIds.length} media items and their derivatives?`)) return;
    try {
      await api.deleteMediaBatch(selectedMediaIds);
      setSelectedMediaIds([]);
      fetchMedia();
      fetchEventData();
    } catch (err) {
      alert(err.message || 'Failed to delete media');
    }
  };

  const handleBatchMove = async () => {
    try {
      await api.moveMedia(selectedMediaIds, moveTargetFolderId || null);
      setSelectedMediaIds([]);
      setShowMoveModal(false);
      fetchMedia();
      fetchEventData();
    } catch (err) {
      alert(err.message || 'Failed to move media');
    }
  };

  const handleSetCover = async (mediaId) => {
    try {
      await api.updateEvent(eventId, { cover_photo_id: mediaId });
      fetchEventData();
    } catch (err) {
      alert(err.message || 'Failed to set cover photo');
    }
  };

  const handleConfirmVisibility = async () => {
    if (!visibilityConfirm) return;
    const target = visibilityConfirm;
    setVisibilityConfirm(null);
    setTogglingVisibility(true);
    try {
      const res = await api.updateEventVisibility(
        eventData.id,
        target,
        target === 'public' ? (eventData.public_duration_days || 30) : undefined
      );
      setEventData((prev) => ({ ...prev, ...res.event }));
    } catch (err) {
      alert(err.message || 'Failed to update visibility');
    } finally {
      setTogglingVisibility(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!eventData) return;

    try {
      setIsDeleting(true);
      setDeleteError(null);
      await api.moveToTrash(eventId);
      setShowDeleteModal(false);
      onBack();
    } catch (err) {
      console.error('Failed to move event to Recycle Bin:', err);
      setDeleteError(err.message || 'Failed to move event to Recycle Bin. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!eventData) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--text-muted)' }}>
        Loading event details...
      </div>
    );
  }

  const coverUrl = eventData.cover_preview
    ? `/api/media/stream?key=${encodeURIComponent(eventData.cover_preview)}`
    : null;

  return (
    <div>
      {/* Top Header Bar */}
      <div className="event-detail-header">
        <button className="btn btn-ghost" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px' }}>
          <ArrowLeft size={16} />
          <span style={{ fontSize: '0.88rem', letterSpacing: '0.02em' }}>Back to All Events</span>
        </button>

        <div className="event-detail-actions">
          <button
            className={eventData.visibility === 'public' ? 'btn btn-secondary' : 'btn btn-primary'}
            onClick={() => setVisibilityConfirm(eventData.visibility === 'public' ? 'private' : 'public')}
            disabled={togglingVisibility}
            title={eventData.visibility === 'public' ? 'Switch gallery to Private' : 'Make gallery Public for guests'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
          >
            <Globe size={15} />
            <span>
              {eventData.visibility === 'public'
                ? 'Make Private'
                : (eventData.is_expired || eventData.expired_at
                  ? 'Republish Gallery'
                  : 'Publish Gallery')}
            </span>
          </button>
          <button className="btn btn-secondary" onClick={() => setShowQrModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <QrCode size={15} />
            <span>Share & QR</span>
          </button>
          <button
            className={viewingSelections ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setViewingSelections(!viewingSelections)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
          >
            <CheckSquare size={15} />
            <span>Proofing & Selections</span>
          </button>
          <button className="btn btn-secondary" onClick={() => setShowSettingsModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <Settings size={15} />
            <span>Gallery Settings</span>
          </button>
          <button className="btn btn-primary" onClick={() => setShowUploadModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <UploadCloud size={15} />
            <span>Upload Media</span>
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setDeleteConfirmName('');
              setDeleteError(null);
              setShowDeleteModal(true);
            }}
            title="Permanently Delete Gallery"
            style={{ color: 'var(--status-error)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
          >
            <Trash2 size={15} />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {viewingSelections ? (
        <EventSelectionsPanel eventId={eventId} onBack={() => setViewingSelections(false)} />
      ) : (
        <>
          {/* Event Hero Banner with Optional Photographic Atmosphere */}
          <div className="glass-panel event-detail-hero-panel">
        {/* Subtle Event Cover Blurred Atmospheric Glow (Light Tone) */}
        {coverUrl && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${coverUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(60px) opacity(0.18)',
              transform: 'scale(1.15)',
              zIndex: 0,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Ambient Warm Vignette */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, rgba(167, 139, 250, 0.05) 0%, transparent 60%, rgba(125, 211, 252, 0.04) 100%)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />

        <div style={{ position: 'relative', zIndex: 2, maxWidth: 640 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <span className={`badge badge-${eventData.visibility}`}>
              {eventData.visibility}
            </span>
            {eventData.is_expired && (
              <span className="badge badge-expired">
                Expired
              </span>
            )}
            {eventData.pin_protected && (
              <span className="badge" style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', color: 'var(--accent-text)', border: '1px solid var(--accent-border)' }}>
                PIN Protected
              </span>
            )}
            {eventData.visibility === 'public' && eventData.public_until && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Public until {new Date(eventData.public_until).toLocaleDateString()} {new Date(eventData.public_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({eventData.public_duration_days || 30}d window)
              </span>
            )}
          </div>

          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 3.5vw, 2.8rem)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
            {eventData.name}
          </h1>

          <p style={{ fontSize: '0.94rem', color: 'var(--text-secondary)', marginTop: 8 }}>
            Client: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{eventData.client_name}</span>
            {eventData.location ? ` • ${eventData.location}` : ''} • {eventData.event_date}
          </p>
        </div>

        {/* Quick Stats on right */}
        <div className="glass-panel event-hero-stats-panel">
          <div style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {eventData.photo_count || 0}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>Photos</div>
          </div>
          <div style={{ width: 1, height: 38, backgroundColor: 'var(--border-subtle)' }} />
          <div style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--status-success)', letterSpacing: '-0.02em' }}>
              {eventData.face_count || 0}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>Faces Indexed</div>
          </div>
          <div style={{ width: 1, height: 38, backgroundColor: 'var(--border-subtle)' }} />
          <div style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--accent-text)', letterSpacing: '-0.02em' }}>
              {folders.length}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>Folders</div>
          </div>
        </div>
      </div>

      {/* Expired Notice Banner */}
      {(eventData.is_expired || (eventData.visibility === 'private' && eventData.expired_at)) && (
        <div
          className="glass-panel"
          style={{
            borderLeft: '3px solid var(--accent-primary)',
            padding: '16px 22px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--accent-text)', marginBottom: 2 }}>
              Gallery expired — currently private
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              The configured public viewing window ({eventData.public_duration_days || 30} days) has concluded. Guest access is closed. All photographs, videos, folders, and face embeddings remain safely intact. You may republish at any time.
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setVisibilityConfirm('public')}
            disabled={togglingVisibility}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}
          >
            <Globe size={14} />
            <span>Republish Gallery</span>
          </button>
        </div>
      )}

      {/* Active Processing Job Banner */}
      {activeJob && activeJob.status === 'processing' && (
        <div
          className="glass-panel"
          style={{
            borderLeft: '3px solid var(--accent-primary)',
            padding: '16px 20px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <RefreshCw size={18} className="animate-spin" color="var(--accent-primary)" />
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Asynchronous Media & AI Face Indexing in Progress...
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                {activeJob.processed_items} of {activeJob.total_items} items processed ({activeJob.progress}%)
              </div>
            </div>
          </div>
          <div style={{ width: 220, height: 6, backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
            <div style={{ width: `${activeJob.progress}%`, height: '100%', backgroundColor: 'var(--accent-primary)', transition: 'width 300ms ease' }} />
          </div>
        </div>
      )}

      {/* Folders Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: 14,
        marginBottom: 24,
        gap: 16,
        overflowX: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setActiveFolderId(null)}
            style={{
              padding: '7px 16px',
              borderRadius: 'var(--radius-pill)',
              fontSize: '0.84rem',
              fontWeight: activeFolderId === null ? 600 : 500,
              cursor: 'pointer',
              border: activeFolderId === null ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
              backgroundColor: activeFolderId === null ? '#FFFFFF' : 'rgba(255, 255, 255, 0.65)',
              color: activeFolderId === null ? 'var(--accent-text)' : 'var(--text-secondary)',
              boxShadow: activeFolderId === null ? '0 1px 4px rgba(50, 45, 38, 0.06)' : 'none',
              transition: 'all var(--transition-fast)',
              whiteSpace: 'nowrap',
            }}
          >
            All Media ({eventData.media_count || 0})
          </button>

          {folders.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => setActiveFolderId(f.id)}
                style={{
                  padding: '7px 16px',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: '0.84rem',
                  fontWeight: activeFolderId === f.id ? 600 : 500,
                  cursor: 'pointer',
                  border: activeFolderId === f.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  backgroundColor: activeFolderId === f.id ? '#FFFFFF' : 'rgba(255, 255, 255, 0.65)',
                  color: activeFolderId === f.id ? 'var(--accent-text)' : 'var(--text-secondary)',
                  boxShadow: activeFolderId === f.id ? '0 1px 4px rgba(50, 45, 38, 0.06)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all var(--transition-fast)',
                  whiteSpace: 'nowrap',
                }}
              >
                <Folder size={14} />
                <span>{f.name}</span>
                <span style={{ fontSize: '0.74rem', opacity: 0.75 }}>({f.photo_count || 0})</span>
              </button>

              {activeFolderId === f.id && (
                <button
                  onClick={() => handleDeleteFolder(f.id)}
                  title="Remove folder (photos preserved)"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '6px' }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}

          <button
            className="btn btn-ghost"
            onClick={() => setShowNewFolderModal(true)}
            style={{ fontSize: '0.82rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FolderPlus size={14} />
            <span>New Folder</span>
          </button>
        </div>

        {/* Selection Tools */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {selectedMediaIds.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--accent-text)', fontWeight: 600 }}>
                {selectedMediaIds.length} Selected
              </span>
              <button className="btn btn-secondary" onClick={() => setShowMoveModal(true)} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>
                Move to Folder
              </button>
              <button className="btn btn-secondary" onClick={() => api.downloadZip(eventId, selectedMediaIds)} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>
                <Download size={13} />
                <span>Download ZIP</span>
              </button>
              <button className="btn btn-danger" onClick={handleBatchDelete} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            </div>
          ) : (
            <button
              className="btn btn-ghost"
              onClick={() => setSelectMode(!selectMode)}
              style={{ fontSize: '0.8rem' }}
            >
              {selectMode ? 'Cancel Select' : 'Select Photos'}
            </button>
          )}
        </div>
      </div>

      {/* Photos Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: '0.9rem' }}>
            <RefreshCw size={18} className="spin" color="var(--accent-primary)" />
            <span>Loading gallery assets...</span>
          </div>
        </div>
      ) : media.length === 0 ? (
        <div
          className="glass-panel"
          style={{
            textAlign: 'center',
            padding: '80px 24px',
            borderRadius: 'var(--radius-lg)',
            margin: '12px 0 32px',
          }}
        >
          <UploadCloud size={44} color="var(--accent-primary)" style={{ margin: '0 auto 16px', opacity: 0.9 }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.45rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            No media in this folder yet
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '8px auto 24px', maxWidth: 440, lineHeight: 1.5 }}>
            Upload high-resolution photography. Derivatives, color palettes, and AI facial indexing will be automatically computed.
          </p>
          <button className="btn btn-primary" onClick={() => setShowUploadModal(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <UploadCloud size={16} />
            <span>Upload Photos to {folders.find(f => f.id === activeFolderId)?.name || 'Gallery'}</span>
          </button>
        </div>
      ) : (
        <div className="photo-grid">
          {media.map((item) => {
            const isSelected = selectedMediaIds.includes(item.id);
            const photographerToken = localStorage.getItem('photographer_token');
            const tokenParam = photographerToken ? `&token=${encodeURIComponent(photographerToken)}` : '';
            const thumbKey = item.storage_key_thumbnail || item.storage_key_preview || item.storage_key_original;
            const thumbUrl = `/api/media/stream?key=${encodeURIComponent(thumbKey)}${tokenParam}`;

            return (
              <div
                key={item.id}
                className="photo-card"
                onClick={() => {
                  if (selectMode || selectedMediaIds.length > 0) {
                    toggleSelectMedia(item.id);
                  } else {
                    setPreviewMedia(item);
                  }
                }}
                style={{
                  position: 'relative',
                  borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-subtle)',
                  boxShadow: isSelected ? '0 0 0 2px var(--accent-primary), 0 8px 24px rgba(167, 139, 250, 0.22)' : 'none',
                }}
              >
                <img src={thumbUrl} alt={item.original_name} loading="lazy" />

                {/* Processing Overlay */}
                {(item.status === 'processing' || item.status === 'uploaded') && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'rgba(247, 249, 252, 0.92)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    zIndex: 2,
                  }}>
                    <RefreshCw size={20} className="spin" color="var(--accent-primary)" />
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Processing...</span>
                  </div>
                )}

                {/* Select Checkbox (always visible when selected or in select mode) */}
                {(selectMode || selectedMediaIds.length > 0) && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectMedia(item.id);
                    }}
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      zIndex: 3,
                      background: isSelected ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.92)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-medium)',
                      borderRadius: 'var(--radius-xs)',
                      padding: 3,
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                    }}
                  >
                    {isSelected ? (
                      <CheckSquare size={16} color="#FFFFFF" />
                    ) : (
                      <Square size={16} color="var(--text-secondary)" />
                    )}
                  </div>
                )}

                {/* Faces Detected Badge */}
                {item.faces_detected > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 2,
                    backgroundColor: 'rgba(255, 255, 255, 0.92)',
                    backdropFilter: 'blur(4px)',
                    padding: '2px 7px',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: 'var(--status-success)',
                    border: '1px solid rgba(42, 157, 143, 0.25)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    <Users size={11} />
                    <span>{item.faces_detected}</span>
                  </div>
                )}

                {/* Hover Overlay */}
                <div className="photo-overlay">
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: '0.78rem', color: '#fff', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {item.original_name}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.7)' }}>
                      {(item.file_size / (1024 * 1024)).toFixed(1)} MB
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetCover(item.id);
                      }}
                      title="Set as Cover"
                      className="btn btn-ghost"
                      style={{ padding: '4px', color: '#fff' }}
                    >
                      <Image size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox Photo Preview */}
      {previewMedia && (
        <div className="lightbox-backdrop" onClick={() => setPreviewMedia(null)}>
          <div className="lightbox-header" onClick={(e) => e.stopPropagation()}>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>{previewMedia.original_name}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {previewMedia.width} × {previewMedia.height} • {(previewMedia.file_size / (1024 * 1024)).toFixed(1)} MB
                {previewMedia.camera_make ? ` • ${previewMedia.camera_make} ${previewMedia.camera_model}` : ''}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <a
                href={`/api/media/download/${previewMedia.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
                style={{ fontSize: '0.82rem' }}
              >
                <Download size={15} />
                <span>Download Original</span>
              </a>

              <button className="btn btn-ghost" onClick={() => setPreviewMedia(null)}>
                Close
              </button>
            </div>
          </div>

          <div className="lightbox-content">
            {(() => {
              const photographerToken = localStorage.getItem('photographer_token');
              const tokenParam = photographerToken ? `&token=${encodeURIComponent(photographerToken)}` : '';
              return (
                <img
                  src={`/api/media/stream?key=${encodeURIComponent(previewMedia.storage_key_preview || previewMedia.storage_key_original)}${tokenParam}`}
                  alt={previewMedia.original_name}
                  className="lightbox-image"
                  onClick={(e) => e.stopPropagation()}
                />
              );
            })()}
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="modal-backdrop" onClick={() => setShowNewFolderModal(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3 className="modal-title">Create Folder</h3>
            </div>
            <form onSubmit={handleCreateFolder}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Folder Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Haldi, Reception, Couple Shoot"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowNewFolderModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move Media Modal */}
      {showMoveModal && (
        <div className="modal-backdrop" onClick={() => setShowMoveModal(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3 className="modal-title">Move {selectedMediaIds.length} Photos</h3>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Destination Folder</label>
                <select
                  className="form-select"
                  value={moveTargetFolderId}
                  onChange={(e) => setMoveTargetFolderId(e.target.value)}
                >
                  <option value="">(All Media / Uncategorized)</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowMoveModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleBatchMove}>
                Move Photos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadModal
          eventId={eventId}
          folders={folders}
          initialFolderId={activeFolderId}
          onClose={() => setShowUploadModal(false)}
          onUploadComplete={() => {
            fetchMedia();
            fetchEventData();
          }}
        />
      )}

      {/* QR Modal */}
      {showQrModal && (
        <QrModal
          event={eventData}
          onClose={() => setShowQrModal(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <EventSettingsModal
          event={eventData}
          onClose={() => setShowSettingsModal(false)}
          onUpdated={(updated) => {
            setEventData((prev) => ({ ...prev, ...updated }));
          }}
        />
      )}

      {/* Visibility Confirmation Modal */}
      {visibilityConfirm && (
        <div className="modal-backdrop" onClick={() => setVisibilityConfirm(null)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3 className="modal-title">
                {visibilityConfirm === 'private' ? 'Make Gallery Private?' : 'Publish Gallery?'}
              </h3>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {visibilityConfirm === 'private' ? (
                <p>
                  Setting this gallery to <strong>Private</strong> will immediately block guest access.
                  Any active guest sessions will be revoked. Your photos, folders, and settings will remain completely safe.
                </p>
              ) : eventData.is_expired || eventData.expired_at ? (
                <p>
                  Republishing this gallery will start a brand-new <strong>{eventData.public_duration_days || 30}-day</strong> public viewing window starting right now.
                  Guests will regain access{eventData.pin_protected ? ' using the configured PIN.' : '.'}
                </p>
              ) : (
                <p>
                  Publishing this gallery will make it accessible to guests for <strong>{eventData.public_duration_days || 30} days</strong>
                  {eventData.pin_protected ? ' (they will be prompted to enter the event PIN).' : '.'}
                </p>
              )}
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px' }}>
              <button className="btn btn-ghost" onClick={() => setVisibilityConfirm(null)}>
                Cancel
              </button>
              <button
                className={visibilityConfirm === 'private' ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={handleConfirmVisibility}
              >
                {visibilityConfirm === 'private' ? 'Confirm Private' : (eventData.is_expired || eventData.expired_at ? 'Republish Now' : 'Confirm Publish')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => !isDeleting && setShowDeleteModal(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Trash2 size={18} />
                <span>Move to Recycle Bin</span>
              </h3>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Are you sure you want to move <strong style={{ color: 'var(--text-primary)' }}>{eventData.name}</strong> to the Recycle Bin?
              </p>

              <div style={{
                backgroundColor: 'rgba(197, 160, 89, 0.08)',
                border: '1px solid rgba(197, 160, 89, 0.3)',
                padding: '14px 16px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}>
                <strong style={{ color: 'var(--accent-primary)' }}>30-Day Safety Retention:</strong>
                <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                  <li>All photographs, videos, and face embeddings remain 100% safe.</li>
                  <li>Guest access links and searches are immediately paused.</li>
                  <li>You can restore this event anytime within 30 days from the Recycle Bin tab.</li>
                </ul>
              </div>

              {deleteError && (
                <div style={{
                  padding: '10px 12px',
                  backgroundColor: 'rgba(230, 57, 70, 0.15)',
                  border: '1px solid var(--status-error)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--status-error)',
                  fontSize: '0.82rem',
                }}>
                  {deleteError}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleDeleteEvent}
                disabled={isDeleting}
                style={{ minWidth: 160, borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }}
              >
                {isDeleting ? (
                  <span>Moving to Bin...</span>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Move to Recycle Bin</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
