import { Calendar, Image, Film, HardDrive, Cpu } from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function StatsStrip({ stats }) {
  const items = [
    {
      label: 'Total Events',
      value: stats?.totalEvents ?? 0,
      icon: <Calendar size={17} style={{ color: 'var(--accent-primary)' }} />,
      sub: `${stats?.activeEvents ?? 0} Active Galleries`,
      accent: 'var(--accent-primary)',
    },
    {
      label: 'Photo Assets',
      value: stats?.photoCount ?? 0,
      icon: <Image size={17} style={{ color: 'var(--status-success)' }} />,
      sub: formatBytes(stats?.photoBytes),
      accent: 'var(--status-success)',
    },
    {
      label: 'Video Assets',
      value: stats?.videoCount ?? 0,
      icon: <Film size={17} style={{ color: 'var(--status-warning)' }} />,
      sub: formatBytes(stats?.videoBytes),
      accent: 'var(--status-warning)',
    },
    {
      label: 'Storage Used',
      value: formatBytes(stats?.totalBytes),
      icon: <HardDrive size={17} style={{ color: 'var(--accent-primary)' }} />,
      sub: 'Cloudflare R2 Direct',
      accent: 'var(--accent-primary)',
    },
    {
      label: 'AI Indexed Faces',
      value: stats?.indexedFaces ?? 0,
      icon: <Cpu size={17} style={{ color: 'var(--status-info)' }} />,
      sub: 'Biometric Search Ready',
      accent: 'var(--status-info)',
    },
  ];

  return (
    <div className="stats-strip-grid">
      {items.map((item, idx) => (
        <div
          key={idx}
          className="glass-panel"
          style={{
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: 'var(--glass-bg)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--glass-border)',
          }}
        >
          {/* Subtle top indicator bar */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 20,
            right: 20,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${item.accent}30, transparent)`,
          }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: '0.74rem',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
            }}>
              {item.label}
            </span>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#FFFFFF',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 1px 3px rgba(50, 45, 38, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {item.icon}
            </div>
          </div>

          <div>
            <div style={{
              fontSize: '1.75rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              fontFamily: 'var(--font-sans)',
            }}>
              {item.value}
            </div>
            <div style={{
              fontSize: '0.76rem',
              color: 'var(--text-muted)',
              marginTop: 6,
              letterSpacing: '0.01em',
            }}>
              {item.sub}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
