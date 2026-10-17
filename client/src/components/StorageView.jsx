import React, { useState, useEffect } from 'react';
import {
  HardDrive, Image, Film, Layers, ExternalLink,
  ShieldCheck, AlertTriangle, Cloud, ArrowRight
} from 'lucide-react';
import api from '../api.js';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function StorageView({ onSelectEvent }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStorage() {
      try {
        setLoading(true);
        const res = await api.getStorageOverview();
        setData(res);
      } catch (err) {
        console.error('Failed to load storage overview:', err);
      } finally {
        setLoading(false);
      }
    }
    loadStorage();
  }, []);

  if (loading || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
        Loading storage usage & Cloudflare R2 metrics...
      </div>
    );
  }

  const { metrics, eventBreakdown, cloudflare } = data;

  return (
    <div>
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Cloudflare R2 Storage & Infrastructure
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>
            Direct photographer-owned Cloudflare R2 bucket with zero egress fees and real-time measured bytes.
          </p>
        </div>

        {/* Manage Storage & Billing Button */}
        <a
          href={cloudflare.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{ padding: '10px 20px', fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <Cloud size={16} />
          <span>Cloudflare R2 Dashboard</span>
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Cloudflare Connection Status Card */}
      <div
        className="glass-panel"
        style={{
          borderRadius: 'var(--radius-md)',
          padding: '22px 26px',
          marginBottom: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 46,
            height: 46,
            borderRadius: 'var(--radius-sm)',
            backgroundColor: cloudflare.isConfigured ? 'rgba(42, 157, 143, 0.10)' : 'rgba(217, 119, 54, 0.10)',
            border: `1px solid ${cloudflare.isConfigured ? 'rgba(42, 157, 143, 0.3)' : 'rgba(217, 119, 54, 0.3)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: cloudflare.isConfigured ? 'var(--status-success)' : 'var(--status-warning)',
          }}>
            {cloudflare.isConfigured ? <ShieldCheck size={24} /> : <AlertTriangle size={24} />}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 600, fontSize: '1.02rem', color: 'var(--text-primary)' }}>
                {cloudflare.isConfigured ? 'Cloudflare R2 Direct Connected' : 'Operating in Local Storage Adapter Mode'}
              </span>
              <span className={`badge ${cloudflare.isConfigured ? 'badge-public' : 'badge-archived'}`}>
                {cloudflare.isConfigured ? 'Production R2' : 'Local Fallback'}
              </span>
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              Bucket: <code style={{ color: 'var(--accent-text)' }}>{cloudflare.bucketName}</code> • Account ID: <code>{cloudflare.accountId}</code>
              {' '}• Zero-egress fee architecture
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a
            href={cloudflare.billingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span>Cloudflare Invoices</span>
            <ExternalLink size={13} />
          </a>
        </div>
      </div>

      {/* Storage Breakdown Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 16,
        marginBottom: 32,
      }}>
        {/* Total */}
        <div
          className="glass-panel"
          style={{
            borderRadius: 'var(--radius-md)',
            padding: '22px 24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
              Total Storage Used
            </span>
            <HardDrive size={18} color="var(--accent-primary)" />
          </div>
          <div style={{ fontSize: '2.1rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 8, letterSpacing: '-0.02em' }}>
            {formatBytes(metrics.totalBytes)}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Direct R2 object storage usage
          </div>
        </div>

        {/* Photos */}
        <div
          className="glass-panel"
          style={{
            borderRadius: 'var(--radius-md)',
            padding: '22px 24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Photo Originals
            </span>
            <Image size={18} color="var(--accent-primary)" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 8 }}>
            {formatBytes(metrics.photoBytes)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {metrics.photoCount} High-resolution photos
          </div>
        </div>

        {/* Videos */}
        <div
          className="glass-panel"
          style={{
            borderRadius: 'var(--radius-md)',
            padding: '22px 24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
              Video Assets
            </span>
            <Film size={18} color="var(--text-secondary)" />
          </div>
          <div style={{ fontSize: '2.1rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 8, letterSpacing: '-0.02em' }}>
            {formatBytes(metrics.videoBytes)}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {metrics.videoCount} Video files
          </div>
        </div>

        {/* Derivatives / Other */}
        <div
          className="glass-panel"
          style={{
            borderRadius: 'var(--radius-md)',
            padding: '22px 24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
              Derivatives / Previews
            </span>
            <Layers size={18} color="var(--text-secondary)" />
          </div>
          <div style={{ fontSize: '2.1rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 8, letterSpacing: '-0.02em' }}>
            {formatBytes(metrics.derivativesBytes)}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Thumbnails & compressed WebP
          </div>
        </div>
      </div>

      {/* Event Breakdown Table */}
      <div
        className="glass-panel"
        style={{
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          marginBottom: 32,
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>Event Storage Distribution</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
            Storage consumed per client gallery in Cloudflare R2.
          </p>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', textTransform: 'uppercase', fontSize: '0.72rem', letterSpacing: '0.05em' }}>
                <th style={{ padding: '12px 20px' }}>Event Name</th>
                <th style={{ padding: '12px 20px' }}>Client</th>
                <th style={{ padding: '12px 20px' }}>Status</th>
                <th style={{ padding: '12px 20px' }}>Items</th>
                <th style={{ padding: '12px 20px' }}>Storage</th>
                <th style={{ padding: '12px 20px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {eventBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No events stored yet.
                  </td>
                </tr>
              ) : (
                eventBreakdown.map((item) => (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      transition: 'background-color var(--transition-fast)',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-card-hover)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td style={{ padding: '14px 20px', fontWeight: 500 }}>
                      {item.name}
                    </td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>
                      {item.client_name}
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span className={`badge badge-${item.status}`}>
                        {item.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>
                      {item.media_count} files
                    </td>
                    <td style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {formatBytes(item.original_bytes)}
                    </td>
                    <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                      <button
                        className="btn btn-ghost"
                        onClick={() => onSelectEvent(item.id)}
                        style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                      >
                        <span>View</span>
                        <ArrowRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
