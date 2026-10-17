import React, { useState } from 'react';
import { X, Plus, AlertCircle } from 'lucide-react';
import api from '../api.js';

export default function CreateEventModal({ onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: '',
    client_name: '',
    client_email: '',
    event_date: new Date().toISOString().split('T')[0],
    location: '',
    description: '',
    visibility: 'public',
    public_days: 30,
    pin_enabled: false,
    pin: '',
    allow_downloads: true,
    watermark_enabled: false,
    watermark_text: 'Studio Lumina',
    face_search_enabled: true,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.name.trim() || !formData.client_name.trim()) {
      setError('Event name and client name are required.');
      return;
    }

    if (formData.pin_enabled && !formData.pin.trim()) {
      setError('Please provide a PIN code (4-8 digits) since PIN protection is enabled.');
      return;
    }

    const payload = {
      name: formData.name.trim(),
      client_name: formData.client_name.trim(),
      client_email: formData.client_email.trim() || null,
      event_date: formData.event_date,
      location: formData.location.trim() || null,
      description: formData.description.trim() || null,
      visibility: formData.visibility || 'public',
      status: 'active',
      public_duration_days: Math.min(Math.max(parseInt(formData.public_days, 10) || 30, 1), 30),
      public_days: Math.min(Math.max(parseInt(formData.public_days, 10) || 30, 1), 30),
      pin_enabled: Boolean(formData.pin_enabled),
      pin: formData.pin_enabled && formData.pin.trim() ? formData.pin.trim() : null,
      allow_downloads: Boolean(formData.allow_downloads),
      watermark_enabled: Boolean(formData.watermark_enabled),
      watermark_text: formData.watermark_text.trim() || 'Studio Lumina',
      face_search_enabled: Boolean(formData.face_search_enabled),
    };

    try {
      setSaving(true);
      const res = await api.createEvent(payload);
      const createdEvent = res?.event || res?.data?.event || res;
      if (onCreated) onCreated(createdEvent);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1200 }}>
      <div className="modal-container glass-panel-strong" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, borderRadius: 'var(--radius-lg)' }}>
        <div className="modal-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}>
          <div>
            <h3 className="modal-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', letterSpacing: '-0.01em' }}>
              Create Photography Event
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Creates an isolated gallery container with deterministic R2 storage and biometric index.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
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
              }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-grid-2">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Event Name *</label>
                <input
                  type="text"
                  name="name"
                  className="form-input"
                  placeholder="e.g. Rahul & Priya Wedding"
                  value={formData.name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Client Name *</label>
                <input
                  type="text"
                  name="client_name"
                  className="form-input"
                  placeholder="e.g. Rahul Sharma"
                  value={formData.client_name}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="form-grid-2">
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
                <label className="form-label">Location</label>
                <input
                  type="text"
                  name="location"
                  className="form-input"
                  placeholder="e.g. Lake Palace, Udaipur"
                  value={formData.location}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 4 }}>
              <label className="form-label">Description / Note</label>
              <textarea
                name="description"
                className="form-textarea"
                placeholder="Optional notes or client welcome message..."
                value={formData.description}
                onChange={handleChange}
                rows={2}
              />
            </div>

            {/* Public Duration Rule */}
            <div style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                  Public Viewing Window (Max 30 Days)
                </span>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-text)' }}>
                  {formData.public_days} Days
                </span>
              </div>
              <input
                type="range"
                name="public_days"
                min="1"
                max="30"
                value={formData.public_days}
                onChange={handleChange}
                style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                System automatically transitions gallery to private upon expiration. Photographer retains permanent access.
              </div>
            </div>

            {/* PIN Protection */}
            <div style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
            }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.88rem' }}>Protect with Event PIN</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Requires guests to enter a security PIN before viewing photos.
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
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                  <label className="form-label">Set Event PIN (4-8 digits)</label>
                  <input
                    type="password"
                    name="pin"
                    className="form-input"
                    placeholder="e.g. 7392"
                    value={formData.pin}
                    onChange={handleChange}
                    maxLength={10}
                  />
                </div>
              )}
            </div>

            {/* Permissions */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}>
              <label style={{
                backgroundColor: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>Allow Downloads</span>
                <input
                  type="checkbox"
                  name="allow_downloads"
                  checked={formData.allow_downloads}
                  onChange={handleChange}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }}
                />
              </label>

              <label style={{
                backgroundColor: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>AI Face Search</span>
                <input
                  type="checkbox"
                  name="face_search_enabled"
                  checked={formData.face_search_enabled}
                  onChange={handleChange}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }}
                />
              </label>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Plus size={16} />
              <span>{saving ? 'Creating Event...' : 'Create Gallery'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
