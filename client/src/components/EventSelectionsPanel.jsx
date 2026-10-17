import React, { useState, useEffect } from 'react';
import {
  CheckCircle2, AlertCircle, RefreshCw, MessageSquare, Package,
  Send, Eye, ArrowLeft, Clock, ShieldCheck, Download, ChevronRight, X
} from 'lucide-react';
import api from '../api.js';

export default function EventSelectionsPanel({ eventId, onBack }) {
  const [selections, setSelections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Active inspected selection
  const [selectedItem, setSelectedItem] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [revisions, setRevisions] = useState([]);

  // Action modals
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState('ready');
  const [deliveryLink, setDeliveryLink] = useState('');

  const fetchSelections = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getEventSelections(eventId);
      setSelections(res.selections || []);
    } catch (err) {
      setError(err.message || 'Failed to load client selections.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSelections();
  }, [eventId]);

  const handleInspectSelection = async (sel) => {
    setSelectedItem(sel);
    setLoadingPhotos(true);
    try {
      const [detailRes, photoRes] = await Promise.all([
        api.getEventSelection(eventId, sel.id),
        api.getEventSelectionPhotos(eventId, sel.id, 'selected'),
      ]);
      setSelectedItem(detailRes.selection);
      setRevisions(detailRes.revisions || []);
      setPhotos(photoRes.photos || []);
    } catch (err) {
      console.error('Failed to load selection details:', err);
    } finally {
      setLoadingPhotos(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedItem) return;
    try {
      setSubmittingAction(true);
      const res = await api.approveEventSelection(eventId, selectedItem.id);
      setSelectedItem(res.selection);
      fetchSelections();
    } catch (err) {
      alert(err.message || 'Failed to approve selection');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleRequestChanges = async (e) => {
    e.preventDefault();
    if (!feedbackText.trim() || !selectedItem) return;
    try {
      setSubmittingAction(true);
      const res = await api.requestEventSelectionChanges(eventId, selectedItem.id, feedbackText.trim());
      setSelectedItem(res.selection);
      setShowFeedbackModal(false);
      setFeedbackText('');
      fetchSelections();
    } catch (err) {
      alert(err.message || 'Failed to request changes');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleUpdateDelivery = async (e) => {
    e.preventDefault();
    if (!selectedItem) return;
    try {
      setSubmittingAction(true);
      const res = await api.updateEventSelectionDelivery(eventId, selectedItem.id, {
        deliveryStatus,
        deliveryLink,
      });
      setSelectedItem(res.selection);
      setShowDeliveryModal(false);
      fetchSelections();
    } catch (err) {
      alert(err.message || 'Failed to update delivery');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleReconcile = async () => {
    if (!selectedItem) return;
    try {
      const res = await api.reconcileEventSelection(eventId, selectedItem.id);
      alert(`Reconciliation complete. Selected: ${res.result.selectedCount}, Favorites: ${res.result.favoritesCount}`);
      handleInspectSelection(selectedItem);
      fetchSelections();
    } catch (err) {
      alert(err.message || 'Reconciliation failed');
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'submitted':
        return <span className="badge" style={{ backgroundColor: 'rgba(217, 119, 6, 0.15)', color: '#d97706', border: '1px solid rgba(217, 119, 6, 0.3)' }}>Submitted for Review</span>;
      case 'approved':
        return <span className="badge" style={{ backgroundColor: 'rgba(42, 157, 143, 0.15)', color: 'var(--status-success)', border: '1px solid rgba(42, 157, 143, 0.3)' }}>Approved</span>;
      case 'changes_requested':
        return <span className="badge" style={{ backgroundColor: 'rgba(230, 57, 70, 0.15)', color: 'var(--status-error)', border: '1px solid rgba(230, 57, 70, 0.3)' }}>Changes Requested</span>;
      case 'locked':
        return <span className="badge" style={{ backgroundColor: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8', border: '1px solid rgba(100, 116, 139, 0.3)' }}>Locked</span>;
      default:
        return <span className="badge" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>In Draft</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {selectedItem && (
            <button
              className="btn btn-ghost"
              onClick={() => setSelectedItem(null)}
              style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <ArrowLeft size={16} />
              <span>All Selections</span>
            </button>
          )}
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              {selectedItem ? `Selection: ${selectedItem.client_name || 'Client Draft'}` : 'Client Proofing & Selections'}
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, marginTop: 2 }}>
              {selectedItem
                ? `Package: ${selectedItem.package_name || 'Full Collection'} • ${selectedItem.selected_count} Photos Selected`
                : 'Review submissions, approve final packages, or request client revisions.'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost" onClick={fetchSelections} title="Refresh Selections" style={{ padding: '8px 12px' }}>
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          backgroundColor: 'rgba(230, 57, 70, 0.1)',
          border: '1px solid rgba(230, 57, 70, 0.3)',
          padding: '12px 16px',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--status-error)',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Main View: Selections Table or Inspected Detail Grid */}
      {!selectedItem ? (
        <div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Loading client selections...
            </div>
          ) : selections.length === 0 ? (
            <div className="glass-panel" style={{ padding: 48, textAlign: 'center', borderRadius: 'var(--radius-md)' }}>
              <Package size={40} style={{ color: 'var(--text-muted)', marginBottom: 12, opacity: 0.6 }} />
              <h4 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 600, marginBottom: 6 }}>
                No Client Selections Recorded Yet
              </h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: 440, margin: '0 auto 16px auto' }}>
                When your clients open their proofing gallery and begin selecting images, their live selections and submitted packages will appear here.
              </p>
            </div>
          ) : (
            <div className="glass-panel" style={{ overflow: 'hidden', borderRadius: 'var(--radius-md)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 16px' }}>Client / Session</th>
                    <th style={{ padding: '12px 16px' }}>Package & Quota</th>
                    <th style={{ padding: '12px 16px' }}>Selected</th>
                    <th style={{ padding: '12px 16px' }}>Favorites</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                    <th style={{ padding: '12px 16px' }}>Submitted</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {selections.map((sel) => (
                    <tr
                      key={sel.id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                      }}
                      onClick={() => handleInspectSelection(sel)}
                      className="table-row-hover"
                    >
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {sel.client_name || 'Anonymous Client'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {sel.client_email || `Session ${sel.session_id.substring(0, 10)}...`}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div>{sel.package_name || 'Full Collection'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Quota: {sel.quota > 0 ? `${sel.quota} photos` : 'Unlimited'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <strong style={{ color: sel.quota > 0 && sel.selected_count >= sel.quota ? 'var(--accent-text)' : 'inherit' }}>
                          {sel.selected_count}
                        </strong>
                        {sel.quota > 0 && <span style={{ color: 'var(--text-muted)' }}> / {sel.quota}</span>}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {sel.favorites_count}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {getStatusBadge(sel.status)}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {sel.submitted_at ? new Date(sel.submitted_at).toLocaleDateString() : 'Not submitted'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInspectSelection(sel);
                          }}
                        >
                          <span>Review</span>
                          <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Inspected Selection Detail View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Summary Card */}
          <div className="glass-panel" style={{ padding: '20px 24px', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h4 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    {selectedItem.client_name || 'Anonymous Client'}
                  </h4>
                  {getStatusBadge(selectedItem.status)}
                  {selectedItem.delivery_status && selectedItem.delivery_status !== 'not_started' && (
                    <span className="badge" style={{ backgroundColor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                      Delivery: {selectedItem.delivery_status}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Email: {selectedItem.client_email || 'None provided'} • Version: {selectedItem.version} • Session: {selectedItem.session_id}
                </div>
                {selectedItem.client_notes && (
                  <div style={{
                    marginTop: 12,
                    padding: '10px 14px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                  }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Client Notes: </strong>
                    {selectedItem.client_notes}
                  </div>
                )}
                {selectedItem.photographer_feedback && (
                  <div style={{
                    marginTop: 8,
                    padding: '10px 14px',
                    backgroundColor: 'rgba(230, 57, 70, 0.05)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(230, 57, 70, 0.2)',
                    fontSize: '0.85rem',
                    color: 'var(--status-error)',
                  }}>
                    <strong>Your Revision Feedback: </strong>
                    {selectedItem.photographer_feedback}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-ghost"
                  onClick={handleReconcile}
                  title="Verify count consistency with database items"
                  style={{ padding: '8px 12px', fontSize: '0.8rem' }}
                >
                  <RefreshCw size={14} />
                  <span>Reconcile Count</span>
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => setShowFeedbackModal(true)}
                  disabled={submittingAction}
                  style={{ padding: '8px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <MessageSquare size={14} />
                  <span>Request Changes</span>
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => setShowDeliveryModal(true)}
                  disabled={submittingAction}
                  style={{ padding: '8px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Download size={14} />
                  <span>Delivery Settings</span>
                </button>

                <button
                  className="btn btn-primary"
                  onClick={handleApprove}
                  disabled={submittingAction || selectedItem.status === 'approved'}
                  style={{ padding: '8px 18px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <CheckCircle2 size={15} />
                  <span>{selectedItem.status === 'approved' ? 'Selection Approved' : 'Approve Selection'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Selected Photos Grid */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Selected Photographs ({photos.length})
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Package: {selectedItem.package_name || 'Full Collection'} ({selectedItem.selected_count} / {selectedItem.quota || '∞'})
              </div>
            </div>

            {loadingPhotos ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading selected photos...
              </div>
            ) : photos.length === 0 ? (
              <div className="glass-panel" style={{ padding: 40, textAlign: 'center', borderRadius: 'var(--radius-sm)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No photos currently selected for this package.</p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 14,
              }}>
                {photos.map((photo) => (
                  <div
                    key={photo.photoId}
                    className="glass-panel-subtle"
                    style={{
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                      position: 'relative',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ aspectRatio: '3/2', backgroundColor: 'var(--bg-secondary)', overflow: 'hidden' }}>
                      {photo.isAvailable ? (
                        <img
                          src={`/api/media/stream?key=${encodeURIComponent(photo.storageKeyThumbnail || photo.storageKeyPreview)}`}
                          alt={photo.originalName}
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--status-error)', fontSize: '0.75rem', padding: 8, textAlign: 'center' }}>
                          Photo Deleted
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '8px 10px', fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={photo.originalName}>
                        {photo.originalName}
                      </span>
                      {photo.isFavorite && (
                        <span style={{ color: '#e63946', fontSize: '0.8rem' }} title="Also marked as favorite">♥</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Request Changes Modal */}
      {showFeedbackModal && (
        <div className="modal-backdrop" onClick={() => setShowFeedbackModal(false)}>
          <div className="modal-container glass-panel-strong" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500, padding: 24, borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Request Selection Changes</h4>
              <button className="btn btn-ghost" onClick={() => setShowFeedbackModal(false)} style={{ padding: 4 }}><X size={16} /></button>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 14 }}>
              Provide clear instructions to your client explaining which photos need to be replaced, swapped, or adjusted.
            </p>
            <form onSubmit={handleRequestChanges}>
              <textarea
                className="form-input"
                rows={4}
                required
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="e.g. Please replace 5 duplicate group photos with additional bride/groom portraits."
                style={{ width: '100%', marginBottom: 16 }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowFeedbackModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submittingAction}>Send Change Request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delivery Settings Modal */}
      {showDeliveryModal && (
        <div className="modal-backdrop" onClick={() => setShowDeliveryModal(false)}>
          <div className="modal-container glass-panel-strong" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500, padding: 24, borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Final Delivery Settings</h4>
              <button className="btn btn-ghost" onClick={() => setShowDeliveryModal(false)} style={{ padding: 4 }}><X size={16} /></button>
            </div>
            <form onSubmit={handleUpdateDelivery} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Delivery Status</label>
                <select
                  className="form-input"
                  value={deliveryStatus}
                  onChange={(e) => setDeliveryStatus(e.target.value)}
                >
                  <option value="not_started">Not Started</option>
                  <option value="preparing">Preparing Final Edits</option>
                  <option value="ready">Ready for Download</option>
                  <option value="delivered">Delivered to Client</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">External Delivery / Download Link (Optional)</label>
                <input
                  type="url"
                  className="form-input"
                  value={deliveryLink}
                  onChange={(e) => setDeliveryLink(e.target.value)}
                  placeholder="https://cloud.studiolumina.photo/delivery/package.zip"
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  If left blank, clients will access their approved photos directly through their gallery.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowDeliveryModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submittingAction}>Update Delivery</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
