import React, { useState, useEffect } from 'react';
import {
  Shield, Server, Users, Calendar, HardDrive, CreditCard,
  LifeBuoy, AlertTriangle, ToggleLeft, ToggleRight, RefreshCw,
  Search, Lock, CheckCircle2, XCircle, LogOut, FileText, ArrowRight,
  Database, Cpu, Clock, PlayCircle
} from 'lucide-react';
import api from '../../api.js';

export default function AdminPortal({ onExitAdmin }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState('overview');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('admin@studiolumina.photo');
  const [loginPassword, setLoginPassword] = useState('AdminMaster2026!');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Data states
  const [telemetry, setTelemetry] = useState(null);
  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [supportTickets, setSupportTickets] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [features, setFeatures] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [reconcileReport, setReconcileReport] = useState(null);

  // Search & Filters
  const [userSearch, setUserSearch] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [jobStatusFilter, setJobStatusFilter] = useState('all');

  // Modals & Action States
  const [selectedEventProcessing, setSelectedEventProcessing] = useState(null);
  const [breakGlassEvent, setBreakGlassEvent] = useState(null);
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [breakGlassResult, setBreakGlassResult] = useState(null);

  const [suspendModalUser, setSuspendModalUser] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');

  const [killSwitchModal, setKillSwitchModal] = useState(null);
  const [killSwitchConfirmText, setKillSwitchConfirmText] = useState('');
  const [killSwitchReason, setKillSwitchReason] = useState('');

  const [newTicketModal, setNewTicketModal] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketCategory, setTicketCategory] = useState('login');
  const [ticketPriority, setTicketPriority] = useState('MEDIUM');
  const [ticketNotes, setTicketNotes] = useState('');

  const [newIncidentModal, setNewIncidentModal] = useState(false);
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentSeverity, setIncidentSeverity] = useState('SEV-3');
  const [incidentSubsystem, setIncidentSubsystem] = useState('Queue & Workers');
  const [incidentDesc, setIncidentDesc] = useState('');

  const [actionMessage, setActionMessage] = useState(null);

  // Check initial admin session
  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await api.adminGetMe();
        if (res?.admin) {
          setAdmin(res.admin);
        }
      } catch (_e) {
        localStorage.removeItem('lumina_admin_token');
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  const loadTabData = async (tab) => {
    try {
      if (tab === 'overview') {
        const [tel, hlth] = await Promise.all([
          api.adminGetTelemetry(),
          api.adminGetHealth(),
        ]);
        setTelemetry(tel?.telemetry || null);
        setHealth(hlth || null);
      } else if (tab === 'users') {
        const res = await api.adminGetUsers({ search: userSearch });
        setUsers(res?.users || []);
      } else if (tab === 'events') {
        const res = await api.adminGetEvents({ search: eventSearch });
        setEvents(res?.events || []);
      } else if (tab === 'jobs') {
        const res = await api.adminGetJobs(jobStatusFilter);
        setJobs(res?.jobs || []);
      } else if (tab === 'storage') {
        const res = await api.adminGetStorageOverview();
        setStorageData(res || null);
      } else if (tab === 'support') {
        const res = await api.adminGetSupportTickets();
        setSupportTickets(res?.tickets || []);
      } else if (tab === 'incidents') {
        const res = await api.adminGetIncidents();
        setIncidents(res?.incidents || []);
      } else if (tab === 'features') {
        const res = await api.adminGetFeatures();
        setFeatures(res?.features || []);
      } else if (tab === 'audit') {
        const res = await api.adminGetAuditLogs();
        setAuditLogs(res?.logs || []);
      }
    } catch (err) {
      console.error(`Error loading ${tab}:`, err);
    }
  };

  // Fetch data on tab change
  useEffect(() => {
    if (!admin) return;
    const fetchTab = async () => {
      await loadTabData(currentTab);
    };
    fetchTab();
  }, [admin, currentTab]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await api.adminLogin({ email: loginEmail, password: loginPassword });
      setAdmin(res.admin);
    } catch (err) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await api.adminLogout();
    setAdmin(null);
  };

  const flashMessage = (msg, isError = false) => {
    setActionMessage({ text: msg, isError });
    setTimeout(() => setActionMessage(null), 4000);
  };

  // User Actions
  const handleSuspendUser = async () => {
    if (!suspendModalUser) return;
    try {
      await api.adminSuspendUser(suspendModalUser.id, suspendReason);
      flashMessage(`Account ${suspendModalUser.email} has been suspended.`);
      setSuspendModalUser(null);
      setSuspendReason('');
      loadTabData('users');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  const handleRestoreUser = async (user) => {
    try {
      await api.adminRestoreUser(user.id, 'Account restored by administrator');
      flashMessage(`Account ${user.email} restored successfully.`);
      loadTabData('users');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  // Break-Glass Event Access
  const handleBreakGlass = async () => {
    if (!breakGlassEvent) return;
    try {
      const res = await api.adminBreakGlass(breakGlassEvent.id, breakGlassReason);
      setBreakGlassResult(res);
      flashMessage('Break-glass emergency session granted for 15 minutes.');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  // Job Actions
  const handleRetryJob = async (jobId) => {
    try {
      await api.adminRetryJob(jobId);
      flashMessage(`Job ${jobId.slice(0, 8)} queued for safe retry.`);
      loadTabData('jobs');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  const handleCancelJob = async (jobId) => {
    try {
      await api.adminCancelJob(jobId);
      flashMessage(`Job ${jobId.slice(0, 8)} cancelled.`);
      loadTabData('jobs');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  // Storage Reconciliation
  const handleRunReconcile = async () => {
    try {
      flashMessage('Running storage reconciliation pass across DB & R2...');
      const res = await api.adminRunStorageReconciliation();
      setReconcileReport(res.report);
      flashMessage('Reconciliation pass completed.');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  // Support Ticket Actions
  const handleCreateTicket = async () => {
    try {
      await api.adminCreateSupportTicket({
        subject: ticketSubject,
        category: ticketCategory,
        priority: ticketPriority,
        notes: ticketNotes,
      });
      flashMessage('Support ticket created.');
      setNewTicketModal(false);
      setTicketSubject('');
      setTicketNotes('');
      loadTabData('support');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  const handleUpdateTicketStatus = async (ticketId, status) => {
    try {
      await api.adminUpdateSupportTicket(ticketId, { status });
      flashMessage(`Ticket status updated to ${status}.`);
      loadTabData('support');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  // Incident Actions
  const handleCreateIncident = async () => {
    try {
      await api.adminCreateIncident({
        title: incidentTitle,
        severity: incidentSeverity,
        affected_subsystem: incidentSubsystem,
        description: incidentDesc,
      });
      flashMessage(`Incident ${incidentTitle} declared.`);
      setNewIncidentModal(false);
      setIncidentTitle('');
      setIncidentDesc('');
      loadTabData('incidents');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  const handleUpdateIncidentStatus = async (incidentId, status) => {
    try {
      await api.adminUpdateIncident(incidentId, { status });
      flashMessage(`Incident marked as ${status}.`);
      loadTabData('incidents');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  // Feature Flag / Kill Switch Toggle
  const handleToggleFeature = async () => {
    if (!killSwitchModal) return;
    try {
      await api.adminToggleFeature({
        key: killSwitchModal.key,
        enabled: !killSwitchModal.enabled,
        reason: killSwitchReason || 'Administrative control adjustment',
        confirmationText: killSwitchConfirmText,
      });
      flashMessage(`Control "${killSwitchModal.key}" updated successfully.`);
      setKillSwitchModal(null);
      setKillSwitchConfirmText('');
      setKillSwitchReason('');
      loadTabData('features');
    } catch (err) {
      flashMessage(err.message, true);
    }
  };

  // Loading Screen
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F9FC', color: '#6D28D9' }}>
        Authenticating Platform Operations Center...
      </div>
    );
  }

  // 1. ADMIN LOGIN VIEW
  if (!admin) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#F7F9FC',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'var(--font-sans, sans-serif)',
        color: '#1E293B',
      }}>
        <div style={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          borderRadius: 12,
          padding: 36,
          boxShadow: '0 20px 40px rgba(15, 23, 42, 0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              backgroundColor: 'rgba(167, 139, 250, 0.12)',
              border: '1px solid #A78BFA',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6D28D9',
            }}>
              <Shield size={24} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, letterSpacing: '0.04em' }}>
                STUDIO LUMINA
              </h2>
              <div style={{ fontSize: '0.72rem', color: '#64748B', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Platform Control Center
              </div>
            </div>
          </div>

          <p style={{ fontSize: '0.86rem', color: '#64748B', marginBottom: 24, lineHeight: 1.5 }}>
            Restricted operational environment for authorized engineering, support, reliability, and finance personnel.
          </p>

          {loginError && (
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid #ef4444',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: '0.84rem',
              color: '#f87171',
              marginBottom: 20,
            }}>
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6, fontWeight: 500 }}>
                Operator Email
              </label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: 6,
                  color: '#1E293B',
                  fontSize: '0.90rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6, fontWeight: 500 }}>
                Master Credential Password
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: 6,
                  color: '#1E293B',
                  fontSize: '0.90rem',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                marginTop: 10,
                padding: '12px',
                backgroundColor: '#A78BFA',
                border: 'none',
                borderRadius: 6,
                color: '#FFFFFF',
                fontWeight: 600,
                fontSize: '0.92rem',
                cursor: loginLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Lock size={16} />
              {loginLoading ? 'Verifying Authorization...' : 'Access Platform Center'}
            </button>
          </form>

          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <button
              type="button"
              onClick={onExitAdmin}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                fontSize: '0.82rem',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Return to Photographer Galleries
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. AUTHENTICATED ADMIN OPERATIONS CENTER
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F7F9FC', color: '#1E293B', fontFamily: 'var(--font-sans, sans-serif)' }}>
      {/* Top Bar */}
      <header style={{
        backgroundColor: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
        padding: '0 24px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              backgroundColor: 'rgba(167, 139, 250, 0.12)',
              border: '1px solid #A78BFA',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6D28D9',
            }}>
              <Shield size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.96rem', letterSpacing: '0.04em' }}>
                STUDIO LUMINA
              </div>
              <div style={{ fontSize: '0.64rem', color: '#6D28D9', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>
                Operations Center
              </div>
            </div>
          </div>

          <div style={{ height: 20, width: 1, backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)' }} />

          {/* Role Badge */}
          <span style={{
            fontSize: '0.72rem',
            padding: '4px 8px',
            borderRadius: 4,
            backgroundColor: 'rgba(167, 139, 250, 0.16)',
            color: '#6D28D9',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            fontWeight: 600,
          }}>
            {admin.role}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right', fontSize: '0.80rem' }}>
            <div style={{ fontWeight: 600 }}>{admin.name}</div>
            <div style={{ color: '#94A3B8', fontSize: '0.70rem' }}>{admin.email}</div>
          </div>

          <button
            onClick={onExitAdmin}
            style={{
              padding: '6px 12px',
              backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
              border: '1px solid rgba(148, 163, 184, 0.18)',
              borderRadius: 6,
              color: '#334155',
              fontSize: '0.80rem',
              cursor: 'pointer',
            }}
          >
            Client App
          </button>

          <button
            onClick={handleLogout}
            title="Log Out"
            style={{
              padding: 8,
              backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
              border: '1px solid rgba(148, 163, 184, 0.18)',
              borderRadius: 6,
              color: '#ef4444',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* Action Notification Banner */}
      {actionMessage && (
        <div style={{
          backgroundColor: actionMessage.isError ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
          borderBottom: `1px solid ${actionMessage.isError ? '#ef4444' : '#22c55e'}`,
          color: actionMessage.isError ? '#fca5a5' : '#86efac',
          padding: '8px 24px',
          fontSize: '0.85rem',
          textAlign: 'center',
        }}>
          {actionMessage.text}
        </div>
      )}

      {/* Sub-Navigation Tabs */}
      <nav style={{
        backgroundColor: 'rgba(255, 255, 255, 0.70)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
        padding: '0 24px',
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
      }}>
        {[
          { id: 'overview', label: 'Telemetry & Health', icon: Server },
          { id: 'users', label: 'Photographers', icon: Users },
          { id: 'events', label: 'Events & Processing', icon: Calendar },
          { id: 'jobs', label: 'Queue & DLQ', icon: PlayCircle },
          { id: 'storage', label: 'Storage Reconciliation', icon: HardDrive },
          { id: 'billing', label: 'Billing Adjustments', icon: CreditCard },
          { id: 'support', label: 'Support Tickets', icon: LifeBuoy },
          { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
          { id: 'features', label: 'Emergency Controls', icon: ToggleRight },
          { id: 'audit', label: 'Immutable Audit Trail', icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 14px',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid #A78BFA' : '2px solid transparent',
                color: isActive ? '#6D28D9' : '#a1a1aa',
                fontWeight: isActive ? 600 : 500,
                fontSize: '0.84rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Main Tab Content */}
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 24px' }}>
        {/* ====================================================================
            TAB 1: TELEMETRY & SYSTEM HEALTH
            ==================================================================== */}
        {currentTab === 'overview' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Operational Telemetry & Subsystem Health</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Live metrics aggregated across database, workers, Cloudflare R2, and biometric indexing queues.
                </p>
              </div>
              <button
                onClick={() => loadTabData('overview')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: 6,
                  color: '#334155',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} /> Refresh Telemetry
              </button>
            </div>

            {/* Health Grid */}
            {health && (
              <div style={{
                backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                border: '1px solid #252830',
                borderRadius: 8,
                padding: 20,
                marginBottom: 24,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ fontSize: '0.90rem', fontWeight: 600, color: '#1E293B' }}>
                    Subsystem Diagnostic Matrix
                  </div>
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '3px 8px',
                    borderRadius: 4,
                    backgroundColor: health.status === 'HEALTHY' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                    color: health.status === 'HEALTHY' ? '#4ade80' : '#f87171',
                    border: `1px solid ${health.status === 'HEALTHY' ? '#22c55e' : '#ef4444'}`,
                    fontWeight: 600,
                  }}>
                    OVERALL: {health.status}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                  {Object.entries(health.checks || {}).map(([name, check]) => (
                    <div key={name} style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                      borderRadius: 6,
                      padding: 14,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: '0.80rem', fontWeight: 600, textTransform: 'uppercase', color: '#334155' }}>
                          {name}
                        </span>
                        <span style={{
                          fontSize: '0.68rem',
                          color: check.status === 'HEALTHY' ? '#4ade80' : '#f87171',
                          fontWeight: 600,
                        }}>
                          {check.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                        {name === 'api' && `Uptime: ${check.uptimeSeconds}s | Mem: ${check.memoryUsageMb}MB`}
                        {name === 'database' && `${check.type} (${check.latencyMs}ms)`}
                        {name === 'storage' && `${check.engine} (${check.bucket})`}
                        {name === 'queue' && `Workers: ${check.concurrency} | Busy: ${check.isProcessing ? 'YES' : 'IDLE'}`}
                        {name === 'aiService' && `${check.models}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* KPI Cards */}
            {telemetry && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 8, padding: 20 }}>
                  <div style={{ fontSize: '0.76rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Photographer Accounts
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#1E293B', margin: '8px 0 4px' }}>
                    {telemetry.photographers.total}
                  </div>
                  <div style={{ fontSize: '0.80rem', color: '#4ade80' }}>
                    {telemetry.photographers.active} Active • {telemetry.photographers.suspended} Suspended
                  </div>
                </div>

                <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 8, padding: 20 }}>
                  <div style={{ fontSize: '0.76rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Galleries & Events
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#1E293B', margin: '8px 0 4px' }}>
                    {telemetry.events.total}
                  </div>
                  <div style={{ fontSize: '0.80rem', color: '#6D28D9' }}>
                    {telemetry.events.active} Active • {telemetry.events.inBin} In Recycle Bin
                  </div>
                </div>

                <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 8, padding: 20 }}>
                  <div style={{ fontSize: '0.76rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Total Physical Storage
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#1E293B', margin: '8px 0 4px' }}>
                    {(telemetry.storage.totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                  </div>
                  <div style={{ fontSize: '0.80rem', color: '#64748B' }}>
                    Engine: {telemetry.storage.isR2 ? 'Cloudflare R2' : 'Local Disk'}
                  </div>
                </div>

                <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 8, padding: 20 }}>
                  <div style={{ fontSize: '0.76rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    AI Face Embeddings
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#6D28D9', margin: '8px 0 4px' }}>
                    {telemetry.biometrics.totalEmbeddings.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.80rem', color: '#4ade80' }}>
                    Zero Raw Biometrics Stored
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================================
            TAB 2: PHOTOGRAPHER MANAGEMENT
            ==================================================================== */}
        {currentTab === 'users' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Photographer Accounts</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Manage platform users, inspect storage and activity, or enforce temporary suspension.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text"
                  placeholder="Search by email or name..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(148, 163, 184, 0.18)',
                    borderRadius: 6,
                    color: '#1E293B',
                    fontSize: '0.85rem',
                    width: 260,
                  }}
                />
                <button
                  onClick={() => loadTabData('users')}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(148, 163, 184, 0.18)',
                    borderRadius: 6,
                    color: '#1E293B',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  Search
                </button>
              </div>
            </div>

            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid #252832', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(148, 163, 184, 0.18)', color: '#64748B' }}>
                    <th style={{ padding: '12px 16px' }}>User ID</th>
                    <th style={{ padding: '12px 16px' }}>Email & Business</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                    <th style={{ padding: '12px 16px' }}>Galleries</th>
                    <th style={{ padding: '12px 16px' }}>Storage</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #1e2129' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: '#6D28D9' }}>
                        #{u.id}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600, color: '#1E293B' }}>{u.businessName || 'Photographer'}</div>
                        <div style={{ color: '#94A3B8', fontSize: '0.78rem' }}>{u.email}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '3px 8px',
                          borderRadius: 4,
                          backgroundColor: u.status === 'suspended' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                          color: u.status === 'suspended' ? '#f87171' : '#4ade80',
                          border: `1px solid ${u.status === 'suspended' ? '#ef4444' : '#22c55e'}`,
                          fontWeight: 600,
                        }}>
                          {u.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {u.metrics.eventCount} Events ({u.metrics.mediaCount} Media)
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {(u.metrics.storageBytes / (1024 * 1024)).toFixed(1)} MB
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {u.status === 'suspended' ? (
                          <button
                            onClick={() => handleRestoreUser(u)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: 'rgba(34, 197, 94, 0.15)',
                              border: '1px solid #22c55e',
                              borderRadius: 4,
                              color: '#4ade80',
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            Restore Account
                          </button>
                        ) : (
                          <button
                            onClick={() => setSuspendModalUser(u)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid #ef4444',
                              borderRadius: 4,
                              color: '#f87171',
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            Suspend
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>
                        No photographer accounts matching query.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Suspend Confirmation Modal */}
            {suspendModalUser && (
              <div style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                padding: 20,
              }}>
                <div style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid #ef4444',
                  borderRadius: 8,
                  padding: 24,
                  maxWidth: 440,
                  width: '100%',
                }}>
                  <h3 style={{ margin: '0 0 12px', color: '#f87171' }}>Suspend Photographer Account</h3>
                  <p style={{ fontSize: '0.86rem', color: '#64748B', lineHeight: 1.5 }}>
                    Suspending <strong>{suspendModalUser.email}</strong> blocks future logins, new uploads, and event creation.
                  </p>
                  <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6, fontWeight: 500 }}>
                    Mandatory Operational Reason:
                  </label>
                  <textarea
                    rows={3}
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    placeholder="e.g. Terms of Service violation, payment chargeback, security hold..."
                    style={{
                      width: '100%',
                      padding: 10,
                      backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                      borderRadius: 6,
                      color: '#1E293B',
                      fontSize: '0.86rem',
                      marginBottom: 16,
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      onClick={() => setSuspendModalUser(null)}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: 'rgba(148, 163, 184, 0.22)',
                        border: 'none',
                        borderRadius: 6,
                        color: '#334155',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSuspendUser}
                      disabled={!suspendReason.trim()}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#ef4444',
                        border: 'none',
                        borderRadius: 6,
                        color: '#1E293B',
                        fontWeight: 600,
                        cursor: suspendReason.trim() ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Confirm Suspension
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================================
            TAB 3: EVENTS & PROCESSING STATUS
            ==================================================================== */}
        {currentTab === 'events' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Event Operations & AI Status</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Inspect gallery metadata and processing pipelines without exposing customer private photos or raw biometric vectors.
                </p>
              </div>
              <input
                type="text"
                placeholder="Search event name or client..."
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: 6,
                  color: '#1E293B',
                  fontSize: '0.85rem',
                  width: 260,
                }}
              />
            </div>

            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid #252832', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(148, 163, 184, 0.18)', color: '#64748B' }}>
                    <th style={{ padding: '12px 16px' }}>Event Name</th>
                    <th style={{ padding: '12px 16px' }}>Client</th>
                    <th style={{ padding: '12px 16px' }}>Status / Visibility</th>
                    <th style={{ padding: '12px 16px' }}>Media</th>
                    <th style={{ padding: '12px 16px' }}>Face Embeddings</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Support Operations</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id} style={{ borderBottom: '1px solid #1e2129' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600, color: '#1E293B' }}>{ev.name}</div>
                        <div style={{ color: '#94A3B8', fontSize: '0.78rem' }}>/{ev.slug}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div>{ev.clientName}</div>
                        <div style={{ color: '#94A3B8', fontSize: '0.78rem' }}>{ev.eventDate}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor: ev.status === 'active' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: ev.status === 'active' ? '#4ade80' : '#f87171',
                          marginRight: 6,
                          fontWeight: 600,
                        }}>
                          {ev.status.toUpperCase()}
                        </span>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor: ev.visibility === 'public' ? 'rgba(167, 139, 250, 0.12)' : 'rgba(148, 163, 184, 0.15)',
                          color: ev.visibility === 'public' ? '#6D28D9' : '#64748B',
                          fontWeight: 600,
                        }}>
                          {ev.visibility.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {ev.metrics.mediaCount} items ({(ev.metrics.storageBytes / (1024 * 1024)).toFixed(1)} MB)
                      </td>
                      <td style={{ padding: '14px 16px', color: '#6D28D9', fontWeight: 600 }}>
                        {ev.metrics.embeddingCount} faces indexed
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <button
                          onClick={async () => {
                            const res = await api.adminGetEventProcessing(ev.id);
                            setSelectedEventProcessing(res);
                          }}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(148, 163, 184, 0.18)',
                            borderRadius: 4,
                            color: '#334155',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            marginRight: 8,
                          }}
                        >
                          Diagnostics
                        </button>
                        <button
                          onClick={() => {
                            setBreakGlassEvent(ev);
                            setBreakGlassReason('');
                            setBreakGlassResult(null);
                          }}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: 'rgba(245, 158, 11, 0.15)',
                            border: '1px solid #f59e0b',
                            borderRadius: 4,
                            color: '#fbbf24',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          Break-Glass
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Processing Diagnostics Modal */}
            {selectedEventProcessing && (
              <div style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                padding: 20,
              }}>
                <div style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: 8,
                  padding: 24,
                  maxWidth: 480,
                  width: '100%',
                }}>
                  <h3 style={{ margin: '0 0 16px', color: '#1E293B' }}>
                    Diagnostics: {selectedEventProcessing.eventName}
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                    <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', padding: 12, borderRadius: 6 }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748B' }}>Total Media</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{selectedEventProcessing.processing.total}</div>
                    </div>
                    <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', padding: 12, borderRadius: 6 }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748B' }}>Ready (Processed)</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#4ade80' }}>
                        {selectedEventProcessing.processing.ready}
                      </div>
                    </div>
                    <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', padding: 12, borderRadius: 6 }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748B' }}>Pending / In Queue</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#6D28D9' }}>
                        {selectedEventProcessing.processing.uploaded + selectedEventProcessing.processing.processing}
                      </div>
                    </div>
                    <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', padding: 12, borderRadius: 6 }}>
                      <div style={{ fontSize: '0.74rem', color: '#64748B' }}>Failed Items</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#f87171' }}>
                        {selectedEventProcessing.processing.failed}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedEventProcessing(null)}
                    style={{
                      width: '100%',
                      padding: 10,
                      backgroundColor: 'rgba(148, 163, 184, 0.22)',
                      border: 'none',
                      borderRadius: 6,
                      color: '#1E293B',
                      cursor: 'pointer',
                    }}
                  >
                    Close Diagnostics
                  </button>
                </div>
              </div>
            )}

            {/* Break-Glass Support Access Modal */}
            {breakGlassEvent && (
              <div style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                padding: 20,
              }}>
                <div style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid #f59e0b',
                  borderRadius: 8,
                  padding: 24,
                  maxWidth: 480,
                  width: '100%',
                }}>
                  <h3 style={{ margin: '0 0 12px', color: '#fbbf24' }}>Break-Glass Gallery Access</h3>
                  <p style={{ fontSize: '0.85rem', color: '#64748B', lineHeight: 1.5 }}>
                    Emergency temporary access to inspect <strong>{breakGlassEvent.name}</strong> for customer troubleshooting.
                    This action is permanently audited in the compliance trail.
                  </p>

                  {breakGlassResult ? (
                    <div style={{
                      backgroundColor: 'rgba(34, 197, 94, 0.15)',
                      border: '1px solid #22c55e',
                      borderRadius: 6,
                      padding: 14,
                      marginBottom: 16,
                      fontSize: '0.84rem',
                    }}>
                      <div style={{ fontWeight: 600, color: '#4ade80', marginBottom: 4 }}>
                        Temporary Session Granted
                      </div>
                      <div style={{ color: '#334155' }}>Expires at: {breakGlassResult.expiresAt}</div>
                      <div style={{ marginTop: 8 }}>
                        <a
                          href={`/gallery/${breakGlassResult.targetEvent.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#6D28D9', textDecoration: 'underline' }}
                        >
                          Open Gallery with Ephemeral Token &rarr;
                        </a>
                      </div>
                    </div>
                  ) : (
                    <>
                      <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                        Mandatory Support Justification (min 10 chars):
                      </label>
                      <textarea
                        rows={3}
                        value={breakGlassReason}
                        onChange={(e) => setBreakGlassReason(e.target.value)}
                        placeholder="e.g. Customer reported missing photos during reception..."
                        style={{
                          width: '100%',
                          padding: 10,
                          backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                          border: '1px solid rgba(148, 163, 184, 0.18)',
                          borderRadius: 6,
                          color: '#1E293B',
                          fontSize: '0.86rem',
                          marginBottom: 16,
                        }}
                      />
                    </>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      onClick={() => setBreakGlassEvent(null)}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: 'rgba(148, 163, 184, 0.22)',
                        border: 'none',
                        borderRadius: 6,
                        color: '#334155',
                        cursor: 'pointer',
                      }}
                    >
                      {breakGlassResult ? 'Done' : 'Cancel'}
                    </button>
                    {!breakGlassResult && (
                      <button
                        onClick={handleBreakGlass}
                        disabled={breakGlassReason.trim().length < 10}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#f59e0b',
                          border: 'none',
                          borderRadius: 6,
                          color: '#000',
                          fontWeight: 600,
                          cursor: breakGlassReason.trim().length >= 10 ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Grant Ephemeral Access
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================================
            TAB 4: QUEUE, JOBS & DEAD-LETTER QUEUE (DLQ)
            ==================================================================== */}
        {currentTab === 'jobs' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Queue Operations & Dead-Letter Queue (DLQ)</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Monitor background image derivative processing, video transcoding, and biometric indexing jobs.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {['all', 'failed', 'dead_letter', 'pending', 'processing', 'completed'].map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      setJobStatusFilter(st);
                      api.adminGetJobs(st).then((r) => setJobs(r.jobs || []));
                    }}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: jobStatusFilter === st ? '#A78BFA' : 'rgba(255, 255, 255, 0.65)',
                      color: jobStatusFilter === st ? '#FFFFFF' : '#64748B',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                      borderRadius: 4,
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {st.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid #252832', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(148, 163, 184, 0.18)', color: '#64748B' }}>
                    <th style={{ padding: '12px 16px' }}>Job ID</th>
                    <th style={{ padding: '12px 16px' }}>Event</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                    <th style={{ padding: '12px 16px' }}>Progress</th>
                    <th style={{ padding: '12px 16px' }}>Retries / Category</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} style={{ borderBottom: '1px solid #1e2129' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: '#6D28D9' }}>
                        {j.id.slice(0, 8)}...
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{j.eventName}</div>
                        <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>{j.type}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '3px 8px',
                          borderRadius: 4,
                          backgroundColor:
                            j.status === 'completed'
                              ? 'rgba(34, 197, 94, 0.2)'
                              : j.status === 'dead_letter'
                              ? 'rgba(239, 68, 68, 0.3)'
                              : j.status === 'failed'
                              ? 'rgba(239, 68, 68, 0.15)'
                              : 'rgba(167, 139, 250, 0.12)',
                          color:
                            j.status === 'completed'
                              ? '#16a34a'
                              : j.status === 'dead_letter'
                              ? '#dc2626'
                              : j.status === 'failed'
                              ? '#ea580c'
                              : '#6D28D9',
                          fontWeight: 600,
                        }}>
                          {j.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {j.progress}% ({j.processedItems}/{j.totalItems})
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div>{j.retryCount} Retries</div>
                        {j.errorCategory && (
                          <div style={{ fontSize: '0.74rem', color: '#f87171' }}>{j.errorCategory}</div>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {(j.status === 'failed' || j.status === 'dead_letter') && (
                          <button
                            onClick={() => handleRetryJob(j.id)}
                            style={{
                              padding: '6px 10px',
                              backgroundColor: 'rgba(167, 139, 250, 0.12)',
                              border: '1px solid #A78BFA',
                              borderRadius: 4,
                              color: '#6D28D9',
                              fontSize: '0.76rem',
                              cursor: 'pointer',
                              fontWeight: 600,
                              marginRight: 6,
                            }}
                          >
                            Safe Retry
                          </button>
                        )}
                        {j.status !== 'completed' && j.status !== 'cancelled' && (
                          <button
                            onClick={() => handleCancelJob(j.id)}
                            style={{
                              padding: '6px 10px',
                              backgroundColor: 'rgba(148, 163, 184, 0.22)',
                              border: '1px solid rgba(148, 163, 184, 0.18)',
                              borderRadius: 4,
                              color: '#334155',
                              fontSize: '0.76rem',
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>
                        No background jobs found matching status "{jobStatusFilter}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 5: STORAGE RECONCILIATION
            ==================================================================== */}
        {currentTab === 'storage' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Storage Operations & Reconciliation</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Cross-verify database records against Cloudflare R2 bucket objects to ensure zero byte drift or orphaned assets.
                </p>
              </div>
              <button
                onClick={handleRunReconcile}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  backgroundColor: '#A78BFA',
                  border: 'none',
                  borderRadius: 6,
                  color: '#FFFFFF',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={15} /> Run Storage Reconciliation
              </button>
            </div>

            {reconcileReport && (
              <div style={{
                backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(148, 163, 184, 0.18)',
                borderRadius: 8,
                padding: 24,
                marginBottom: 24,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                    Reconciliation Results ({reconcileReport.status})
                  </div>
                  <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
                    Completed in {reconcileReport.durationMs}ms at {reconcileReport.reconciledAt}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
                  <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', padding: 12, borderRadius: 6 }}>
                    <div style={{ fontSize: '0.74rem', color: '#64748B' }}>DB Tracked Records</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{reconcileReport.summary.totalDbMediaRecords}</div>
                  </div>
                  <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', padding: 12, borderRadius: 6 }}>
                    <div style={{ fontSize: '0.74rem', color: '#64748B' }}>Verified Objects</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#4ade80' }}>{reconcileReport.summary.verifiedKeysCount}</div>
                  </div>
                  <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', padding: 12, borderRadius: 6 }}>
                    <div style={{ fontSize: '0.74rem', color: '#64748B' }}>Missing R2 Objects</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, color: reconcileReport.summary.missingObjectsCount > 0 ? '#f87171' : '#4ade80' }}>
                      {reconcileReport.summary.missingObjectsCount}
                    </div>
                  </div>
                  <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', padding: 12, borderRadius: 6 }}>
                    <div style={{ fontSize: '0.74rem', color: '#64748B' }}>Unexpected / Orphan Keys</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600, color: reconcileReport.summary.unexpectedObjectsCount > 0 ? '#fbbf24' : '#4ade80' }}>
                      {reconcileReport.summary.unexpectedObjectsCount}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: '0.80rem', color: '#64748B', fontStyle: 'italic' }}>
                  {reconcileReport.policyNote}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================================
            TAB 6: BILLING OPERATIONS & MANUAL ADJUSTMENTS
            ==================================================================== */}
        {currentTab === 'billing' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Billing Operations & Adjustments</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Audited plan overrides, storage add-on grants, and manual invoice adjustments.
                </p>
              </div>
            </div>

            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid #252832', borderRadius: 8, padding: 24 }}>
              <h3 style={{ margin: '0 0 16px' }}>Photographer Plan & Quota Adjustment</h3>
              <p style={{ fontSize: '0.85rem', color: '#64748B', marginBottom: 20 }}>
                Apply storage credits or upgrade subscription tier for customer support adjustments.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 500 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                    Adjustment Action
                  </label>
                  <select
                    value={billingAction}
                    onChange={(e) => setBillingAction(e.target.value)}
                    style={{
                      width: '100%',
                      padding: 10,
                      backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                      borderRadius: 6,
                      color: '#1E293B',
                      fontSize: '0.86rem',
                    }}
                  >
                    <option value="grant_storage">Grant +50 GB Storage Expansion</option>
                    <option value="change_plan">Change Subscription Plan</option>
                    <option value="apply_credit">Issue Account Balance Credit</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                    Mandatory Operational Justification:
                  </label>
                  <textarea
                    rows={3}
                    value={billingReason}
                    onChange={(e) => setBillingReason(e.target.value)}
                    placeholder="e.g. Customer support goodwill credit, annual contract bonus..."
                    style={{
                      width: '100%',
                      padding: 10,
                      backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                      borderRadius: 6,
                      color: '#1E293B',
                      fontSize: '0.86rem',
                    }}
                  />
                </div>

                <button
                  onClick={async () => {
                    try {
                      await api.adminAdjustBilling(1, { action: billingAction, reason: billingReason });
                      flashMessage('Billing adjustment applied and recorded in audit log.');
                      setBillingReason('');
                    } catch (err) {
                      flashMessage(err.message, true);
                    }
                  }}
                  disabled={!billingReason.trim()}
                  style={{
                    padding: '10px 18px',
                    backgroundColor: '#A78BFA',
                    border: 'none',
                    borderRadius: 6,
                    color: '#FFFFFF',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: billingReason.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  Apply Audited Billing Adjustment
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 7: CUSTOMER SUPPORT TICKETS
            ==================================================================== */}
        {currentTab === 'support' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Customer Support Tickets</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Track customer issues across login, uploads, face search, and billing.
                </p>
              </div>
              <button
                onClick={() => setNewTicketModal(true)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#A78BFA',
                  border: 'none',
                  borderRadius: 6,
                  color: '#FFFFFF',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                }}
              >
                + Create Support Ticket
              </button>
            </div>

            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid #252832', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(148, 163, 184, 0.18)', color: '#64748B' }}>
                    <th style={{ padding: '12px 16px' }}>Ticket ID</th>
                    <th style={{ padding: '12px 16px' }}>Subject</th>
                    <th style={{ padding: '12px 16px' }}>Category</th>
                    <th style={{ padding: '12px 16px' }}>Priority</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Update</th>
                  </tr>
                </thead>
                <tbody>
                  {supportTickets.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #1e2129' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: '#6D28D9' }}>
                        {t.id}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{t.subject}</div>
                        <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>{t.photographer_email}</div>
                      </td>
                      <td style={{ padding: '14px 16px', textTransform: 'capitalize' }}>
                        {t.category}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor:
                            t.priority === 'URGENT'
                              ? 'rgba(239, 68, 68, 0.2)'
                              : t.priority === 'HIGH'
                              ? 'rgba(245, 158, 11, 0.2)'
                              : 'rgba(113, 113, 122, 0.2)',
                          color:
                            t.priority === 'URGENT'
                              ? '#f87171'
                              : t.priority === 'HIGH'
                              ? '#fbbf24'
                              : '#d4d4d8',
                          fontWeight: 600,
                        }}>
                          {t.priority}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '3px 8px',
                          borderRadius: 4,
                          backgroundColor: t.status === 'RESOLVED' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(167, 139, 250, 0.12)',
                          color: t.status === 'RESOLVED' ? '#16a34a' : '#6D28D9',
                          fontWeight: 600,
                        }}>
                          {t.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {t.status !== 'RESOLVED' && (
                          <button
                            onClick={() => handleUpdateTicketStatus(t.id, 'RESOLVED')}
                            style={{
                              padding: '5px 10px',
                              backgroundColor: 'rgba(34, 197, 94, 0.15)',
                              border: '1px solid #22c55e',
                              borderRadius: 4,
                              color: '#4ade80',
                              fontSize: '0.76rem',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            Mark Resolved
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {supportTickets.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>
                        No support tickets currently open.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* New Ticket Modal */}
            {newTicketModal && (
              <div style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                padding: 20,
              }}>
                <div style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: 8,
                  padding: 24,
                  maxWidth: 480,
                  width: '100%',
                }}>
                  <h3 style={{ margin: '0 0 16px' }}>Open Customer Support Ticket</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                        Subject
                      </label>
                      <input
                        type="text"
                        value={ticketSubject}
                        onChange={(e) => setTicketSubject(e.target.value)}
                        placeholder="e.g. Upload timeout on 4K video"
                        style={{
                          width: '100%',
                          padding: 10,
                          backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                          border: '1px solid rgba(148, 163, 184, 0.18)',
                          borderRadius: 6,
                          color: '#1E293B',
                          fontSize: '0.86rem',
                        }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                          Category
                        </label>
                        <select
                          value={ticketCategory}
                          onChange={(e) => setTicketCategory(e.target.value)}
                          style={{
                            width: '100%',
                            padding: 10,
                            backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(148, 163, 184, 0.18)',
                            borderRadius: 6,
                            color: '#1E293B',
                            fontSize: '0.86rem',
                          }}
                        >
                          <option value="login">Login Problem</option>
                          <option value="upload">Upload Problem</option>
                          <option value="face_search">Face Search Problem</option>
                          <option value="gallery">Gallery Problem</option>
                          <option value="video">Video Problem</option>
                          <option value="storage">Storage Problem</option>
                          <option value="billing">Billing Problem</option>
                          <option value="performance">Performance Problem</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                          Priority
                        </label>
                        <select
                          value={ticketPriority}
                          onChange={(e) => setTicketPriority(e.target.value)}
                          style={{
                            width: '100%',
                            padding: 10,
                            backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(148, 163, 184, 0.18)',
                            borderRadius: 6,
                            color: '#1E293B',
                            fontSize: '0.86rem',
                          }}
                        >
                          <option value="LOW">LOW</option>
                          <option value="MEDIUM">MEDIUM</option>
                          <option value="HIGH">HIGH</option>
                          <option value="URGENT">URGENT</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                        Diagnostic Notes
                      </label>
                      <textarea
                        rows={3}
                        value={ticketNotes}
                        onChange={(e) => setTicketNotes(e.target.value)}
                        placeholder="Internal notes or customer conversation excerpt..."
                        style={{
                          width: '100%',
                          padding: 10,
                          backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                          border: '1px solid rgba(148, 163, 184, 0.18)',
                          borderRadius: 6,
                          color: '#1E293B',
                          fontSize: '0.86rem',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                      <button
                        onClick={() => setNewTicketModal(false)}
                        style={{
                          padding: '8px 14px',
                          backgroundColor: 'rgba(148, 163, 184, 0.22)',
                          border: 'none',
                          borderRadius: 6,
                          color: '#334155',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreateTicket}
                        disabled={!ticketSubject.trim()}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#A78BFA',
                          border: 'none',
                          borderRadius: 6,
                          color: '#FFFFFF',
                          fontWeight: 600,
                          cursor: ticketSubject.trim() ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Create Ticket
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================================
            TAB 8: INCIDENTS MANAGEMENT
            ==================================================================== */}
        {currentTab === 'incidents' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Platform Incident Management</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Track platform outages, degraded subsystems, severity classification (SEV-1 to SEV-4), and MTTD/MTTR.
                </p>
              </div>
              <button
                onClick={() => setNewIncidentModal(true)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#ef4444',
                  border: 'none',
                  borderRadius: 6,
                  color: '#1E293B',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                }}
              >
                + Declare Incident
              </button>
            </div>

            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid #252832', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(148, 163, 184, 0.18)', color: '#64748B' }}>
                    <th style={{ padding: '12px 16px' }}>Incident ID</th>
                    <th style={{ padding: '12px 16px' }}>Title</th>
                    <th style={{ padding: '12px 16px' }}>Severity</th>
                    <th style={{ padding: '12px 16px' }}>Subsystem</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => (
                    <tr key={inc.id} style={{ borderBottom: '1px solid #1e2129' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: '#6D28D9' }}>
                        {inc.id}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{inc.title}</div>
                        <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>Detected: {inc.detected_at}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor:
                            inc.severity === 'SEV-1'
                              ? '#ef4444'
                              : inc.severity === 'SEV-2'
                              ? '#f97316'
                              : '#eab308',
                          color: '#000',
                          fontWeight: 700,
                        }}>
                          {inc.severity}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>{inc.affected_subsystem}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '3px 8px',
                          borderRadius: 4,
                          backgroundColor: inc.status === 'RESOLVED' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                          color: inc.status === 'RESOLVED' ? '#4ade80' : '#f87171',
                          fontWeight: 600,
                        }}>
                          {inc.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {inc.status !== 'RESOLVED' && (
                          <button
                            onClick={() => handleUpdateIncidentStatus(inc.id, 'RESOLVED')}
                            style={{
                              padding: '5px 10px',
                              backgroundColor: 'rgba(34, 197, 94, 0.15)',
                              border: '1px solid #22c55e',
                              borderRadius: 4,
                              color: '#4ade80',
                              fontSize: '0.76rem',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {incidents.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>
                        No platform incidents recorded. System running smoothly.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Declare Incident Modal */}
            {newIncidentModal && (
              <div style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                padding: 20,
              }}>
                <div style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid #ef4444',
                  borderRadius: 8,
                  padding: 24,
                  maxWidth: 480,
                  width: '100%',
                }}>
                  <h3 style={{ margin: '0 0 16px', color: '#f87171' }}>Declare Operational Incident</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                        Incident Title
                      </label>
                      <input
                        type="text"
                        value={incidentTitle}
                        onChange={(e) => setIncidentTitle(e.target.value)}
                        placeholder="e.g. Cloudflare R2 presigned URL signature failures"
                        style={{
                          width: '100%',
                          padding: 10,
                          backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                          border: '1px solid rgba(148, 163, 184, 0.18)',
                          borderRadius: 6,
                          color: '#1E293B',
                          fontSize: '0.86rem',
                        }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                          Severity Level
                        </label>
                        <select
                          value={incidentSeverity}
                          onChange={(e) => setIncidentSeverity(e.target.value)}
                          style={{
                            width: '100%',
                            padding: 10,
                            backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(148, 163, 184, 0.18)',
                            borderRadius: 6,
                            color: '#1E293B',
                            fontSize: '0.86rem',
                          }}
                        >
                          <option value="SEV-1">SEV-1 (Critical Outage)</option>
                          <option value="SEV-2">SEV-2 (Major Subsystem)</option>
                          <option value="SEV-3">SEV-3 (Degraded Performance)</option>
                          <option value="SEV-4">SEV-4 (Minor Issue)</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                          Affected Subsystem
                        </label>
                        <input
                          type="text"
                          value={incidentSubsystem}
                          onChange={(e) => setIncidentSubsystem(e.target.value)}
                          style={{
                            width: '100%',
                            padding: 10,
                            backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(148, 163, 184, 0.18)',
                            borderRadius: 6,
                            color: '#1E293B',
                            fontSize: '0.86rem',
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                      <button
                        onClick={() => setNewIncidentModal(false)}
                        style={{
                          padding: '8px 14px',
                          backgroundColor: 'rgba(148, 163, 184, 0.22)',
                          border: 'none',
                          borderRadius: 6,
                          color: '#334155',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreateIncident}
                        disabled={!incidentTitle.trim()}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#ef4444',
                          border: 'none',
                          borderRadius: 6,
                          color: '#1E293B',
                          fontWeight: 600,
                          cursor: incidentTitle.trim() ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Declare Incident
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================================
            TAB 9: FEATURE FLAGS & EMERGENCY KILL SWITCHES
            ==================================================================== */}
        {currentTab === 'features' && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Emergency Controls & Feature Switches</h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                Safely isolate problematic subsystems without bringing down core gallery viewing or media downloads.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {features.map((feat) => (
                <div
                  key={feat.key}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                    border: `1px solid ${feat.key === 'maintenance_mode' && feat.enabled ? '#ef4444' : '#272a33'}`,
                    borderRadius: 8,
                    padding: 20,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.98rem' }}>{feat.key}</div>
                    <span style={{
                      fontSize: '0.72rem',
                      padding: '3px 8px',
                      borderRadius: 4,
                      backgroundColor: feat.enabled ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: feat.enabled ? '#4ade80' : '#f87171',
                      fontWeight: 600,
                    }}>
                      {feat.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.82rem', color: '#64748B', margin: '0 0 16px', minHeight: 38 }}>
                    {feat.description}
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Updated: {feat.updatedAt?.slice(0, 10)}</span>
                    <button
                      onClick={() => {
                        setKillSwitchModal(feat);
                        setKillSwitchConfirmText('');
                        setKillSwitchReason('');
                      }}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: feat.enabled ? '#ef4444' : '#22c55e',
                        border: 'none',
                        borderRadius: 4,
                        color: '#1E293B',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {feat.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Kill Switch Safeguard Modal */}
            {killSwitchModal && (
              <div style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                padding: 20,
              }}>
                <div style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid #ef4444',
                  borderRadius: 8,
                  padding: 24,
                  maxWidth: 480,
                  width: '100%',
                }}>
                  <h3 style={{ margin: '0 0 12px', color: '#f87171' }}>
                    Confirm Emergency Control: {killSwitchModal.key}
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: '#64748B', lineHeight: 1.5 }}>
                    You are changing the state of <strong>{killSwitchModal.key}</strong> from{' '}
                    <strong>{killSwitchModal.enabled ? 'ENABLED' : 'DISABLED'}</strong> to{' '}
                    <strong>{killSwitchModal.enabled ? 'DISABLED' : 'ENABLED'}</strong>.
                  </p>

                  {(killSwitchModal.key === 'maintenance_mode' || killSwitchModal.key === 'face_search') && (
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                        Type "CONFIRM" to authorize emergency switch:
                      </label>
                      <input
                        type="text"
                        value={killSwitchConfirmText}
                        onChange={(e) => setKillSwitchConfirmText(e.target.value)}
                        placeholder="CONFIRM"
                        style={{
                          width: '100%',
                          padding: 10,
                          backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                          border: '1px solid rgba(148, 163, 184, 0.18)',
                          borderRadius: 6,
                          color: '#1E293B',
                          fontSize: '0.86rem',
                        }}
                      />
                    </div>
                  )}

                  <label style={{ display: 'block', fontSize: '0.80rem', color: '#334155', marginBottom: 6 }}>
                    Mandatory Operational Justification:
                  </label>
                  <textarea
                    rows={2}
                    value={killSwitchReason}
                    onChange={(e) => setKillSwitchReason(e.target.value)}
                    placeholder="e.g. Memory spike detected in YuNet AI worker microservice..."
                    style={{
                      width: '100%',
                      padding: 10,
                      backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                      borderRadius: 6,
                      color: '#1E293B',
                      fontSize: '0.86rem',
                      marginBottom: 16,
                    }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      onClick={() => setKillSwitchModal(null)}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: 'rgba(148, 163, 184, 0.22)',
                        border: 'none',
                        borderRadius: 6,
                        color: '#334155',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleToggleFeature}
                      disabled={
                        !killSwitchReason.trim() ||
                        ((killSwitchModal.key === 'maintenance_mode' || killSwitchModal.key === 'face_search') &&
                          killSwitchConfirmText !== 'CONFIRM')
                      }
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#ef4444',
                        border: 'none',
                        borderRadius: 6,
                        color: '#1E293B',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Authorize Toggle
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================================
            TAB 10: IMMUTABLE AUDIT LOGS
            ==================================================================== */}
        {currentTab === 'audit' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 600 }}>Immutable Administrative Audit Trail</h1>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Cryptographically structured, append-only operational log recording every administrator mutation.
                </p>
              </div>
              <button
                onClick={() => loadTabData('audit')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: 6,
                  color: '#334155',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} /> Refresh Logs
              </button>
            </div>

            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', border: '1px solid #252832', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(148, 163, 184, 0.18)', color: '#64748B' }}>
                    <th style={{ padding: '12px 16px' }}>Timestamp</th>
                    <th style={{ padding: '12px 16px' }}>Operator</th>
                    <th style={{ padding: '12px 16px' }}>Action</th>
                    <th style={{ padding: '12px 16px' }}>Target</th>
                    <th style={{ padding: '12px 16px' }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #1e2129' }}>
                      <td style={{ padding: '12px 16px', color: '#64748B', fontSize: '0.78rem' }}>
                        {log.createdAt}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{log.adminEmail}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontFamily: 'monospace',
                          fontSize: '0.74rem',
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor: 'rgba(167, 139, 250, 0.12)',
                          color: '#6D28D9',
                          fontWeight: 600,
                        }}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '0.78rem' }}>
                        {log.targetType} {log.targetId ? `(#${log.targetId.slice(0, 10)})` : ''}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#334155' }}>
                        {log.reason}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>
                        No audit log entries recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
