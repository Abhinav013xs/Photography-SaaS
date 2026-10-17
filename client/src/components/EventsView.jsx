import { useState } from 'react';
import {
  Search, Calendar, Image, Users, QrCode, Settings,
  Archive, RotateCcw, Trash2, Shield, Clock, Plus, Folder
} from 'lucide-react';
import StatsStrip from './StatsStrip.jsx';
import api from '../api.js';

export default function EventsView({
  events,
  stats,
  loading,
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  sortOption,
  setSortOption,
  onSelectEvent,
  onNewEvent,
  onOpenQr,
  onOpenSettings,
  onArchive,
  onRestore,
  onDelete,
}) {
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const openDeleteModal = (ev) => {
    setDeleteCandidate(ev);
    setDeleteError(null);
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteCandidate(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deleteCandidate || deleting) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      await api.moveToTrash(deleteCandidate.id);
      setDeleteCandidate(null);
      onDelete(deleteCandidate.id);
    } catch (err) {
      setDeleteError(err.message || 'Failed to move event to Recycle Bin. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      {/* Metrics Banner */}
      <StatsStrip stats={stats} />

      {/* Action and Filter Bar */}
      <div className="events-filter-bar">
        {/* Search & Status Filters */}
        <div className="events-search-group">
          <div className="events-search-box">
            <Search size={15} color="var(--text-muted)" style={{ position: 'absolute', left: 14, top: 12.5 }} />
            <input
              type="text"
              className="form-input"
              placeholder="Search events or clients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                paddingLeft: 38,
                height: 40,
                backgroundColor: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(10px)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-medium)',
              }}
            />
          </div>

          {/* Filter Tabs */}
          <div style={{
            display: 'flex',
            backgroundColor: 'rgba(255, 255, 255, 0.75)',
            backdropFilter: 'blur(10px)',
            padding: 3,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 1px 3px rgba(50, 45, 38, 0.04)',
          }}>
            {['active', 'archived', 'all'].map((tab) => {
              const isSelected = statusFilter === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setStatusFilter(tab)}
                  style={{
                    background: isSelected ? '#FFFFFF' : 'transparent',
                    color: isSelected ? 'var(--accent-text)' : 'var(--text-secondary)',
                    border: isSelected ? '1px solid var(--accent-border)' : '1px solid transparent',
                    boxShadow: isSelected ? '0 1px 4px rgba(50, 45, 38, 0.06)' : 'none',
                    padding: '6px 14px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  {tab === 'all' ? 'All' : tab}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sort & New Event CTA */}
        <div className="events-actions-group">
          <select
            className="form-select events-sort-select"
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value)}
            style={{
              width: 180,
              height: 40,
              backgroundColor: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(10px)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.84rem',
              border: '1px solid var(--border-medium)',
            }}
          >
            <option value="date_desc">Latest Date First</option>
            <option value="date_asc">Oldest Date First</option>
            <option value="name_asc">Name (A-Z)</option>
            <option value="name_desc">Name (Z-A)</option>
          </select>

          <button className="btn btn-primary" onClick={onNewEvent}>
            <Plus size={16} strokeWidth={2.5} />
            <span>New Event</span>
          </button>
        </div>
      </div>

      {/* Event Cards Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
          <div className="spin" style={{ width: 24, height: 24, border: '2px solid var(--border-medium)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', margin: '0 auto 12px' }} />
          Loading galleries...
        </div>
      ) : events.length === 0 ? (
        <div className="glass-panel" style={{
          textAlign: 'center',
          padding: '80px 24px',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
        }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--accent-subtle)',
            border: '1px solid var(--accent-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            color: 'var(--accent-primary)',
          }}>
            <Calendar size={28} />
          </div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.65rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            No photography events found
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.90rem', maxWidth: 440, margin: '8px auto 24px', lineHeight: 1.5 }}>
            Create an event to start uploading client galleries, organizing ceremony folders, and enabling AI face matching.
          </p>
          <button className="btn btn-primary" onClick={onNewEvent}>
            <Plus size={16} strokeWidth={2.5} />
            <span>Create Your First Event</span>
          </button>
        </div>
      ) : (
        <div className="events-grid-container">
          {events.map((ev) => {
            const isPublic = ev.visibility === 'public';
            const isExpired = Boolean(ev.is_expired);
            const coverUrl = ev.cover_preview 
              ? `/api/media/stream?key=${encodeURIComponent(ev.cover_preview)}`
              : ev.cover_thumbnail
              ? `/api/media/stream?key=${encodeURIComponent(ev.cover_thumbnail)}`
              : null;

            return (
              <div
                key={ev.id}
                className="glass-panel"
                style={{
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: 'var(--surface-card)',
                  border: '1px solid var(--glass-border)',
                  boxShadow: 'var(--glass-shadow)',
                  transition: 'border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast)',
                }}
              >
                {/* Event Cover Image */}
                <div
                  onClick={() => onSelectEvent(ev.id)}
                  style={{
                    height: 210,
                    backgroundColor: 'var(--bg-tertiary)',
                    position: 'relative',
                    cursor: 'pointer',
                    overflow: 'hidden',
                  }}
                >
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={ev.name}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                        transition: 'transform 350ms cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                      onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                      onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                    />
                  ) : (
                    <div style={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                      gap: 8,
                      background: 'radial-gradient(circle at center, rgba(70,65,58,0.04) 0%, transparent 70%)',
                    }}>
                      <Image size={32} strokeWidth={1.5} />
                      <span style={{ fontSize: '0.76rem', letterSpacing: '0.04em' }}>No Cover Image</span>
                    </div>
                  )}

                  {/* Gradient shadow overlay for badge legibility */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, rgba(37,37,37,0.35) 0%, transparent 40%, rgba(37,37,37,0.65) 100%)',
                    pointerEvents: 'none',
                  }} />

                  {/* Status Badges Overlay */}
                  <div style={{
                    position: 'absolute',
                    top: 14,
                    left: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    zIndex: 2,
                  }}>
                    {ev.status === 'archived' ? (
                      <span className="badge badge-archived">Archived</span>
                    ) : isExpired ? (
                      <span className="badge badge-expired">Expired</span>
                    ) : isPublic ? (
                      <span className="badge badge-public" style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(6px)' }}>Public</span>
                    ) : (
                      <span className="badge badge-private" style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(6px)' }}>Private</span>
                    )}

                    {ev.pin_protected && (
                      <span className="badge" style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        color: 'var(--accent-text)',
                        border: '1px solid var(--accent-border)',
                        backdropFilter: 'blur(6px)',
                      }}>
                        <Shield size={11} /> PIN
                      </span>
                    )}
                  </div>

                  {/* Expiry Pill */}
                  {isPublic && ev.public_until && !isExpired && (
                    <div style={{
                      position: 'absolute',
                      bottom: 12,
                      right: 12,
                      backgroundColor: 'rgba(255, 255, 255, 0.92)',
                      backdropFilter: 'blur(8px)',
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: '0.72rem',
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      border: '1px solid rgba(255, 255, 255, 0.8)',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                    }}>
                      <Clock size={11} style={{ color: 'var(--accent-primary)' }} />
                      <span>{new Date(ev.public_until).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>

                {/* Event Card Info */}
                <div style={{ padding: '20px 22px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ marginBottom: 14 }}>
                    <h3
                      onClick={() => onSelectEvent(ev.id)}
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '1.40rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        lineHeight: 1.25,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {ev.name}
                    </h3>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 5 }}>
                      Client: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{ev.client_name}</span>
                      {ev.location ? ` • ${ev.location}` : ''}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 3 }}>
                      {ev.event_date}
                    </div>
                  </div>

                  {/* Asset Count Strip */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '12px 0',
                    borderTop: '1px solid var(--border-subtle)',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontSize: '0.78rem',
                    color: 'var(--text-secondary)',
                    marginTop: 'auto',
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Image size={13} style={{ color: 'var(--accent-primary)' }} />
                      {ev.photo_count || 0} Photos
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Folder size={13} />
                      {ev.folder_count || 0} Folders
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Users size={13} style={{ color: 'var(--status-success)' }} />
                      {ev.face_count || 0} Faces
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 16,
                    gap: 8,
                  }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => onSelectEvent(ev.id)}
                      style={{ flex: 1, padding: '8px 14px', fontSize: '0.84rem' }}
                    >
                      Manage Gallery
                    </button>

                    <button
                      className="btn btn-ghost"
                      onClick={() => onOpenQr(ev)}
                      title="Share & QR Code"
                      style={{ padding: '8px', borderRadius: 'var(--radius-sm)' }}
                    >
                      <QrCode size={16} />
                    </button>

                    <button
                      className="btn btn-ghost"
                      onClick={() => onOpenSettings(ev)}
                      title="Gallery Settings"
                      style={{ padding: '8px', borderRadius: 'var(--radius-sm)' }}
                    >
                      <Settings size={16} />
                    </button>

                    {ev.status === 'archived' ? (
                      <button
                        className="btn btn-ghost"
                        onClick={() => onRestore(ev.id)}
                        title="Restore Event"
                        style={{ padding: '8px', borderRadius: 'var(--radius-sm)' }}
                      >
                        <RotateCcw size={16} style={{ color: 'var(--status-success)' }} />
                      </button>
                    ) : (
                      <button
                        className="btn btn-ghost"
                        onClick={() => onArchive(ev.id)}
                        title="Archive Event"
                        style={{ padding: '8px', borderRadius: 'var(--radius-sm)' }}
                      >
                        <Archive size={16} />
                      </button>
                    )}

                    <button
                      className="btn btn-ghost"
                      onClick={() => openDeleteModal(ev)}
                      title="Move to Recycle Bin"
                      style={{ padding: '8px', borderRadius: 'var(--radius-sm)' }}
                    >
                      <Trash2 size={16} style={{ color: 'var(--status-error)' }} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteCandidate && (
        <div className="modal-backdrop" onClick={closeDeleteModal}>
          <div className="modal-container glass-panel-strong" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Trash2 size={18} />
                <span>Move to Recycle Bin</span>
              </h3>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: '0.90rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Are you sure you want to move <strong style={{ color: 'var(--text-primary)' }}>{deleteCandidate.name}</strong> to the Recycle Bin?
              </p>

              <div style={{
                backgroundColor: 'var(--accent-subtle)',
                border: '1px solid var(--accent-border)',
                padding: '16px 18px',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.84rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
              }}>
                <strong style={{ color: 'var(--accent-primary)' }}>30-Day Safety Retention:</strong>
                <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                  <li>All photographs, videos, and face embeddings remain 100% safe.</li>
                  <li>Guest access links and searches are immediately paused.</li>
                  <li>You can restore this event anytime within 30 days from the Recycle Bin tab.</li>
                </ul>
              </div>

              {deleteError && (
                <div style={{
                  padding: '12px 14px',
                  backgroundColor: 'rgba(194, 65, 62, 0.10)',
                  border: '1px solid var(--status-error)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--status-error)',
                  fontSize: '0.84rem',
                }}>
                  {deleteError}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeDeleteModal} disabled={deleting}>
                Cancel
              </button>
              <button
                className="btn btn-secondary"
                onClick={confirmDelete}
                disabled={deleting}
                style={{ minWidth: 160, borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }}
              >
                {deleting ? (
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
    </div>
  );
}
