import { Camera, Calendar, HardDrive, Settings, Plus, LogOut, Trash2, Shield } from 'lucide-react';

export default function Navbar({ currentView, setCurrentView, photographer, onLogout, onNewEvent }) {
  const navItems = [
    { id: 'events', label: 'Events & Galleries', icon: Calendar },
    { id: 'storage', label: 'Cloudflare Storage', icon: HardDrive },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'bin', label: 'Recycle Bin', icon: Trash2 },
  ];

  return (
    <header className="navbar-header-container">
      <div
        className="glass-panel-strong navbar-inner"
        style={{
          height: 64,
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--glass-border)',
        }}
      >
        {/* Brand & Nav */}
        <div className="navbar-left" style={{ display: 'flex', alignItems: 'center', gap: 20, minWidth: 0, flex: '1 1 auto' }}>
          <div 
            className="navbar-brand"
            onClick={() => setCurrentView('events')}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 12, 
              cursor: 'pointer',
              userSelect: 'none',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--accent-subtle)',
              border: '1px solid var(--accent-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary)',
              boxShadow: '0 2px 8px rgba(167, 139, 250, 0.16)',
              flexShrink: 0,
            }}>
              <Camera size={18} strokeWidth={2} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ 
                fontFamily: 'var(--font-display)', 
                fontSize: '1.25rem', 
                fontWeight: 600, 
                letterSpacing: '0.04em',
                lineHeight: 1.15,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
              }}>
                STUDIO LUMINA
              </div>
              <div className="navbar-brand-subtitle" style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>
                Photographer Platform
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="navbar-nav" style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flexShrink: 1, overflowX: 'auto' }}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  className={`btn ${isActive ? 'btn-secondary' : 'btn-ghost'}`}
                  onClick={() => setCurrentView(item.id)}
                  style={{
                    padding: '7px 12px',
                    fontSize: '0.82rem',
                    borderRadius: 'var(--radius-md)',
                    border: isActive ? '1px solid var(--accent-border)' : '1px solid transparent',
                    backgroundColor: isActive ? 'var(--accent-subtle)' : 'transparent',
                    color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
                    fontWeight: isActive ? 600 : 500,
                    boxShadow: isActive ? '0 2px 8px rgba(167, 139, 250, 0.12)' : 'none',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={15} style={{ color: isActive ? 'var(--accent-primary)' : 'inherit' }} />
                  <span className="nav-text">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Actions */}
        <div className="navbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button className="btn btn-primary" onClick={onNewEvent}>
            <Plus size={16} strokeWidth={2.5} />
            <span className="nav-btn-text">Create Event</span>
          </button>

          <div className="navbar-user-info" style={{
            height: 22,
            width: 1,
            backgroundColor: 'var(--border-subtle)',
            margin: '0 4px',
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="navbar-user-info" style={{
              textAlign: 'right',
              fontSize: '0.80rem',
              lineHeight: 1.25,
            }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {photographer?.business_name || 'Photographer'}
              </div>
              <div style={{ fontSize: '0.70rem', color: 'var(--text-muted)' }}>
                {photographer?.email || 'owner'}
              </div>
            </div>

            <button
              className="btn btn-ghost"
              onClick={() => {
                window.history.pushState({}, '', '/admin');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              title="Platform Control Center (Admins)"
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--accent-border)',
                backgroundColor: 'var(--accent-subtle)',
                color: 'var(--accent-text)',
                fontSize: '0.78rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Shield size={14} />
              <span className="nav-btn-text">Admin Center</span>
            </button>

            <button
              className="btn btn-ghost"
              onClick={onLogout}
              title="Logout"
              style={{
                padding: '8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--glass-border-subtle)',
                backgroundColor: 'rgba(255, 255, 255, 0.6)',
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
