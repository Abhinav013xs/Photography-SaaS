import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar.jsx';
import EventsView from './components/EventsView.jsx';
import EventDetailView from './components/EventDetailView.jsx';
import StorageView from './components/StorageView.jsx';
import SettingsView from './components/SettingsView.jsx';
import LoginView from './components/LoginView.jsx';
import CreateEventModal from './components/CreateEventModal.jsx';
import QrModal from './components/QrModal.jsx';
import EventSettingsModal from './components/EventSettingsModal.jsx';
import GuestGalleryView from './components/GuestGalleryView.jsx';
import BinView from './components/BinView.jsx';
import BillingView from './components/BillingView.jsx';
import AdminPortal from './components/admin/AdminPortal.jsx';
import api from './api.js';

export default function App() {
  // Check if we are on a guest gallery route: /gallery/:slug
  const [pathname, setPathname] = useState(window.location.pathname);

  // Photographer session
  const [photographer, setPhotographer] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // App navigation
  const [currentView, setCurrentView] = useState('events'); // 'events' | 'storage' | 'settings'
  const [selectedEventId, setSelectedEventId] = useState(null);

  // Events list state
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [sortOption, setSortOption] = useState('date_desc');

  // Global modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [qrModalEvent, setQrModalEvent] = useState(null);
  const [settingsModalEvent, setSettingsModalEvent] = useState(null);

  // Listen to popstate for URL routing
  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Check auth session
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('photographer_token');
      if (!token) {
        setAuthLoading(false);
        return;
      }
      try {
        const res = await api.getMe();
        setPhotographer(res?.photographer || res?.data?.photographer || null);
      } catch (err) {
        localStorage.removeItem('photographer_token');
      } finally {
        setAuthLoading(false);
      }
    };
    checkAuth();
  }, []);

  // Fetch events list and stats
  const fetchEvents = async () => {
    if (!photographer) return;
    try {
      setEventsLoading(true);
      const res = await api.getEvents({
        status: statusFilter,
        search: searchTerm,
        sort: sortOption,
      });
      const allEvents = res?.events || res?.data?.events || [];
      setEvents(allEvents);

      // Calculate aggregate stats
      const totalPhotos = allEvents.reduce((acc, e) => acc + (e.photo_count || 0), 0);
      const totalVideos = allEvents.reduce((acc, e) => acc + (e.video_count || 0), 0);
      const totalBytes = allEvents.reduce((acc, e) => acc + (e.total_size_bytes || 0), 0);
      const totalFaces = allEvents.reduce((acc, e) => acc + (e.face_count || 0), 0);

      setStats({
        totalEvents: allEvents.length,
        activeEvents: allEvents.filter((e) => e.status === 'active').length,
        photoCount: totalPhotos,
        videoCount: totalVideos,
        totalBytes: totalBytes,
        indexedFaces: totalFaces,
        photoBytes: totalBytes,
        videoBytes: 0,
      });
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [photographer, statusFilter, searchTerm, sortOption]);

  // Handle Event Actions
  const handleArchive = async (id) => {
    try {
      await api.archiveEvent(id);
      fetchEvents();
    } catch (err) {
      alert(err.message || 'Failed to archive event');
    }
  };

  const handleRestore = async (id) => {
    try {
      await api.restoreEvent(id);
      fetchEvents();
    } catch (err) {
      alert(err.message || 'Failed to restore event');
    }
  };

  const handleDelete = async (id, confirmEventName) => {
    try {
      await api.deleteEvent(id, confirmEventName);
      if (selectedEventId === id) setSelectedEventId(null);
      await fetchEvents();
    } catch (err) {
      alert(err.message || 'Failed to delete event');
      throw err;
    }
  };

  // 1. ROUTE: GUEST GALLERY PORTAL (/gallery/:slug)
  if (pathname.startsWith('/gallery/')) {
    const slug = pathname.replace('/gallery/', '').split('/')[0];
    return <GuestGalleryView slug={slug} />;
  }

  // 1b. ROUTE: PLATFORM CONTROL CENTER (/admin)
  if (pathname === '/admin' || pathname.startsWith('/admin')) {
    return (
      <AdminPortal
        onExitAdmin={() => {
          window.history.pushState({}, '', '/');
          setPathname('/');
        }}
      />
    );
  }

  // 2. AUTHENTICATION LOADING
  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-muted)',
      }}>
        Loading Studio Lumina Platform...
      </div>
    );
  }

  // 3. PHOTOGRAPHER LOGIN SCREEN
  if (!photographer) {
    return (
      <LoginView
        onLoginSuccess={(p) => {
          setPhotographer(p);
        }}
      />
    );
  }

  // 4. PHOTOGRAPHER MASTER DASHBOARD
  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      <Navbar
        currentView={currentView}
        setCurrentView={(view) => {
          setCurrentView(view);
          setSelectedEventId(null); // Return to list view
        }}
        photographer={photographer}
        onLogout={() => {
          api.logout();
          setPhotographer(null);
        }}
        onNewEvent={() => setShowCreateModal(true)}
      />

      <main className="app-main-content">
        {/* VIEW: EVENTS & GALLERIES */}
        {currentView === 'events' && (
          <>
            {selectedEventId ? (
              <EventDetailView
                eventId={selectedEventId}
                onBack={() => {
                  setSelectedEventId(null);
                  fetchEvents();
                }}
              />
            ) : (
              <EventsView
                events={events}
                stats={stats}
                loading={eventsLoading}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                sortOption={sortOption}
                setSortOption={setSortOption}
                onSelectEvent={(id) => setSelectedEventId(id)}
                onNewEvent={() => setShowCreateModal(true)}
                onOpenQr={(ev) => setQrModalEvent(ev)}
                onOpenSettings={(ev) => setSettingsModalEvent(ev)}
                onArchive={handleArchive}
                onRestore={handleRestore}
                onDelete={() => fetchEvents()}
              />
            )}
          </>
        )}

        {/* VIEW: STORAGE */}
        {currentView === 'storage' && (
          <StorageView
            onSelectEvent={(id) => {
              setCurrentView('events');
              setSelectedEventId(id);
            }}
          />
        )}

        {/* VIEW: COMMERCIAL BILLING & QUOTAS */}
        {currentView === 'billing' && (
          <BillingView />
        )}

        {/* VIEW: SETTINGS */}
        {currentView === 'settings' && (
          <SettingsView
            photographer={photographer}
            onProfileUpdated={(updated) => setPhotographer(updated)}
          />
        )}

        {/* VIEW: RECYCLE BIN */}
        {currentView === 'bin' && (
          <BinView
            onEventRestored={() => {
              fetchEvents();
            }}
          />
        )}
      </main>

      {/* Global Modals */}
      {showCreateModal && (
        <CreateEventModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(newEvent) => {
            fetchEvents();
            if (newEvent?.id) {
              setSelectedEventId(newEvent.id);
            }
          }}
        />
      )}

      {qrModalEvent && (
        <QrModal
          event={qrModalEvent}
          onClose={() => setQrModalEvent(null)}
        />
      )}

      {settingsModalEvent && (
        <EventSettingsModal
          event={settingsModalEvent}
          onClose={() => setSettingsModalEvent(null)}
          onUpdated={() => fetchEvents()}
        />
      )}
    </div>
  );
}
