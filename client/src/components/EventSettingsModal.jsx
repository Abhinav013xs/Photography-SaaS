import React, { useState, useEffect } from 'react';
import {
  X, Shield, Clock, Download, Eye, Cpu, Save, AlertCircle, RefreshCw,
  CheckCircle2, FileText, Globe, Archive, Trash2, Image as ImageIcon,
  Check, AlertTriangle, ArrowRight, Sparkles, Film
} from 'lucide-react';
import api from '../api.js';

export default function EventSettingsModal({ event, onClose, onUpdated }) {
  const [activeTab, setActiveTab] = useState('general');

  // Form state
  const [formData, setFormData] = useState({
    name: event.name || '',
    client_name: event.client_name || '',
    client_email: event.client_email || '',
    event_date: event.event_date || '',
    location: event.location || '',
    description: event.description || '',
    cover_photo_id: event.cover_photo_id || null,
    visibility: event.visibility || 'public',
    public_duration_days: event.public_duration_days || 30,
    pin_enabled: Boolean(event.pin_protected ?? event.pin_enabled),
    pin: '',
    allow_downloads: Boolean(event.allow_downloads),
    allow_photo_downloads: event.allow_photo_downloads !== false,
    allow_bulk_downloads: event.allow_bulk_downloads !== false,
    allow_video_downloads: event.allow_video_downloads !== false,
    watermark_enabled: Boolean(event.watermark_enabled),
    watermark_text: event.watermark_text || 'Studio Lumina',
    watermark_opacity: event.watermark_opacity !== undefined && event.watermark_opacity !== null ? Number(event.watermark_opacity) : 0.40,
    watermark_size: event.watermark_size || 'medium',
    watermark_position: event.watermark_position || 'bottom-right',
    watermark_color: event.watermark_color || 'white',
    face_search_enabled: event.face_search_enabled !== false,
    status: event.status || 'active',
    client_selection_mode: event.client_selection_mode || 'disabled',
    selection_package_name: event.selection_package_name || 'Full Collection',
    selection_package_quota: event.selection_package_quota ?? 0,
    selection_min_quota: event.selection_min_quota ?? 0,
    selection_allow_extra: Boolean(event.selection_allow_extra),
    selection_deadline: event.selection_deadline || '',
    selection_instructions: event.selection_instructions || '',
    selection_allow_changes_after_submission: event.selection_allow_changes_after_submission !== 0,
    selection_requires_approval: event.selection_requires_approval !== 0,
    selection_multiple_rounds: event.selection_multiple_rounds !== 0,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [lifecycleActionLoading, setLifecycleActionLoading] = useState(false);

  // Photos for cover image picker
  const [mediaList, setMediaList] = useState([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [showCoverPicker, setShowCoverPicker] = useState(false);

  // Watermark reprocess status
  const [reprocessStatus, setReprocessStatus] = useState(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessMessage, setReprocessMessage] = useState('');

  // Fetch photos for cover photo selection
  useEffect(() => {
    if (event?.id) {
      queueMicrotask(() => setLoadingMedia(true));
      api.getMedia(event.id)
        .then((res) => {
          if (res?.media) setMediaList(res.media);
        })
        .catch(() => {})
        .finally(() => setLoadingMedia(false));

      api.getWatermarkStatus(event.id)
        .then((res) => {
          if (res?.data) setReprocessStatus(res.data);
        })
        .catch(() => {});
    }
  }, [event?.id]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    setError('');
    setSuccessMessage('');
  };

  const handleReprocess = async () => {
    try {
      setReprocessing(true);
      setError('');
      setReprocessMessage('');
      const res = await api.reprocessWatermark(event.id);
      setReprocessMessage(`Queued ${res.queued} photos for watermark sync (v${res.version}).`);
      const statusRes = await api.getWatermarkStatus(event.id);
      if (statusRes?.data) setReprocessStatus(statusRes.data);
    } catch (err) {
      setError(err.message || 'Failed to trigger photo reprocessing');
    } finally {
      setReprocessing(false);
    }
  };

  const handleRepublish = async () => {
    try {
      setSaving(true);
      setError('');
      const res = await api.publishEvent(event.id, formData.public_duration_days);
      setFormData((prev) => ({
        ...prev,
        visibility: 'public',
        status: 'active',
      }));
      setSuccessMessage('Gallery republished successfully!');
      if (onUpdated) onUpdated(res.event);
    } catch (err) {
      setError(err.message || 'Failed to republish gallery');
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveToggle = async () => {
    try {
      setLifecycleActionLoading(true);
      setError('');
      if (formData.status === 'archived') {
        await api.unarchiveEvent(event.id);
        setFormData((prev) => ({ ...prev, status: 'active' }));
        setSuccessMessage('Gallery unarchived and restored to active state.');
      } else {
        await api.archiveEvent(event.id);
        setFormData((prev) => ({ ...prev, status: 'archived', visibility: 'private' }));
        setSuccessMessage('Gallery archived. Public guest access disabled.');
      }
      if (onUpdated) onUpdated({ ...event, status: formData.status === 'archived' ? 'active' : 'archived' });
    } catch (err) {
      setError(err.message || 'Failed to change archive status');
    } finally {
      setLifecycleActionLoading(false);
    }
  };

  const handleMoveToTrash = async () => {
    if (!window.confirm(`Move "${event.name}" to the Recycle Bin? It will be held for 30 days before permanent deletion.`)) {
      return;
    }
    try {
      setLifecycleActionLoading(true);
      setError('');
      await api.moveToTrash(event.id);
      if (onUpdated) onUpdated({ ...event, status: 'trashed' });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to move event to Recycle Bin');
    } finally {
      setLifecycleActionLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    // PIN Validation
    if (formData.pin_enabled && !event.pin_protected && !formData.pin) {
      setError('Please provide a 4-8 digit numeric PIN code to enable protection.');
      setActiveTab('pin');
      return;
    }

    if (formData.pin && !/^\d{4,8}$/.test(formData.pin.trim())) {
      setError('PIN must consist of 4 to 8 numeric digits.');
      setActiveTab('pin');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name: formData.name.trim(),
        client_name: formData.client_name.trim(),
        client_email: formData.client_email ? formData.client_email.trim() : null,
        event_date: formData.event_date,
        location: formData.location ? formData.location.trim() : null,
        description: formData.description ? formData.description.trim() : null,
        cover_photo_id: formData.cover_photo_id,
        visibility: formData.visibility,
        public_duration_days: parseInt(formData.public_duration_days, 10),
        public_days: parseInt(formData.public_duration_days, 10),
        pin_enabled: formData.pin_enabled,
        pin: formData.pin ? formData.pin.trim() : undefined,
        allow_downloads: formData.allow_downloads,
        allow_photo_downloads: formData.allow_photo_downloads,
        allow_bulk_downloads: formData.allow_bulk_downloads,
        allow_video_downloads: formData.allow_video_downloads,
        watermark_enabled: formData.watermark_enabled,
        watermark_text: formData.watermark_text ? formData.watermark_text.trim() : 'Studio Lumina',
        watermark_opacity: parseFloat(formData.watermark_opacity),
        watermark_size: formData.watermark_size,
        watermark_position: formData.watermark_position,
        watermark_color: formData.watermark_color,
        face_search_enabled: formData.face_search_enabled,
        status: formData.status,
        client_selection_mode: formData.client_selection_mode,
        selection_package_name: formData.selection_package_name ? formData.selection_package_name.trim() : 'Full Collection',
        selection_package_quota: parseInt(formData.selection_package_quota, 10) || 0,
        selection_min_quota: parseInt(formData.selection_min_quota, 10) || 0,
        selection_allow_extra: Boolean(formData.selection_allow_extra),
        selection_deadline: formData.selection_deadline || null,
        selection_instructions: formData.selection_instructions ? formData.selection_instructions.trim() : null,
        selection_allow_changes_after_submission: Boolean(formData.selection_allow_changes_after_submission),
        selection_requires_approval: Boolean(formData.selection_requires_approval),
        selection_multiple_rounds: Boolean(formData.selection_multiple_rounds),
      };

      const res = await api.updateEvent(event.id, payload);
      setSuccessMessage('Event settings saved successfully.');
      if (onUpdated) onUpdated(res.event || res);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      setError(err.message || 'Failed to save event settings.');
    } finally {
      setSaving(false);
    }
  };

  // Find currently selected cover photo
  const selectedCoverPhoto = mediaList.find((m) => m.id === formData.cover_photo_id);
  const currentCoverThumb = selectedCoverPhoto?.storage_key_thumbnail || event.cover_thumbnail;
  const currentCoverUrl = currentCoverThumb ? `/api/media/stream?key=${encodeURIComponent(currentCoverThumb)}` : null;

  // Compute live expiration estimation
  const computedExpiryDate = new Date();
  computedExpiryDate.setDate(computedExpiryDate.getDate() + Number(formData.public_duration_days || 30));

  const isExpired = event.is_expired || (event.public_until && new Date(event.public_until) < new Date());

  const tabs = [
    { id: 'general', label: 'General', icon: FileText, desc: 'Metadata & Cover' },
    { id: 'visibility', label: 'Visibility & Expiry', icon: Globe, desc: 'Public Window' },
    { id: 'pin', label: 'PIN Protection', icon: Shield, desc: 'Client Passcode' },
    { id: 'downloads', label: 'Downloads', icon: Download, desc: 'Single & Bulk' },
    { id: 'selection', label: 'Proofing & Selection', icon: CheckCircle2, desc: 'Packages & Quotas' },
    { id: 'watermark', label: 'Watermark', icon: Eye, desc: 'Brand Derivative' },
    { id: 'face_search', label: 'AI Face Search', icon: Cpu, desc: 'Selfie Matching' },
    { id: 'lifecycle', label: 'Lifecycle & Archive', icon: Archive, desc: 'Status & Bin' },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-container glass-panel-strong"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 900,
          width: '94vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border-medium)',
        }}
      >
        {/* Modal Header Bar */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                Event Settings
              </h3>
              <span className={`badge badge-${formData.visibility}`}>
                {formData.visibility}
              </span>
              {formData.status === 'archived' && (
                <span className="badge badge-archived">Archived</span>
              )}
              {isExpired && formData.visibility === 'public' && (
                <span className="badge badge-expired">Expired</span>
              )}
              {formData.pin_enabled && (
                <span className="badge" style={{ backgroundColor: 'var(--accent-glow)', color: 'var(--accent-text)', border: '1px solid var(--accent-border)' }}>
                  PIN Protected
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
              Managing <strong style={{ color: 'var(--text-secondary)' }}>{event.name}</strong> • Sole photographer control
            </p>
          </div>

          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 8 }} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Modal Body: Sidebar Tabs + Content Panel */}
        <div className="settings-modal-body-wrapper">
          {/* Left Navigation Sidebar */}
          <div className="settings-modal-sidebar-nav">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: isActive ? '1px solid var(--accent-border)' : '1px solid transparent',
                    backgroundColor: isActive ? 'var(--accent-glow)' : 'transparent',
                    color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Icon size={16} color={isActive ? 'var(--accent-primary)' : 'var(--text-muted)'} />
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: isActive ? 600 : 500 }}>
                      {tab.label}
                    </div>
                    <div className="settings-modal-tab-desc" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {tab.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Content Area */}
          <div className="settings-modal-content-area">
            {error && (
              <div style={{
                backgroundColor: 'rgba(194, 65, 62, 0.08)',
                border: '1px solid rgba(194, 65, 62, 0.25)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--status-error)',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
              }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {successMessage && (
              <div style={{
                backgroundColor: 'rgba(42, 157, 143, 0.08)',
                border: '1px solid rgba(42, 157, 143, 0.3)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--status-success)',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
              }}>
                <CheckCircle2 size={16} />
                <span>{successMessage}</span>
              </div>
            )}

            <form id="event-settings-form" onSubmit={handleSubmit}>
              {/* TAB 1: GENERAL SETTINGS */}
              {activeTab === 'general' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>General Event Information</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Core client details, date, location, and featured cover imagery.</p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Event Name *</label>
                      <input
                        type="text"
                        name="name"
                        className="form-input"
                        value={formData.name}
                        onChange={handleChange}
                        required
                        placeholder="e.g. Elena & Julian's Wedding"
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Client Name *</label>
                      <input
                        type="text"
                        name="client_name"
                        className="form-input"
                        value={formData.client_name}
                        onChange={handleChange}
                        required
                        placeholder="e.g. Elena Rostova"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Event Date *</label>
                      <input
                        type="date"
                        name="event_date"
                        className="form-input"
                        value={formData.event_date}
                        onChange={handleChange}
                        required
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Client Email</label>
                      <input
                        type="email"
                        name="client_email"
                        className="form-input"
                        value={formData.client_email}
                        onChange={handleChange}
                        placeholder="elena@example.com"
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Location / Venue</label>
                    <input
                      type="text"
                      name="location"
                      className="form-input"
                      value={formData.location}
                      onChange={handleChange}
                      placeholder="e.g. Villa d'Este, Lake Como, Italy"
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Description / Story Notes</label>
                    <textarea
                      name="description"
                      className="form-textarea"
                      rows={3}
                      value={formData.description}
                      onChange={handleChange}
                      placeholder="Fine art wedding editorial captured with Leica & 35mm film..."
                    />
                  </div>

                  {/* Cover Photo Selection */}
                  <div style={{
                    backgroundColor: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '14px 16px',
                    marginTop: 6,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Gallery Cover Photo</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Displayed prominently on gallery cards and guest portal headers.
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {formData.cover_photo_id && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setFormData((prev) => ({ ...prev, cover_photo_id: null }))}
                            style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                          >
                            Remove
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setShowCoverPicker(!showCoverPicker)}
                          style={{ fontSize: '0.75rem', padding: '5px 12px' }}
                        >
                          <ImageIcon size={13} />
                          <span>{showCoverPicker ? 'Hide Gallery' : 'Select From Photos'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Current Cover Preview */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{
                        width: 120,
                        height: 70,
                        borderRadius: 'var(--radius-xs)',
                        backgroundColor: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-medium)',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {currentCoverUrl ? (
                          <img src={currentCoverUrl} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ fontSize: '0.70rem', color: 'var(--text-muted)', textAlign: 'center' }}>No Cover Set</div>
                        )}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {selectedCoverPhoto ? (
                          <span>Using <strong>{selectedCoverPhoto.original_name}</strong></span>
                        ) : event.cover_photo_id ? (
                          <span>Active cover photo ID: <code>{event.cover_photo_id.slice(0, 8)}...</code></span>
                        ) : (
                          <span>Default thumbnail is currently assigned.</span>
                        )}
                      </div>
                    </div>

                    {/* Inline Cover Picker Grid */}
                    {showCoverPicker && (
                      <div style={{
                        marginTop: 14,
                        paddingTop: 12,
                        borderTop: '1px solid var(--border-subtle)',
                        maxHeight: 180,
                        overflowY: 'auto',
                      }}>
                        {loadingMedia ? (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>
                            Loading event photos...
                          </div>
                        ) : mediaList.length === 0 ? (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>
                            No uploaded photos in this event yet. Upload photos first to set a custom cover.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 8 }}>
                            {mediaList.filter(m => m.type === 'photo').map((photo) => {
                              const isSelected = formData.cover_photo_id === photo.id;
                              const thumbUrl = photo.storage_key_thumbnail
                                ? `/api/media/stream?key=${encodeURIComponent(photo.storage_key_thumbnail)}`
                                : null;
                              return (
                                <div
                                  key={photo.id}
                                  onClick={() => {
                                    setFormData((prev) => ({ ...prev, cover_photo_id: photo.id }));
                                    setShowCoverPicker(false);
                                  }}
                                  style={{
                                    height: 56,
                                    borderRadius: 'var(--radius-xs)',
                                    overflow: 'hidden',
                                    border: isSelected ? '2px solid var(--accent-primary)' : '1px solid var(--border-medium)',
                                    cursor: 'pointer',
                                    position: 'relative',
                                  }}
                                  title={photo.original_name}
                                >
                                  {thumbUrl ? (
                                    <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  ) : (
                                    <div style={{ background: '#222', width: '100%', height: '100%' }} />
                                  )}
                                  {isSelected && (
                                    <div style={{
                                      position: 'absolute',
                                      inset: 0,
                                      background: 'rgba(197, 160, 89, 0.4)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }}>
                                      <Check size={14} color="#fff" />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: VISIBILITY & PUBLIC DURATION */}
              {activeTab === 'visibility' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Visibility & Expiry Rule</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Strict maximum 30-day public viewing window per system engineering rules.
                    </p>
                  </div>

                  <div style={{
                    backgroundColor: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Gallery Visibility State</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          When private, guest links and QR access are immediately locked.
                        </div>
                      </div>
                      <select
                        name="visibility"
                        className="form-select"
                        style={{ width: 140 }}
                        value={formData.visibility}
                        onChange={handleChange}
                      >
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                      </select>
                    </div>

                    {formData.visibility === 'public' && (
                      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            Configured Public Duration (Max 30 Days)
                          </span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-text)' }}>
                            {formData.public_duration_days} Days
                          </span>
                        </div>

                        {/* Presets */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                          {[1, 7, 14, 30].map((d) => (
                            <button
                              key={d}
                              type="button"
                              className="btn"
                              style={{
                                padding: '4px 12px',
                                fontSize: '0.75rem',
                                borderRadius: 'var(--radius-xs)',
                                border: Number(formData.public_duration_days) === d ? '1px solid var(--accent-primary)' : '1px solid var(--border-medium)',
                                backgroundColor: Number(formData.public_duration_days) === d ? 'rgba(197, 160, 89, 0.15)' : 'var(--bg-secondary)',
                                color: Number(formData.public_duration_days) === d ? 'var(--accent-text)' : 'var(--text-secondary)',
                              }}
                              onClick={() => setFormData((prev) => ({ ...prev, public_duration_days: d }))}
                            >
                              {d} {d === 1 ? 'Day' : 'Days'}
                            </button>
                          ))}
                        </div>

                        <input
                          type="range"
                          name="public_duration_days"
                          min="1"
                          max="30"
                          value={formData.public_duration_days}
                          onChange={handleChange}
                          style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                        />

                        {/* Calculated Expiry Display */}
                        <div style={{
                          marginTop: 12,
                          padding: '10px 14px',
                          backgroundColor: 'var(--bg-secondary)',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--border-subtle)',
                          fontSize: '0.78rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}>
                          <span style={{ color: 'var(--text-muted)' }}>Scheduled Public Expiry:</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {computedExpiryDate.toLocaleDateString()} at {computedExpiryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    )}

                    {formData.visibility === 'private' && (
                      <div style={{
                        borderTop: '1px solid var(--border-subtle)',
                        paddingTop: 10,
                        fontSize: '0.80rem',
                        color: 'var(--status-warning)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <AlertTriangle size={15} color="var(--status-warning)" />
                        <span>Private galleries cannot be browsed by guests. Active sessions will be revoked.</span>
                      </div>
                    )}
                  </div>

                  {/* Non-Destructive Guarantee Box */}
                  <div style={{
                    backgroundColor: 'var(--accent-subtle)',
                    border: '1px solid var(--accent-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '14px 16px',
                    fontSize: '0.80rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                  }}>
                    <strong style={{ color: 'var(--accent-text)', display: 'block', marginBottom: 4 }}>
                      Permanent Data Retention Guarantee:
                    </strong>
                    When an event's public window expires, visibility transitions automatically to <code>private</code>. All high-resolution master photographs, video assets, neural face embeddings, and photographer management tools remain 100% intact. Expiry never deletes media.
                  </div>

                  {/* Republish Action if Expired */}
                  {isExpired && (
                    <div style={{
                      backgroundColor: 'rgba(194, 65, 62, 0.08)',
                      border: '1px solid rgba(194, 65, 62, 0.25)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--status-error)' }}>
                          This gallery is currently expired
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Extend the public window for authorized client access.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleRepublish}
                        disabled={saving}
                        style={{ fontSize: '0.78rem', padding: '6px 14px' }}
                      >
                        Republish Gallery
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: PIN PROTECTION */}
              {activeTab === 'pin' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Client PIN Protection</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Enforce salted bcrypt client passcodes with server-side rate-limiting against brute force.
                    </p>
                  </div>

                  <div style={{
                    backgroundColor: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Require Event PIN</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          Guests must enter the correct PIN code to browse or download gallery photos.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        name="pin_enabled"
                        checked={formData.pin_enabled}
                        onChange={handleChange}
                        style={{ width: 18, height: 18, accentColor: 'var(--accent-primary)' }}
                      />
                    </label>

                    {formData.pin_enabled && (
                      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <label className="form-label" style={{ marginBottom: 0 }}>
                            {event.pin_protected ? 'Update PIN Code' : 'Set Event PIN Code (4–8 numeric digits) *'}
                          </label>
                          {event.pin_protected && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--status-success)' }}>
                              Currently Protected
                            </span>
                          )}
                        </div>

                        <input
                          type="password"
                          name="pin"
                          className="form-input"
                          placeholder={event.pin_protected ? 'Leave blank to preserve current PIN' : 'e.g. 8492'}
                          value={formData.pin}
                          onChange={handleChange}
                          maxLength={10}
                          style={{ letterSpacing: '0.2em' }}
                        />

                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8 }}>
                          PIN codes are securely hashed with salted bcrypt. Neither the plaintext PIN nor the hash is ever sent to guest browsers.
                        </div>

                        <div style={{
                          marginTop: 10,
                          padding: '8px 12px',
                          backgroundColor: 'rgba(217, 119, 54, 0.08)',
                          border: '1px solid rgba(217, 119, 54, 0.25)',
                          borderRadius: 'var(--radius-xs)',
                          fontSize: '0.75rem',
                          color: 'var(--status-warning)',
                        }}>
                          Changing or disabling the PIN immediately invalidates all existing guest session tokens.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: DOWNLOAD PERMISSIONS */}
              {activeTab === 'downloads' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Download Controls</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Granular server-enforced download permissions for photographs, bulk ZIP archives, and videos.
                    </p>
                  </div>

                  <div style={{
                    backgroundColor: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}>
                    {/* Master Switch */}
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.90rem' }}>Master Download Permission</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          When disabled, all guest download requests and signed URLs are rejected with HTTP 403.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        name="allow_downloads"
                        checked={formData.allow_downloads}
                        onChange={handleChange}
                        style={{ width: 18, height: 18, accentColor: 'var(--accent-primary)' }}
                      />
                    </label>

                    {formData.allow_downloads && (
                      <div style={{
                        borderTop: '1px solid var(--border-subtle)',
                        paddingTop: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                      }}>
                        {/* Individual Photo Download */}
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <ImageIcon size={16} color="var(--accent-primary)" />
                            <div>
                              <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>Individual High-Res Photo Downloads</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Guests can download single original photograph files.</div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            name="allow_photo_downloads"
                            checked={formData.allow_photo_downloads}
                            onChange={handleChange}
                            style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }}
                          />
                        </label>

                        {/* Bulk ZIP Download */}
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Download size={16} color="var(--accent-primary)" />
                            <div>
                              <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>Bulk ZIP Archive Downloads</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Guests can download entire galleries or multi-selected photos as ZIPs.</div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            name="allow_bulk_downloads"
                            checked={formData.allow_bulk_downloads}
                            onChange={handleChange}
                            style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }}
                          />
                        </label>

                        {/* Video Download */}
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Film size={16} color="var(--accent-primary)" />
                            <div>
                              <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>Video Asset Downloads</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Guests can download original video recordings where present.</div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            name="allow_video_downloads"
                            checked={formData.allow_video_downloads}
                            onChange={handleChange}
                            style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }}
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  <div style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px 14px',
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                  }}>
                    Original photographs stored in Cloudflare R2 are immutable and never modified when changing download settings. Permissions are verified cryptographically via server signed-URLs.
                  </div>
                </div>
              )}

              {/* TAB 5: WATERMARK SETTINGS */}
              {activeTab === 'watermark' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Watermark System</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Non-destructive branding overlay for guest-facing thumbnail and preview derivatives.
                    </p>
                  </div>

                  <div style={{
                    backgroundColor: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Eye size={16} color="var(--accent-primary)" />
                        <div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>Enable Preview Watermarking</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Overlays studio mark on browsing derivatives. Clean masters in R2 remain 100% untouched.
                          </div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        name="watermark_enabled"
                        checked={formData.watermark_enabled}
                        onChange={handleChange}
                        style={{ width: 18, height: 18, accentColor: 'var(--accent-primary)' }}
                      />
                    </label>

                    {formData.watermark_enabled && (
                      <div style={{
                        borderTop: '1px solid var(--border-subtle)',
                        paddingTop: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                      }}>
                        {/* Text */}
                        <div>
                          <label className="form-label" style={{ fontSize: '0.78rem', marginBottom: 4 }}>
                            Watermark Text * ({formData.watermark_text.length}/100)
                          </label>
                          <input
                            type="text"
                            name="watermark_text"
                            className="form-input"
                            maxLength={100}
                            placeholder="e.g. STUDIO LUMINA"
                            value={formData.watermark_text}
                            onChange={handleChange}
                          />
                        </div>

                        {/* Grid: Position & Scale */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div>
                            <label className="form-label" style={{ fontSize: '0.78rem', marginBottom: 4 }}>Position</label>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {[
                                { id: 'bottom-right', label: 'Bottom Right' },
                                { id: 'bottom-center', label: 'Bottom Center' },
                                { id: 'center', label: 'Center' },
                              ].map((pos) => (
                                <button
                                  key={pos.id}
                                  type="button"
                                  className="btn"
                                  style={{
                                    flex: 1,
                                    padding: '5px 4px',
                                    fontSize: '0.70rem',
                                    borderRadius: 'var(--radius-xs)',
                                    border: formData.watermark_position === pos.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-medium)',
                                    backgroundColor: formData.watermark_position === pos.id ? 'rgba(197, 160, 89, 0.15)' : 'var(--bg-secondary)',
                                    color: formData.watermark_position === pos.id ? 'var(--accent-text)' : 'var(--text-secondary)',
                                    fontWeight: formData.watermark_position === pos.id ? 600 : 400,
                                  }}
                                  onClick={() => setFormData((prev) => ({ ...prev, watermark_position: pos.id }))}
                                >
                                  {pos.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="form-label" style={{ fontSize: '0.78rem', marginBottom: 4 }}>Scale</label>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {[
                                { id: 'small', label: 'Small' },
                                { id: 'medium', label: 'Medium' },
                                { id: 'large', label: 'Large' },
                              ].map((sz) => (
                                <button
                                  key={sz.id}
                                  type="button"
                                  className="btn"
                                  style={{
                                    flex: 1,
                                    padding: '5px 4px',
                                    fontSize: '0.70rem',
                                    borderRadius: 'var(--radius-xs)',
                                    border: formData.watermark_size === sz.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-medium)',
                                    backgroundColor: formData.watermark_size === sz.id ? 'rgba(197, 160, 89, 0.15)' : 'var(--bg-secondary)',
                                    color: formData.watermark_size === sz.id ? 'var(--accent-text)' : 'var(--text-secondary)',
                                    fontWeight: formData.watermark_size === sz.id ? 600 : 400,
                                  }}
                                  onClick={() => setFormData((prev) => ({ ...prev, watermark_size: sz.id }))}
                                >
                                  {sz.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Tone & Opacity */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center' }}>
                          <div>
                            <label className="form-label" style={{ fontSize: '0.78rem', marginBottom: 4 }}>Tone</label>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {[
                                { id: 'white', label: 'White' },
                                { id: 'black', label: 'Black' },
                              ].map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  className="btn"
                                  style={{
                                    flex: 1,
                                    padding: '5px 8px',
                                    fontSize: '0.72rem',
                                    borderRadius: 'var(--radius-xs)',
                                    border: formData.watermark_color === c.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-medium)',
                                    backgroundColor: formData.watermark_color === c.id ? 'rgba(197, 160, 89, 0.15)' : 'var(--bg-secondary)',
                                    color: formData.watermark_color === c.id ? 'var(--accent-text)' : 'var(--text-secondary)',
                                  }}
                                  onClick={() => setFormData((prev) => ({ ...prev, watermark_color: c.id }))}
                                >
                                  {c.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <label className="form-label" style={{ fontSize: '0.78rem', marginBottom: 0 }}>Opacity</label>
                              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-text)' }}>
                                {Math.round(formData.watermark_opacity * 100)}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0.05"
                              max="1.0"
                              step="0.05"
                              value={formData.watermark_opacity}
                              onChange={(e) => setFormData((prev) => ({ ...prev, watermark_opacity: parseFloat(e.target.value) }))}
                              style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                            />
                          </div>
                        </div>

                        {/* Live Simulation Box */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                              Live Derivative Simulation
                            </span>
                          </div>
                          <div style={{
                            position: 'relative',
                            height: 120,
                            borderRadius: 'var(--radius-xs)',
                            overflow: 'hidden',
                            border: '1px solid var(--border-medium)',
                            background: 'linear-gradient(135deg, #18191d 0%, #25221c 50%, #111215 100%)',
                            boxShadow: 'inset 0 0 20px rgba(0,0,0,0.6)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <div style={{
                              position: 'absolute',
                              ...(formData.watermark_position === 'bottom-right' ? {
                                bottom: 10,
                                right: 12,
                                textAlign: 'right',
                              } : formData.watermark_position === 'bottom-center' ? {
                                bottom: 10,
                                left: '50%',
                                transform: 'translateX(-50%)',
                                textAlign: 'center',
                              } : {
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                textAlign: 'center',
                              }),
                              color: formData.watermark_color === 'white' ? '#ffffff' : '#000000',
                              opacity: formData.watermark_opacity,
                              fontSize: formData.watermark_size === 'small' ? '0.70rem' : formData.watermark_size === 'large' ? '1.05rem' : '0.85rem',
                              fontFamily: "'Plus Jakarta Sans', sans-serif",
                              fontWeight: 600,
                              letterSpacing: '0.14em',
                              textTransform: 'uppercase',
                              textShadow: formData.watermark_color === 'white'
                                ? '0 1px 3px rgba(0,0,0,0.85), 0 0 8px rgba(0,0,0,0.6)'
                                : '0 1px 3px rgba(255,255,255,0.7), 0 0 8px rgba(255,255,255,0.4)',
                              pointerEvents: 'none',
                              maxWidth: '90%',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}>
                              {formData.watermark_text || 'STUDIO LUMINA'}
                            </div>
                          </div>
                        </div>

                        {/* Reprocess Actions */}
                        <div style={{
                          paddingTop: 10,
                          borderTop: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {reprocessStatus ? `${reprocessStatus.pending} photo(s) pending sync` : 'Derivatives up to date'}
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleReprocess}
                            disabled={reprocessing || saving}
                            style={{ fontSize: '0.75rem', padding: '5px 12px' }}
                          >
                            <RefreshCw size={13} style={{ animation: reprocessing ? 'spin 1s linear infinite' : 'none' }} />
                            <span>{reprocessing ? 'Syncing...' : 'Reprocess Photos'}</span>
                          </button>
                        </div>

                        {reprocessMessage && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--accent-text)', backgroundColor: 'rgba(197, 160, 89, 0.1)', padding: '6px 10px', borderRadius: 'var(--radius-xs)' }}>
                            {reprocessMessage}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 6: AI FACE SEARCH */}
              {activeTab === 'face_search' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>AI Biometric Face Search</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Enable or disable guest selfie matching powered by OpenCV YuNet + SFace.
                    </p>
                  </div>

                  <div style={{
                    backgroundColor: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '16px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Sparkles size={16} color="var(--accent-primary)" />
                        <div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>Enable "Find My Photos" Guest Search</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Allows guests to capture an ephemeral selfie and find all photos they appear in.
                          </div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        name="face_search_enabled"
                        checked={formData.face_search_enabled}
                        onChange={handleChange}
                        style={{ width: 18, height: 18, accentColor: 'var(--accent-primary)' }}
                      />
                    </label>

                    {!formData.face_search_enabled && (
                      <div style={{
                        marginTop: 4,
                        padding: '10px 14px',
                        backgroundColor: 'rgba(194, 65, 62, 0.08)',
                        border: '1px solid rgba(194, 65, 62, 0.25)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: '0.78rem',
                        color: 'var(--status-error)',
                      }}>
                        Guest face search button is hidden. Any incoming face search API calls for this event will be rejected with HTTP 403. Existing photo embeddings remain indexed and ready to re-enable at any time.
                      </div>
                    )}
                  </div>

                  {/* Biometric Privacy Pillars */}
                  <div style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '14px 16px',
                    fontSize: '0.78rem',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Biometric Architecture & Privacy:</strong>
                    <div>• <strong>Zero Guest Selfie Retention:</strong> Guest selfies are held strictly in RAM during vector generation and immediately deleted. Never saved to disk or Cloudflare R2.</div>
                    <div>• <strong>Strict Event Isolation:</strong> Similarity queries enforce <code>WHERE event_id = :current_event_id</code>. Guests from this event can never view matches from any other gallery.</div>
                    <div>• <strong>Group Photo Matching:</strong> If a guest matches any face in a group shot, the entire high-resolution photograph is returned.</div>
                  </div>
                </div>
              )}

              {/* TAB 7: LIFECYCLE & ARCHIVE */}
              {activeTab === 'lifecycle' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Event Lifecycle & Retention</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Distinct workflows for Archiving, Recycle Bin, and Permanent Deletion.
                    </p>
                  </div>

                  {/* Current Status Box */}
                  <div style={{
                    backgroundColor: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '16px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Current Lifecycle State</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Status: <strong style={{ textTransform: 'uppercase', color: 'var(--accent-text)' }}>{formData.status}</strong>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleArchiveToggle}
                        disabled={lifecycleActionLoading || saving}
                        style={{ fontSize: '0.78rem', padding: '6px 14px' }}
                      >
                        <Archive size={14} />
                        <span>{formData.status === 'archived' ? 'Unarchive Gallery' : 'Archive Gallery'}</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={handleMoveToTrash}
                        disabled={lifecycleActionLoading || saving}
                        style={{ fontSize: '0.78rem', padding: '6px 14px', color: 'var(--status-error)' }}
                      >
                        <Trash2 size={14} />
                        <span>Move to Recycle Bin</span>
                      </button>
                    </div>
                  </div>

                  {/* Architectural Lifecycle Definitions */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '14px 16px',
                    }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-text)', marginBottom: 4 }}>
                        Archived State
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                        Event is hidden from normal guest access and marked inactive, but remains safely organized in your photographer dashboard indefinitely. Never scheduled for automated deletion.
                      </p>
                    </div>

                    <div style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '14px 16px',
                    }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--status-error)', marginBottom: 4 }}>
                        Recycle Bin State
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                        Event is removed from active dashboards and scheduled for automated background purge after a 30-day grace retention window. Can be restored at any time prior to purge.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 8: PROOFING & SELECTION */}
              {activeTab === 'selection' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Client Proofing & Photo Selection</h4>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Enable client selection, specify package limits, manage review deadlines, and configure approval rules.
                    </p>
                  </div>

                  {/* Mode Selector */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Client Selection Mode</label>
                    <select
                      name="client_selection_mode"
                      className="form-input"
                      value={formData.client_selection_mode}
                      onChange={handleChange}
                    >
                      <option value="disabled">Disabled (Gallery & Downloads only)</option>
                      <option value="favorites_only">Favorites Only (Guests can save favorites, no formal submission)</option>
                      <option value="selection_required">Selection Workflow (Formal submission & approval, unlimited count)</option>
                      <option value="package_quota">Selection + Package Quota (Strict photo count limit enforced)</option>
                    </select>
                  </div>

                  {formData.client_selection_mode !== 'disabled' && (
                    <>
                      {/* Package Quota Details */}
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Package Name</label>
                          <input
                            type="text"
                            name="selection_package_name"
                            className="form-input"
                            value={formData.selection_package_name}
                            onChange={handleChange}
                            placeholder="e.g. Signature Wedding Collection"
                          />
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Package Quota (Max)</label>
                          <input
                            type="number"
                            name="selection_package_quota"
                            className="form-input"
                            min="0"
                            value={formData.selection_package_quota}
                            onChange={handleChange}
                            placeholder="0 = Unlimited"
                          />
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>0 = Unlimited</span>
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Minimum Required</label>
                          <input
                            type="number"
                            name="selection_min_quota"
                            className="form-input"
                            min="0"
                            value={formData.selection_min_quota}
                            onChange={handleChange}
                            placeholder="0 = None"
                          />
                        </div>
                      </div>

                      {/* Deadline & Instructions */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Selection Deadline (Optional)</label>
                          <input
                            type="datetime-local"
                            name="selection_deadline"
                            className="form-input"
                            value={formData.selection_deadline ? formData.selection_deadline.substring(0, 16) : ''}
                            onChange={handleChange}
                          />
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            Clients will be reminded of this deadline in their selection panel.
                          </span>
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Client Selection Instructions</label>
                          <textarea
                            name="selection_instructions"
                            className="form-input"
                            rows={3}
                            value={formData.selection_instructions}
                            onChange={handleChange}
                            placeholder="e.g. Please select 300 of your favorite images for your bespoke fine-art heirloom album. We recommend at least 50 ceremony photos."
                          />
                        </div>
                      </div>

                      {/* Workflow Toggles */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            name="selection_allow_extra"
                            checked={formData.selection_allow_extra}
                            onChange={handleChange}
                            style={{ marginTop: 3 }}
                          />
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              Allow Extra Photos Beyond Quota
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Clients can select more than the package limit, flagged for photographer review.
                            </div>
                          </div>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            name="selection_allow_changes_after_submission"
                            checked={formData.selection_allow_changes_after_submission}
                            onChange={handleChange}
                            style={{ marginTop: 3 }}
                          />
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              Allow Edits After Submission
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              If unchecked, the selection is immediately locked until you request changes.
                            </div>
                          </div>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            name="selection_requires_approval"
                            checked={formData.selection_requires_approval}
                            onChange={handleChange}
                            style={{ marginTop: 3 }}
                          />
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              Require Photographer Approval
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              You must formally approve the selection before final delivery can proceed.
                            </div>
                          </div>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            name="selection_multiple_rounds"
                            checked={formData.selection_multiple_rounds}
                            onChange={handleChange}
                            style={{ marginTop: 3 }}
                          />
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              Allow Multiple Revision Rounds
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Enables change-request cycles where clients can replace duplicate photos or adjust choices.
                            </div>
                          </div>
                        </label>
                      </div>
                    </>
                  )}
                </div>
              )}

            </form>
          </div>
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Changes take effect on the server immediately after saving.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={saving}
              style={{ padding: '8px 16px', fontSize: '0.85rem' }}
            >
              Cancel
            </button>

            <button
              type="submit"
              form="event-settings-form"
              className="btn btn-primary"
              disabled={saving}
              style={{ padding: '8px 20px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Save size={15} />
              <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
