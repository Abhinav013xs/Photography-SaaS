import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Camera, Upload, RefreshCw, CheckCircle2,
  AlertCircle, Shield, Sparkles, Download
} from 'lucide-react';
import api from '../api.js';

export default function FaceSearchModal({ eventSlug, guestToken, allowDownloads, onClose, onSelectPhoto }) {
  const [mode, setMode] = useState('camera'); // 'camera' or 'upload'
  const [capturedImage, setCapturedImage] = useState(null);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.warn('Camera access error:', err);
      setMode('upload'); // Fallback to file upload
    }
  }, []);

  // Initialize webcam
  useEffect(() => {
    if (mode === 'camera' && !capturedImage) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [mode, capturedImage, startCamera, stopCamera]);

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 640;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      setCapturedImage(blob);
      stopCamera();
      executeSearch(blob);
    }, 'image/jpeg', 0.92);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setCapturedImage(file);
      executeSearch(file);
    }
  };

  const executeSearch = async (blob) => {
    try {
      setSearching(true);
      setError('');
      setResults(null);
      const res = await api.searchGuestFace(eventSlug, blob, guestToken);
      if (!res.success) {
        setError(res.error || 'No face detected in selfie. Please try a clearer angle.');
      } else {
        setResults(res);
      }
    } catch (err) {
      setError(err.message || 'Face search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setResults(null);
    setError('');
    if (mode === 'camera') {
      startCamera();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1200 }}>
      <div className="modal-container glass-panel-strong" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700, borderRadius: 'var(--radius-lg)' }}>
        {/* Header */}
        <div className="modal-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
              <Sparkles size={18} color="var(--accent-primary)" />
            </div>
            <div>
              <h3 className="modal-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', letterSpacing: '-0.01em' }}>
                Find Your Photos
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Upload a clear selfie and we'll find every moment you're in.
              </p>
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto', padding: '20px 24px' }}>
          {/* Privacy Guarantee Banner (Requirement 20) */}
          <div
            className="glass-panel"
            style={{
              borderLeft: '3px solid var(--accent-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              backgroundColor: 'rgba(255, 255, 255, 0.85)',
              marginBottom: 16,
            }}
          >
            <Shield size={18} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Biometric Privacy Guarantee:</strong> Your selfie is processed ephemerally in RAM to calculate similarity coordinates and is <strong>immediately destroyed</strong>. Raw selfies are never persisted.
            </div>
          </div>

          {error && (
            <div style={{
              backgroundColor: 'rgba(194, 65, 62, 0.10)',
              border: '1px solid var(--status-error)',
              padding: '12px 14px',
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

          {/* Mode Switcher (only if not searching and no results yet) */}
          {!capturedImage && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: 12,
              margin: '8px 0 16px',
            }}>
              <button
                className={`btn ${mode === 'camera' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode('camera')}
                style={{ fontSize: '0.84rem', padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Camera size={15} />
                <span>Take Live Selfie</span>
              </button>

              <button
                className={`btn ${mode === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode('upload')}
                style={{ fontSize: '0.84rem', padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Upload size={15} />
                <span>Upload Selfie from Device</span>
              </button>
            </div>
          )}

          {/* Camera View */}
          {mode === 'camera' && !capturedImage && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 20,
              padding: '16px 0',
            }}>
              <div style={{
                width: 'min(270px, 72vw)',
                height: 'min(270px, 72vw)',
                borderRadius: '50%',
                overflow: 'hidden',
                border: '3px solid var(--accent-primary)',
                position: 'relative',
                backgroundColor: '#252525',
                boxShadow: '0 12px 40px rgba(50, 45, 38, 0.15)',
              }}>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: 'scaleX(-1)', // Mirror selfie camera
                  }}
                />
              </div>

              <button
                className="btn btn-primary"
                onClick={capturePhoto}
                style={{ padding: '12px 32px', fontSize: '0.92rem', borderRadius: 'var(--radius-pill)', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <Camera size={18} />
                <span>Capture & Find My Photos</span>
              </button>
            </div>
          )}

          {/* File Upload Mode */}
          {mode === 'upload' && !capturedImage && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="glass-panel"
              style={{
                border: '1px dashed var(--border-medium)',
                backgroundColor: 'rgba(255, 255, 255, 0.85)',
                borderRadius: 'var(--radius-md)',
                padding: '48px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
              }}
            >
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
              <Upload size={38} color="var(--accent-primary)" style={{ margin: '0 auto 14px', opacity: 0.9 }} />
              <div style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Click to choose a clear selfie photo
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6, maxWidth: 360, margin: '6px auto 0' }}>
                A clear, front-facing portrait gives the most accurate matching results across solo and group photographs.
              </div>
            </div>
          )}

          {/* Searching Loader */}
          {searching && (
            <div
              className="glass-panel"
              style={{
                textAlign: 'center',
                padding: '48px 24px',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <RefreshCw size={36} className="animate-spin" color="var(--accent-primary)" style={{ margin: '0 auto 16px' }} />
              <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Finding your moments...
              </h4>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                Comparing 128-dimensional biometric embeddings across photos and celebrations.
              </p>
            </div>
          )}

          {/* Search Results */}
          {results && (() => {
            const photosList = results.data?.results || results.photos || [];
            const count = results.data?.pagination?.total ?? results.matchedCount ?? photosList.length;

            return (
              <div>
                <div
                  className="glass-panel"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    borderRadius: 'var(--radius-sm)',
                    borderLeft: '3px solid var(--status-success)',
                    marginBottom: 18,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <CheckCircle2 size={20} color="var(--status-success)" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                        Found {count} Photo{count === 1 ? '' : 's'} with You
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Includes individual portraits and group celebrations matching your face.
                      </div>
                    </div>
                  </div>

                  <button className="btn btn-secondary" onClick={handleRetake} style={{ fontSize: '0.8rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RefreshCw size={13} />
                    <span>Try Another Selfie</span>
                  </button>
                </div>

                {count === 0 ? (
                  <div
                    className="glass-panel"
                    style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)' }}
                  >
                    <p style={{ fontSize: '0.92rem' }}>No photos matched this selfie in this gallery.</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>
                      Try with brighter lighting, a neutral expression, or a direct front-facing angle.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="photo-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                      {photosList.map((item, idx) => {
                        const photoId = item.mediaId || item.id;
                        const streamKey = item.storageKeyThumbnail || item.storage_key_thumbnail || item.storageKeyPreview || item.storage_key_preview;
                        const filename = item.filename || item.original_name || `photo_${idx + 1}.jpg`;
                        const dist = item.cosineDistance !== undefined ? Number(item.cosineDistance) : 0.363;
                        const matchTag = dist <= 0.28 ? 'Primary Match' : 'Matched';

                        return (
                          <div
                            key={photoId || idx}
                            className="photo-card"
                            onClick={() => onSelectPhoto({ ...item, id: photoId })}
                            style={{ cursor: 'pointer' }}
                          >
                            <img
                              src={`/api/media/stream?key=${encodeURIComponent(streamKey || '')}`}
                              alt={filename}
                              loading="lazy"
                            />
                            <div className="photo-overlay">
                                <div style={{
                                  fontSize: '0.70rem',
                                  color: 'var(--accent-text)',
                                  backgroundColor: 'rgba(255, 255, 255, 0.92)',
                                  padding: '3px 9px',
                                  borderRadius: 'var(--radius-pill)',
                                  border: '1px solid var(--accent-border)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.06em',
                                  fontWeight: 600,
                                  boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                                }}>
                                {matchTag}
                              </div>
                              {allowDownloads && photoId && (
                                <a
                                  href={`/api/media/download/${photoId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  title="Download"
                                  className="btn btn-ghost"
                                  style={{ padding: 4, color: '#fff' }}
                                >
                                  <Download size={14} />
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{
                      marginTop: 16,
                      fontSize: '0.74rem',
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      fontStyle: 'italic',
                    }}>
                      Note: Neural face search compares biometric feature vectors. Unconventional lighting, motion blur, or partial occlusion may occasionally cause photos to be missed.
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
