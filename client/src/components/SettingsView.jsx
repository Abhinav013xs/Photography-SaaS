import React, { useState } from 'react';
import { User, Lock, Save, CheckCircle2, AlertCircle, Cloud } from 'lucide-react';
import api from '../api.js';

export default function SettingsView({ photographer, onProfileUpdated }) {
  const [formData, setFormData] = useState({
    email: photographer?.email || '',
    business_name: photographer?.business_name || '',
    tagline: photographer?.tagline || '',
    bio: photographer?.bio || '',
    website: photographer?.website || '',
    instagram: photographer?.instagram || '',
    current_password: '',
    new_password: '',
  });

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    try {
      setSaving(true);
      const res = await api.updateProfile(formData);
      if (onProfileUpdated) onProfileUpdated(res.photographer);
      setSuccess(true);
      setFormData((prev) => ({ ...prev, current_password: '', new_password: '' }));
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 600 }}>
          Photographer Account & Profile
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
          Manage your photography studio brand, public watermarks, and credentials.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          marginBottom: 24,
        }}>
          {success && (
            <div style={{
              backgroundColor: 'rgba(42, 157, 143, 0.08)',
              border: '1px solid rgba(42, 157, 143, 0.3)',
              padding: '12px 16px',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--status-success)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '0.88rem',
            }}>
              <CheckCircle2 size={16} />
              <span>Profile updated successfully!</span>
            </div>
          )}

          {error && (
            <div style={{
              backgroundColor: 'rgba(194, 65, 62, 0.08)',
              border: '1px solid rgba(194, 65, 62, 0.25)',
              padding: '12px 16px',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--status-error)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '0.88rem',
            }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Photographer Login Email</label>
            <input
              type="email"
              name="email"
              className="form-input"
              value={formData.email}
              onChange={handleChange}
              required
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Used to authenticate into the Photographer Master Dashboard.
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Studio / Business Name</label>
              <input
                type="text"
                name="business_name"
                className="form-input"
                value={formData.business_name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Tagline</label>
              <input
                type="text"
                name="tagline"
                className="form-input"
                value={formData.tagline}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">About / Studio Bio</label>
            <textarea
              name="bio"
              className="form-textarea"
              value={formData.bio}
              onChange={handleChange}
              rows={3}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Portfolio Website</label>
              <input
                type="text"
                name="website"
                className="form-input"
                value={formData.website}
                onChange={handleChange}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Instagram Handle</label>
              <input
                type="text"
                name="instagram"
                className="form-input"
                value={formData.instagram}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Password update section */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
              Security & Password
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Current Password</label>
                <input
                  type="password"
                  name="current_password"
                  className="form-input"
                  placeholder="Enter to change password"
                  value={formData.current_password}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  name="new_password"
                  className="form-input"
                  placeholder="Min 8 characters"
                  value={formData.new_password}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Save size={15} />
              <span>{saving ? 'Saving...' : 'Save Profile Changes'}</span>
            </button>
          </div>
        </div>
      </form>

      {/* Cloudflare Configuration Reference */}
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        padding: '20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Cloud size={18} color="var(--accent-primary)" />
          <span style={{ fontSize: '0.92rem', fontWeight: 600 }}>Cloudflare R2 Direct Integration</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          To connect your Cloudflare R2 bucket directly, add the following environment variables to your <code>.env</code> file:
        </p>
        <pre style={{
          backgroundColor: 'var(--surface-input)',
          border: '1px solid var(--border-subtle)',
          padding: '12px 16px',
          borderRadius: 'var(--radius-xs)',
          fontSize: '0.78rem',
          color: 'var(--accent-text)',
          marginTop: 10,
          overflowX: 'auto',
          lineHeight: 1.5,
        }}>
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=your_r2_bucket_name
R2_PUBLIC_DOMAIN=https://gallery.yourdomain.com
        </pre>
      </div>
    </div>
  );
}
