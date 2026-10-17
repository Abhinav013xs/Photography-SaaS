import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  ExternalLink,
  QrCode as QrIcon,
  Shield,
  Clock,
  Printer,
  Globe,
  Lock,
  AlertTriangle,
  FileCode,
} from 'lucide-react';
import api from '../api.js';

function sanitizeFilename(name, ext) {
  const rawClean = (name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '');
  const hasAlphanumeric = /[a-zA-Z0-9]/.test(rawClean);
  return `${hasAlphanumeric ? rawClean : 'Event'}_QR.${ext}`;
}

export default function QrModal({ event, onClose }) {
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copyFallbackNotice, setCopyFallbackNotice] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    async function fetchQr() {
      try {
        setLoading(true);
        setError(null);
        const res = await api.getEventQr(event.id);
        const data = res?.data || res;
        setQrData(data);
      } catch (err) {
        console.error('Failed to load QR:', err);
        setError(err.message || 'Failed to generate QR code');
      } finally {
        setLoading(false);
      }
    }
    fetchQr();
  }, [event.id]);

  const handleCopy = async () => {
    if (!qrData?.shareUrl) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(qrData.shareUrl);
        setCopied(true);
        setCopyFallbackNotice(null);
        setTimeout(() => setCopied(false), 2000);
      } else {
        fallbackCopy();
      }
    } catch {
      fallbackCopy();
    }
  };

  const fallbackCopy = () => {
    if (inputRef.current) {
      inputRef.current.select();
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          setCopied(true);
          setCopyFallbackNotice(null);
          setTimeout(() => setCopied(false), 2000);
        } else {
          setCopyFallbackNotice('Link selected. Press Ctrl+C (Cmd+C) to copy.');
        }
      } catch {
        setCopyFallbackNotice('Link selected. Press Ctrl+C (Cmd+C) to copy.');
      }
    }
  };

  const handleDownloadPng = () => {
    if (!qrData?.qrDataUrl) return;
    const filename = sanitizeFilename(event.name, 'png');
    const a = document.createElement('a');
    a.href = qrData.qrDataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownloadSvg = () => {
    if (!qrData?.qrSvg) return;
    const filename = sanitizeFilename(event.name, 'svg');
    const blob = new Blob([qrData.qrSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  // Determine access status description and badge
  const isExpired = qrData?.isExpired ?? (event.public_until && new Date(event.public_until).getTime() < Date.now());
  const isPrivate = (qrData?.visibility || event.visibility) === 'private';
  const pinProtected = Boolean(qrData?.pinProtected ?? event.pin_protected ?? event.pin_enabled);

  return (
    <>
      {/* On-screen Modal View */}
      <div className="modal-backdrop no-print" onClick={onClose} style={{ zIndex: 1200 }}>
        <div
          className="modal-container glass-panel-strong no-print"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 540, width: '92%', borderRadius: 'var(--radius-lg)' }}
        >
          {/* Modal Header */}
          <div className="modal-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--accent-subtle)',
                border: '1px solid var(--accent-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <QrIcon size={18} color="var(--accent-primary)" />
              </div>
              <h3 className="modal-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem' }}>
                Event Share & QR Code
              </h3>
            </div>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
              <X size={18} />
            </button>
          </div>

          {/* Modal Body */}
          <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center', padding: '16px 20px' }}>
            <div style={{ marginBottom: 8, width: '100%' }}>
              <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.45rem', fontWeight: 600, margin: '0 0 4px 0' }}>
                {event.name}
              </h4>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                Client: {event.client_name} • {event.event_date}
              </p>
            </div>

            {/* Access State Banner */}
            <div
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 12,
                fontSize: '0.78rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textAlign: 'left',
                lineHeight: 1.35,
                background: isExpired
                  ? 'rgba(231, 111, 81, 0.12)'
                  : isPrivate
                  ? 'rgba(107, 114, 128, 0.12)'
                  : pinProtected
                  ? 'rgba(197, 160, 89, 0.12)'
                  : 'rgba(46, 196, 182, 0.12)',
                border: `1px solid ${
                  isExpired
                    ? 'rgba(231, 111, 81, 0.3)'
                    : isPrivate
                    ? 'rgba(107, 114, 128, 0.3)'
                    : pinProtected
                    ? 'rgba(197, 160, 89, 0.3)'
                    : 'rgba(46, 196, 182, 0.3)'
                }`,
                color: isExpired
                  ? 'var(--status-warning)'
                  : isPrivate
                  ? 'var(--text-secondary)'
                  : pinProtected
                  ? 'var(--accent-text)'
                  : 'var(--status-success)',
              }}
            >
              {isExpired ? (
                <>
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Gallery Expired</strong> — Public access has ended. Republish the event in settings to restore guest access.
                  </span>
                </>
              ) : isPrivate ? (
                <>
                  <Lock size={15} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Private Gallery</strong> — Guests cannot view photos until you set gallery visibility to Public.
                  </span>
                </>
              ) : pinProtected ? (
                <>
                  <Shield size={15} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>PIN Protected</strong> — Guests must enter the PIN to unlock photos. (The PIN is never embedded in the QR or link).
                  </span>
                </>
              ) : (
                <>
                  <Globe size={15} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Public Access</strong> — Anyone with this link or QR code can view event photos.
                  </span>
                </>
              )}
            </div>

            {/* QR Code Container */}
            <div
              style={{
                background: '#ffffff',
                padding: 16,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-medium)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-md)',
                margin: '4px 0 12px 0',
              }}
            >
              {loading ? (
                <div style={{ width: 'min(220px, 60vw)', height: 'min(220px, 60vw)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: '0.85rem' }}>
                  Generating QR code...
                </div>
              ) : error ? (
                <div style={{ width: 'min(220px, 60vw)', height: 'min(220px, 60vw)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#c00', fontSize: '0.82rem', padding: 12 }}>
                  <AlertTriangle size={24} style={{ marginBottom: 6 }} />
                  <span>{error}</span>
                </div>
              ) : qrData?.qrDataUrl ? (
                <img
                  src={qrData.qrDataUrl}
                  alt="Event QR Code"
                  style={{ width: 'min(220px, 60vw)', height: 'min(220px, 60vw)', display: 'block', imageRendering: 'pixelated' }}
                />
              ) : (
                <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                  QR code unavailable
                </div>
              )}
            </div>

            {/* Share Link Box with Input and Copy */}
            <div
              style={{
                width: '100%',
                backgroundColor: 'var(--surface-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 8px 6px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <input
                ref={inputRef}
                type="text"
                readOnly
                value={qrData?.shareUrl || ''}
                placeholder="Generating link..."
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.82rem',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  cursor: 'text',
                }}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="btn btn-secondary"
                onClick={handleCopy}
                disabled={!qrData?.shareUrl}
                style={{ padding: '6px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap', flexShrink: 0 }}
                title="Copy canonical link to clipboard"
              >
                {copied ? <Check size={14} color="var(--status-success)" /> : <Copy size={14} />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>

            {copyFallbackNotice && (
              <p style={{ fontSize: '0.75rem', color: 'var(--status-warning)', margin: '6px 0 0 0' }}>
                {copyFallbackNotice}
              </p>
            )}

            {/* Metadata Indicators */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                marginTop: 10,
                fontSize: '0.76rem',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Shield size={12} color={pinProtected ? 'var(--accent-primary)' : 'var(--text-muted)'} />
                {pinProtected ? 'PIN Protected' : 'No PIN'}
              </span>
              {event.public_until && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={12} />
                  {isExpired ? 'Expired' : `Expires ${new Date(event.public_until).toLocaleDateString()}`}
                </span>
              )}
            </div>
          </div>

          {/* Modal Footer with Actions */}
          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '12px 20px' }}>
            <a
              href={qrData?.shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{ fontSize: '0.80rem', padding: '6px 10px' }}
            >
              <ExternalLink size={13} />
              <span>Preview Gallery</span>
            </a>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                onClick={handlePrint}
                disabled={!qrData?.qrDataUrl}
                style={{ fontSize: '0.78rem', padding: '6px 10px' }}
                title="Print display sign with QR code and event title"
              >
                <Printer size={13} />
                <span>Print Sign</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={handleDownloadSvg}
                disabled={!qrData?.qrSvg}
                style={{ fontSize: '0.78rem', padding: '6px 10px' }}
                title="Download crisp vector SVG"
              >
                <FileCode size={13} />
                <span>SVG</span>
              </button>

              <button
                className="btn btn-primary"
                onClick={handleDownloadPng}
                disabled={!qrData?.qrDataUrl}
                style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                title="Download high-resolution 1000px PNG"
              >
                <Download size={13} />
                <span>Download PNG</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated Print-Friendly Card (Visible ONLY during window.print()) */}
      <div className="qr-print-container" style={{ display: 'none' }}>
        <div style={{ textAlign: 'center', padding: '24px 20px', maxWidth: '480px', margin: '0 auto' }}>
          <div style={{ borderBottom: '2px solid #111', paddingBottom: '12px', marginBottom: '20px' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px', color: '#666', fontWeight: 600 }}>
              Studio Lumina • Guest Gallery
            </span>
            <h1 style={{ fontSize: '28px', margin: '8px 0 4px 0', fontFamily: 'Georgia, serif', color: '#111' }}>
              {event.name}
            </h1>
            <p style={{ fontSize: '13px', color: '#555', margin: 0 }}>
              {event.client_name ? `Honoring ${event.client_name}` : ''} {event.event_date ? `• ${event.event_date}` : ''}
            </p>
          </div>

          <div style={{ margin: '24px auto', display: 'inline-block' }}>
            {qrData?.qrDataUrl && (
              <img
                src={qrData.qrDataUrl}
                alt="Event QR Code"
                className="print-qr-code"
                style={{ width: '260px', height: '260px', display: 'block', margin: '0 auto' }}
              />
            )}
          </div>

          <div style={{ marginTop: '16px' }}>
            <p style={{ fontSize: '16px', fontWeight: 600, color: '#111', margin: '0 0 6px 0' }}>
              Scan to view your event photos
            </p>
            <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px 0' }}>
              Point your smartphone camera at the code above or visit:
            </p>
            <p
              style={{
                fontSize: '12px',
                fontFamily: 'monospace',
                background: '#f4f4f5',
                padding: '6px 12px',
                borderRadius: '4px',
                display: 'inline-block',
                color: '#222',
                border: '1px solid #e4e4e7',
                margin: 0,
              }}
            >
              {qrData?.shareUrl}
            </p>

            {pinProtected && (
              <div style={{ marginTop: '14px', fontSize: '12px', color: '#444', fontStyle: 'italic' }}>
                Note: An event PIN is required to access this gallery.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
