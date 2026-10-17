import React, { useState, useRef } from 'react';
import { X, UploadCloud, File, CheckCircle2, AlertCircle, Folder, Loader2 } from 'lucide-react';
import api from '../api.js';

export default function UploadModal({ eventId, folders, initialFolderId, onClose, onUploadComplete }) {
  const [selectedFolder, setSelectedFolder] = useState(initialFolderId || '');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const chosen = Array.from(e.target.files || []);
    if (chosen.length > 0) {
      setFiles((prev) => [...prev, ...chosen]);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length > 0) {
      setFiles((prev) => [...prev, ...dropped]);
    }
  };

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const calculateTotalSize = () => {
    const bytes = files.reduce((acc, f) => acc + f.size, 0);
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const startUpload = async () => {
    if (files.length === 0) return;
    setError('');
    setUploading(true);
    setProgress(0);

    try {
      await api.uploadMedia(eventId, files, selectedFolder, (percent, loaded, total) => {
        setProgress(percent);
        setBytesUploaded(loaded);
        setTotalBytes(total);
      });

      setSuccess(true);
      setTimeout(() => {
        if (onUploadComplete) onUploadComplete();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Upload failed');
      setUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={uploading ? undefined : onClose} style={{ zIndex: 1200 }}>
      <div className="modal-container glass-panel-strong" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 660, borderRadius: 'var(--radius-lg)' }}>
        <div className="modal-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}>
          <div>
            <h3 className="modal-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', letterSpacing: '-0.01em' }}>
              Batch Media Uploader
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Direct streaming to Cloudflare R2 with automatic asynchronous derivative & AI face indexing.
            </p>
          </div>
          {!uploading && (
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="modal-body" style={{ padding: '20px 24px' }}>
          {error && (
            <div style={{
              backgroundColor: 'rgba(194, 65, 62, 0.10)',
              border: '1px solid var(--status-error)',
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

          {/* Folder Destination Selector */}
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Destination Folder</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Folder size={16} color="var(--accent-primary)" />
              <select
                className="form-select"
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                disabled={uploading}
              >
                <option value="">(All Media / Default)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dropzone */}
          {!uploading && !success && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="glass-panel"
              style={{
                border: '1px dashed var(--border-medium)',
                backgroundColor: 'rgba(255, 255, 255, 0.75)',
                borderRadius: 'var(--radius-md)',
                padding: '44px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
              }}
            >
              <input
                type="file"
                multiple
                accept="image/*,video/mp4,video/quicktime"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <UploadCloud size={38} color="var(--accent-primary)" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Drag & drop photos or click to browse
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Supports batch uploads of JPEG, RAW/TIFF, PNG, WebP, and MP4 videos.
              </div>
            </div>
          )}

          {/* Upload Progress */}
          {uploading && (
            <div style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '24px 20px',
              textAlign: 'center',
            }}>
              <Loader2 size={32} className="spin" color="var(--accent-primary)" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Streaming {files.length} Files to R2...
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                {progress}% Uploaded
              </div>

              {/* Progress Bar */}
              <div style={{
                width: '100%',
                height: 8,
                backgroundColor: 'var(--bg-tertiary)',
                borderRadius: '9999px',
                overflow: 'hidden',
                margin: '16px 0 8px',
              }}>
                <div style={{
                  height: '100%',
                  width: `${progress}%`,
                  backgroundColor: 'var(--accent-primary)',
                  transition: 'width 200ms ease',
                }} />
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Derivatives & AI face indexing will proceed asynchronously in the background.
              </div>
            </div>
          )}

          {/* Success State */}
          {success && (
            <div style={{
              backgroundColor: 'rgba(42, 157, 143, 0.10)',
              border: '1px solid var(--status-success)',
              borderRadius: 'var(--radius-sm)',
              padding: '24px 20px',
              textAlign: 'center',
              color: 'var(--status-success)',
            }}>
              <CheckCircle2 size={38} style={{ margin: '0 auto 10px' }} />
              <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                Upload Complete!
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                {files.length} items queued for background derivative & facial indexing.
              </div>
            </div>
          )}

          {/* File Queue Preview List */}
          {!uploading && !success && files.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Selected Queue ({files.length} items • {calculateTotalSize()})
                </span>
                <button
                  className="btn btn-ghost"
                  onClick={() => setFiles([])}
                  style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                >
                  Clear All
                </button>
              </div>

              <div style={{
                maxHeight: 180,
                overflowY: 'auto',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-input)',
              }}>
                {files.map((file, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderBottom: idx === files.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                      fontSize: '0.82rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                      <File size={14} color="var(--text-muted)" />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>
                        {file.name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                      <button
                        onClick={() => handleRemoveFile(idx)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={startUpload}
            disabled={uploading || files.length === 0 || success}
          >
            <UploadCloud size={16} />
            <span>Start Upload ({files.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
}
