import React, { useState, useEffect } from 'react';
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Clock,
  Calendar,
  Camera,
  RefreshCw,
  Loader2,
  CheckCircle,
  X,
  ShieldAlert,
  Image as ImageIcon,
  Video,
} from 'lucide-react';
import api from '../api.js';

export default function BinView({ onEventRestored }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successToast, setSuccessToast] = useState(null);

  // Modal states
  const [permanentDeleteEvent, setPermanentDeleteEvent] = useState(null);
  const [confirmNameInput, setConfirmNameInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const [showEmptyModal, setShowEmptyModal] = useState(false);
  const [emptyConfirmText, setEmptyConfirmText] = useState('');
  const [emptying, setEmptying] = useState(false);
  const [emptyResult, setEmptyResult] = useState(null);

  const fetchBinEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getBinEvents();
      setEvents(res.events || []);
    } catch (err) {
      setError(err.message || 'Failed to load Recycle Bin events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBinEvents();
  }, []);

  const showToast = (message) => {
    setSuccessToast(message);
    setTimeout(() => setSuccessToast(null), 4000);
  };

  const handleRestore = async (event) => {
    try {
      await api.restoreEvent(event.id);
      showToast(`Event "${event.name}" restored successfully.`);
      fetchBinEvents();
      if (onEventRestored) onEventRestored(event);
    } catch (err) {
      alert(`Failed to restore event: ${err.message}`);
    }
  };

  const handlePermanentDelete = async (e) => {
    e.preventDefault();
    if (!permanentDeleteEvent) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      await api.deleteEventPermanently(permanentDeleteEvent.id, confirmNameInput.trim());
      showToast(`Event "${permanentDeleteEvent.name}" permanently deleted.`);
      setPermanentDeleteEvent(null);
      setConfirmNameInput('');
      fetchBinEvents();
    } catch (err) {
      setDeleteError(err.message || 'Failed to permanently delete event.');
    } finally {
      setDeleting(false);
    }
  };

  const handleEmptyBin = async () => {
    try {
      setEmptying(true);
      setDeleteError(null);
      const res = await api.emptyBin();
      setEmptyResult(res);
      showToast(`Successfully permanently deleted ${res.successfullyDeleted} event(s).`);
      fetchBinEvents();
      setShowEmptyModal(false);
      setEmptyConfirmText('');
    } catch (err) {
      setDeleteError(err.message || 'Failed to empty Recycle Bin.');
    } finally {
      setEmptying(false);
    }
  };

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
      {/* Toast Notification */}
      {successToast && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 1000,
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--accent-primary)',
            color: 'var(--text-primary)',
            padding: '12px 20px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <CheckCircle size={18} color="var(--accent-primary)" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 32,
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: 24,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <Trash2 size={24} color="var(--accent-primary)" />
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '2rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                margin: 0,
              }}
            >
              Recycle Bin
            </h1>
            <span
              style={{
                fontSize: '0.8rem',
                padding: '2px 8px',
                borderRadius: 12,
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              {events.length} {events.length === 1 ? 'event' : 'events'}
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: 700, margin: 0 }}>
            Events moved to the bin are retained for 30 days before automatic permanent deletion. Photos, videos, and face embeddings remain safe until permanently purged.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={fetchBinEvents}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            className="btn"
            onClick={() => setShowEmptyModal(true)}
            disabled={events.length === 0 || loading}
            style={{
              backgroundColor: events.length > 0 ? 'rgba(194, 65, 62, 0.08)' : 'var(--bg-secondary)',
              borderColor: events.length > 0 ? 'rgba(194, 65, 62, 0.3)' : 'var(--border-subtle)',
              color: events.length > 0 ? 'var(--status-error)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: events.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            <Trash2 size={14} />
            <span>Empty Bin</span>
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--text-muted)' }}>
          <Loader2 size={32} className="spin" style={{ margin: '0 auto 16px' }} />
          <p>Loading Recycle Bin...</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div
          style={{
            padding: 24,
            backgroundColor: 'rgba(194, 65, 62, 0.08)',
            border: '1px solid rgba(194, 65, 62, 0.25)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--status-error)',
            marginBottom: 24,
          }}
        >
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && events.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 24px',
            backgroundColor: 'var(--surface-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: 'var(--bg-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: 'var(--text-muted)',
            }}
          >
            <Trash2 size={24} />
          </div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: 8 }}>
            Recycle Bin is Empty
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: 450, margin: '0 auto' }}>
            No events have been moved to the Recycle Bin. When you delete an event from your dashboard, it will appear here for 30 days before permanent deletion.
          </p>
        </div>
      )}

      {/* Events List */}
      {!loading && !error && events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {events.map((event) => {
            const isUrgent = event.days_remaining <= 3;
            return (
              <div
                key={event.id}
                className="bin-event-row glass-panel"
                style={{
                  borderRadius: 'var(--radius-md)',
                  padding: '20px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 20,
                  transition: 'border-color var(--transition-fast)',
                }}
              >
                {/* Left: Thumbnail and Metadata */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1 }}>
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {event.cover_preview_url ? (
                      <img
                        src={event.cover_preview_url}
                        alt={event.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <Camera size={24} color="var(--text-muted)" />
                    )}
                  </div>

                  <div>
                    <h3
                      style={{
                        fontSize: '1.1rem',
                        fontWeight: 600,
                        margin: '0 0 6px',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {event.name}
                    </h3>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 16,
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={13} />
                        Event Date: {event.event_date}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ImageIcon size={13} />
                        {event.photo_count ?? 0} {event.photo_count === 1 ? 'photo' : 'photos'}
                      </span>
                      {Boolean(event.video_count) && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Video size={13} />
                          {event.video_count} {event.video_count === 1 ? 'video' : 'videos'}
                        </span>
                      )}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Trash2 size={13} />
                        Moved to Bin: {new Date(event.deleted_at).toLocaleDateString()}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={13} />
                        Purge Deadline: {new Date(event.purge_after).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Center: Days Remaining Badge */}
                <div style={{ textAlign: 'center', padding: '0 16px' }}>
                  <div
                    style={{
                      padding: '6px 12px',
                      borderRadius: 20,
                      backgroundColor: isUrgent ? 'var(--status-error-subtle)' : 'var(--accent-glow)',
                      border: `1px solid ${isUrgent ? 'var(--status-error-border)' : 'var(--accent-border)'}`,
                      color: isUrgent ? 'var(--status-error)' : 'var(--accent-text)',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {isUrgent && <AlertTriangle size={14} />}
                    <span>{event.days_remaining} {event.days_remaining === 1 ? 'day' : 'days'} remaining</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Auto-purges after deadline
                  </div>
                </div>

                {/* Right: Actions */}
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleRestore(event)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: '0.85rem',
                    }}
                  >
                    <RotateCcw size={14} color="var(--accent-primary)" />
                    <span>Restore</span>
                  </button>

                  <button
                    className="btn"
                    onClick={() => {
                      setPermanentDeleteEvent(event);
                      setConfirmNameInput('');
                      setDeleteError(null);
                    }}
                    style={{
                      backgroundColor: 'transparent',
                      borderColor: 'rgba(194, 65, 62, 0.3)',
                      color: 'var(--status-error)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: '0.85rem',
                    }}
                  >
                    <Trash2 size={14} />
                    <span>Permanently Delete</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Permanently Delete Confirmation Modal */}
      {permanentDeleteEvent && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(26, 26, 26, 0.45)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            className="glass-panel-strong"
            style={{
              borderRadius: 'var(--radius-lg)',
              maxWidth: 520,
              width: '100%',
              padding: 32,
              boxShadow: 'var(--shadow-lg)',
              border: '1px solid rgba(194, 65, 62, 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(194, 65, 62, 0.10)',
                  border: '1px solid rgba(194, 65, 62, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--status-error)',
                }}
              >
                <ShieldAlert size={22} />
              </div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>
                Permanently Delete Event?
              </h3>
            </div>

            <div
              style={{
                backgroundColor: 'rgba(194, 65, 62, 0.08)',
                border: '1px solid rgba(194, 65, 62, 0.25)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px 16px',
                marginBottom: 20,
                fontSize: '0.84rem',
                color: 'var(--status-error)',
                lineHeight: 1.5,
              }}
            >
              <strong>Warning: This action is permanent and irreversible.</strong> All original photographs, videos, previews, thumbnails, neural face embeddings, and folder metadata will be permanently erased from Cloudflare R2 and Supabase.
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              To confirm permanent deletion, please type the event name{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{permanentDeleteEvent.name}</strong> below:
            </p>

            <form onSubmit={handlePermanentDelete}>
              <input
                type="text"
                className="form-input"
                value={confirmNameInput}
                onChange={(e) => setConfirmNameInput(e.target.value)}
                placeholder={permanentDeleteEvent.name}
                autoFocus
                disabled={deleting}
                style={{
                  width: '100%',
                  marginBottom: 16,
                }}
              />

              {deleteError && (
                <div style={{ color: 'var(--status-error)', fontSize: '0.85rem', marginBottom: 16 }}>
                  {deleteError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPermanentDeleteEvent(null)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn"
                  disabled={
                    deleting ||
                    confirmNameInput.trim().toLowerCase() !== permanentDeleteEvent.name.trim().toLowerCase()
                  }
                  style={{
                    backgroundColor: 'var(--status-error)',
                    borderColor: 'var(--status-error)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 18px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {deleting ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      <span>Permanently Delete</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Empty Bin Confirmation Modal */}
      {showEmptyModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(26, 26, 26, 0.45)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            className="glass-panel-strong"
            style={{
              borderRadius: 'var(--radius-lg)',
              maxWidth: 520,
              width: '100%',
              padding: 32,
              boxShadow: 'var(--shadow-lg)',
              border: '1px solid rgba(194, 65, 62, 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(194, 65, 62, 0.10)',
                  border: '1px solid rgba(194, 65, 62, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--status-error)',
                }}
              >
                <ShieldAlert size={22} />
              </div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>
                Empty Recycle Bin?
              </h3>
            </div>

            <div
              style={{
                backgroundColor: 'rgba(194, 65, 62, 0.08)',
                border: '1px solid rgba(194, 65, 62, 0.25)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px 16px',
                marginBottom: 20,
                fontSize: '0.84rem',
                color: 'var(--status-error)',
                lineHeight: 1.5,
              }}
            >
              <strong>This will permanently delete ALL {events.length} event(s) in the Recycle Bin.</strong> All associated media files, face embeddings, and database records will be irrevocably purged.
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              Type <strong style={{ color: 'var(--text-primary)' }}>EMPTY BIN</strong> to confirm:
            </p>

            <input
              type="text"
              className="form-input"
              value={emptyConfirmText}
              onChange={(e) => setEmptyConfirmText(e.target.value)}
              placeholder="EMPTY BIN"
              autoFocus
              disabled={emptying}
              style={{
                width: '100%',
                marginBottom: 16,
              }}
            />

            {deleteError && (
              <div style={{ color: 'var(--status-error)', fontSize: '0.85rem', marginBottom: 16 }}>
                {deleteError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowEmptyModal(false);
                  setEmptyConfirmText('');
                }}
                disabled={emptying}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleEmptyBin}
                disabled={emptying || emptyConfirmText.trim().toUpperCase() !== 'EMPTY BIN'}
                style={{
                  backgroundColor: 'var(--status-error)',
                  borderColor: 'var(--status-error)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 18px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {emptying ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    <span>Emptying Bin...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    <span>Empty Bin</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
