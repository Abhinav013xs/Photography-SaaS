import React, { useState } from 'react';
import { Camera, ArrowRight, AlertCircle } from 'lucide-react';
import api from '../api.js';

export default function LoginView({ onLoginSuccess }) {
  const [email, setEmail] = useState('photographer@studiolumina.photo');
  const [password, setPassword] = useState('photographer123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.login(email, password);
      onLoginSuccess(res?.photographer || res?.data?.photographer);
    } catch (err) {
      const msg = err.message || '';
      if (
        msg.toLowerCase().includes('failed to fetch') ||
        msg.toLowerCase().includes('networkerror') ||
        err.status === 502 ||
        err.status === 504
      ) {
        setError('Cannot connect to API server. Please ensure the backend server is running on port 5000.');
      } else {
        setError(msg || 'Invalid credentials');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--bg-primary)',
      padding: 24,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Subtle Ambient Glow */}
      <div
        style={{
          position: 'absolute',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167, 139, 250, 0.08) 0%, rgba(125, 211, 252, 0.05) 50%, transparent 70%)',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }}
      />

      <div className="glass-panel-strong login-card-container">
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 50,
            height: 50,
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--accent-subtle)',
            border: '1px solid var(--accent-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-primary)',
            boxShadow: '0 4px 14px rgba(167, 139, 250, 0.20)',
            margin: '0 auto 18px',
          }}>
            <Camera size={24} />
          </div>

          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.95rem',
            fontWeight: 600,
            letterSpacing: '0.04em',
            lineHeight: 1.1,
            color: 'var(--text-primary)',
          }}>
            STUDIO LUMINA
          </h1>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 6, fontWeight: 600 }}>
            Photographer Portal & Master Dashboard
          </p>
        </div>

        {error && (
          <div style={{
            backgroundColor: 'rgba(194, 65, 62, 0.10)',
            border: '1px solid var(--status-error)',
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--status-error)',
            fontSize: '0.85rem',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Photographer Email</label>
            <div style={{ position: 'relative' }}>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', height: 42, fontSize: '0.92rem' }}
            disabled={loading}
          >
            <span>{loading ? 'Authenticating...' : 'Sign In to Dashboard'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <div style={{
          marginTop: 24,
          paddingTop: 18,
          borderTop: '1px solid var(--border-subtle)',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          lineHeight: 1.5,
        }}>
          Default credentials pre-filled for evaluation.<br />
          To set your own credentials, configure <code>.env.local</code> or run <code>npm run set-credentials</code>.
        </div>
      </div>
    </div>
  );
}
