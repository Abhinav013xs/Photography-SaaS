import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  HardDrive,
  CheckCircle,
  AlertTriangle,
  ArrowUpRight,
  ShieldAlert,
  RefreshCw,
  FileText,
  Calendar,
  Layers,
  Sparkles,
} from 'lucide-react';
import api from '../api.js';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function BillingView() {
  const [overview, setOverview] = useState(null);
  const [plans, setPlans] = useState([]);
  const [addons, setAddons] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [confirmCancelModal, setConfirmCancelModal] = useState(false);

  const loadBillingData = async () => {
    try {
      setLoading(true);
      const [overviewData, plansData, addonsData, invoicesData] = await Promise.all([
        api.getBillingOverview(),
        api.getPlans(),
        api.getStorageAddons(),
        api.getInvoices(),
      ]);

      setOverview(overviewData);
      setPlans(plansData?.data || plansData || []);
      setAddons(addonsData?.data || addonsData || []);
      setInvoices(invoicesData?.data || invoicesData || []);
    } catch (err) {
      console.error('Failed to load commercial billing data:', err);
      setNotification({
        type: 'error',
        message: err.message || 'Failed to load billing information',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBillingData();
  }, []);

  const handleUpgradePlan = async (planId) => {
    try {
      setActionLoading(true);
      const res = await api.createCheckoutSession({ planId });
      setNotification({
        type: 'success',
        message: `Checkout session created. In production, you will be redirected to payment gateway: ${res.checkoutUrl}`,
      });
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.message || 'Failed to initiate plan upgrade',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePurchaseAddon = async (addonId) => {
    try {
      setActionLoading(true);
      const res = await api.createCheckoutSession({ addonId });
      setNotification({
        type: 'success',
        message: `Storage add-on checkout session created: ${res.checkoutUrl}`,
      });
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.message || 'Failed to purchase storage add-on',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    try {
      setActionLoading(true);
      await api.cancelSubscription(false);
      setConfirmCancelModal(false);
      setNotification({
        type: 'success',
        message: 'Your subscription has been scheduled for cancellation at the end of the paid billing period. Full access remains active until then.',
      });
      await loadBillingData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.message || 'Failed to cancel subscription',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReconcileStorage = async () => {
    try {
      setActionLoading(true);
      const res = await api.reconcileStorage();
      const report = res?.data || res;
      setNotification({
        type: 'success',
        message: `Storage reconciliation sweep completed in ${report.durationMs}ms. ${report.reconciledEventsCount} events verified.`,
      });
      await loadBillingData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.message || 'Storage reconciliation failed',
      });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !overview) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--text-muted)' }}>
        <RefreshCw size={24} className="spin" style={{ marginBottom: 12, display: 'inline-block' }} />
        <div>Loading commercial subscription & storage quota telemetry...</div>
      </div>
    );
  }

  const { plan, subscription, quota } = overview;
  const isOverQuota = quota.isOverQuota;
  const isBlocked = !quota.canUpload;

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: '0.8rem', letterSpacing: '0.12em', color: 'var(--accent-primary)', textTransform: 'uppercase', marginBottom: 4 }}>
            Commercial Layer
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Subscription, Quotas & Invoicing
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>
            Server-authoritative plan quotas, Cloudflare R2 byte consumption, and commercial billing lifecycle.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={handleReconcileStorage}
            disabled={actionLoading}
            className="btn btn-secondary"
            style={{ fontSize: '0.86rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <RefreshCw size={14} className={actionLoading ? 'spin' : ''} />
            <span>Reconcile Storage</span>
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div
          style={{
            marginBottom: 24,
            padding: '14px 20px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: notification.type === 'error' ? 'rgba(194, 65, 62, 0.08)' : 'rgba(42, 157, 143, 0.08)',
            border: `1px solid ${notification.type === 'error' ? 'rgba(194, 65, 62, 0.25)' : 'rgba(42, 157, 143, 0.25)'}`,
            color: notification.type === 'error' ? 'var(--status-error)' : 'var(--status-success)',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Over-Quota or Warning Banner */}
      {(isOverQuota || isBlocked || quota.warningLevel !== 'normal') && (
        <div
          style={{
            marginBottom: 28,
            padding: '18px 24px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: isBlocked ? 'rgba(194, 65, 62, 0.08)' : 'rgba(217, 119, 54, 0.08)',
            border: `1px solid ${isBlocked ? 'rgba(194, 65, 62, 0.25)' : 'rgba(217, 119, 54, 0.25)'}`,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 16,
          }}
        >
          <div style={{ color: isBlocked ? 'var(--status-error)' : 'var(--status-warning)', marginTop: 2 }}>
            <ShieldAlert size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>
              {isBlocked ? 'Uploads Restricted: Quota Limit Exceeded' : 'Storage Capacity Warning'}
            </div>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              {isBlocked
                ? 'Your account has exceeded its authoritative storage allocation. Existing guest galleries remain 100% accessible, but new photo and video uploads are restricted until you upgrade your plan or add storage add-ons.'
                : `Your storage consumption has reached ${quota.percentageUsed}%. Consider expanding capacity to avoid upload interruptions.`}
            </div>
          </div>
        </div>
      )}

      {/* Current Subscription & Storage Quota Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24, marginBottom: 36 }}>
        {/* Active Plan Card */}
        <div className="glass-panel" style={{ padding: '24px 28px', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Active Subscription
            </div>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                backgroundColor: subscription.status === 'active' ? 'rgba(42, 157, 143, 0.10)' : 'rgba(217, 119, 54, 0.10)',
                color: subscription.status === 'active' ? 'var(--status-success)' : 'var(--status-warning)',
                border: `1px solid ${subscription.status === 'active' ? 'rgba(42, 157, 143, 0.3)' : 'rgba(217, 119, 54, 0.3)'}`,
              }}
            >
              {subscription.status}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
              {plan.name}
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              ${(plan.price_cents / 100).toFixed(0)}/{plan.billing_interval}
            </div>
          </div>

          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
            {plan.description}
          </p>

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Renewal / Expiry:</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {new Date(subscription.current_period_end).toLocaleDateString()}
            </span>
          </div>

          {subscription.cancel_at_period_end && (
            <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(217, 119, 54, 0.08)', color: 'var(--status-warning)', border: '1px solid rgba(217, 119, 54, 0.25)', fontSize: '0.82rem' }}>
              Cancellation requested. Active access retained until end of period.
            </div>
          )}

          {!subscription.cancel_at_period_end && subscription.status === 'active' && plan.price_cents > 0 && (
            <div style={{ marginTop: 20, textAlign: 'right' }}>
              <button
                onClick={() => setConfirmCancelModal(true)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Cancel subscription at period end
              </button>
            </div>
          )}
        </div>

        {/* Authoritative Quota Meter Card */}
        <div className="glass-panel" style={{ padding: '24px 28px', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Authoritative Storage Quota
            </div>
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: quota.percentageUsed >= 95 ? 'var(--status-error)' : 'var(--accent-text)' }}>
              {quota.percentageUsed}% Used
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {formatBytes(quota.usedBytes)}
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              of {formatBytes(quota.totalStorageLimitBytes)}
            </div>
          </div>

          {/* Visual Progress Bar */}
          <div style={{ width: '100%', height: 8, borderRadius: 4, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', overflow: 'hidden', marginBottom: 18 }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, quota.percentageUsed)}%`,
                borderRadius: 4,
                backgroundColor:
                  quota.percentageUsed >= 100
                    ? 'var(--status-error)'
                    : quota.percentageUsed >= 85
                    ? 'var(--status-warning)'
                    : 'var(--accent-primary)',
                transition: 'width 0.4s ease',
              }}
            />
          </div>

          {/* Detailed Breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.82rem', borderTop: '1px solid var(--glass-border)', paddingTop: 16 }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Base Plan Allocation:</span>
              <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginTop: 2 }}>
                {formatBytes(quota.planStorageLimitBytes)}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Active Add-ons:</span>
              <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginTop: 2 }}>
                +{formatBytes(quota.addonStorageBytes)}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Active Events:</span>
              <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginTop: 2 }}>
                {quota.activeEventsCount} {quota.eventLimit > 0 ? `/ ${quota.eventLimit}` : '(Unlimited)'}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Available Capacity:</span>
              <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginTop: 2 }}>
                {formatBytes(quota.remainingBytes)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Commercial Plans Grid */}
      <div style={{ marginBottom: 48 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
          Subscription Tiers
        </h3>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: 24 }}>
          Elevate your studio with high-capacity storage, 4K video delivery, and deep-learning face search.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          {plans.map((p) => {
            const isCurrent = p.id === plan.id;
            return (
              <div
                key={p.id}
                className="glass-panel"
                style={{
                  padding: '24px 20px',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  border: isCurrent ? '2px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  position: 'relative',
                }}
              >
                {isCurrent && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -12,
                      right: 20,
                      backgroundColor: 'var(--accent-primary)',
                      color: '#ffffff',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '2px 10px',
                      borderRadius: 'var(--radius-full)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    Current Tier
                  </div>
                )}

                <div style={{ fontWeight: 600, fontSize: '1.15rem', color: 'var(--text-primary)', marginBottom: 4 }}>
                  {p.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 12 }}>
                  <span style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    ${(p.price_cents / 100).toFixed(0)}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    /{p.billing_interval}
                  </span>
                </div>

                <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', minHeight: 44, marginBottom: 18 }}>
                  {p.description}
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, marginBottom: 24, flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                    Features Included:
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <li style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <CheckCircle size={14} style={{ color: 'var(--accent-primary)' }} />
                      <span>{formatBytes(Number(p.storage_limit_bytes))} Cloud Storage</span>
                    </li>
                    <li style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <CheckCircle size={14} style={{ color: 'var(--accent-primary)' }} />
                      <span>{p.event_limit > 0 ? `${p.event_limit} Active Events` : 'Unlimited Active Events'}</span>
                    </li>
                    <li style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <CheckCircle size={14} style={{ color: 'var(--accent-primary)' }} />
                      <span>{p.face_search_limit > 0 ? `${p.face_search_limit} Face Searches/mo` : 'Unlimited AI Face Search'}</span>
                    </li>
                    {p.video_enabled && (
                      <li style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <CheckCircle size={14} style={{ color: 'var(--accent-primary)' }} />
                        <span>High-Speed Video Delivery</span>
                      </li>
                    )}
                  </ul>
                </div>

                <button
                  onClick={() => handleUpgradePlan(p.id)}
                  disabled={isCurrent || actionLoading}
                  className={`btn ${isCurrent ? 'btn-ghost' : 'btn-primary'}`}
                  style={{ width: '100%', fontSize: '0.86rem', padding: '10px 0' }}
                >
                  {isCurrent ? 'Current Plan' : 'Select Plan'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modular Storage Add-Ons */}
      <div style={{ marginBottom: 48 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
          Modular Storage Add-Ons
        </h3>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: 24 }}>
          Expand your storage footprint without altering your event limits or subscription tier.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {addons.map((a) => (
            <div
              key={a.id}
              className="glass-panel"
              style={{
                padding: '20px',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <HardDrive size={18} style={{ color: 'var(--accent-primary)' }} />
                  <span style={{ fontWeight: 600, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                    {a.name}
                  </span>
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>
                  ${(a.price_cents / 100).toFixed(0)} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/mo</span>
                </div>
              </div>

              <button
                onClick={() => handlePurchaseAddon(a.id)}
                disabled={actionLoading}
                className="btn btn-secondary"
                style={{ width: '100%', fontSize: '0.84rem', padding: '8px 0' }}
              >
                Add Storage
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Invoicing & Billing History */}
      <div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
          Billing History & Invoices
        </h3>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
          Authoritative accounting records of past charges and renewals.
        </p>

        {invoices.length === 0 ? (
          <div className="glass-panel" style={{ padding: '32px', textAlign: 'center', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No commercial invoices on record yet.
          </div>
        ) : (
          <div className="glass-panel" style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  <th style={{ padding: '14px 20px' }}>Invoice Description</th>
                  <th style={{ padding: '14px 20px' }}>Amount</th>
                  <th style={{ padding: '14px 20px' }}>Status</th>
                  <th style={{ padding: '14px 20px' }}>Issued Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '14px 20px', color: 'var(--text-primary)', fontWeight: 500 }}>
                      {inv.description || 'Studio Lumina Subscription'}
                    </td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-primary)' }}>
                      ${(inv.amount_cents / 100).toFixed(2)} {inv.currency}
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-full)',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          backgroundColor: inv.status === 'paid' ? 'rgba(42, 157, 143, 0.10)' : 'rgba(194, 65, 62, 0.10)',
                          color: inv.status === 'paid' ? 'var(--status-success)' : 'var(--status-error)',
                          border: `1px solid ${inv.status === 'paid' ? 'rgba(42, 157, 143, 0.3)' : 'rgba(194, 65, 62, 0.3)'}`,
                        }}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px', color: 'var(--text-muted)' }}>
                      {new Date(inv.issued_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Cancellation */}
      {confirmCancelModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(26, 26, 26, 0.45)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div className="glass-panel-strong" style={{ maxWidth: 480, width: '100%', padding: '28px', borderRadius: 'var(--radius-lg)' }}>
            <h4 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Cancel Subscription?
            </h4>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
              Your subscription will remain fully active with all features until the end of your current billing period ({new Date(subscription.current_period_end).toLocaleDateString()}). You will not be charged again. After this period, your account transitions to the Free plan.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                onClick={() => setConfirmCancelModal(false)}
                className="btn btn-ghost"
              >
                Keep Subscription
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={actionLoading}
                className="btn btn-danger"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
