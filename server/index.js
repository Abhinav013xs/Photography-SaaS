import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase } from './db.js';
import { startExpiryWorker } from './services/expiry_checker.js';

import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import mediaRoutes from './routes/media.js';
import guestRoutes from './routes/guest.js';
import storageRoutes from './routes/storage.js';
import billingRoutes from './routes/billing.js';
import adminRoutes from './routes/admin.js';
import db from './db.js';
import queue from './services/queue.js';

import helmet from 'helmet';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables (.env and .env.local)
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const app = express();
const PORT = process.env.PORT || 5000;

// Request ID tracking middleware
app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || uuidv4();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
});

// Security Headers (Clickjacking protection, MIME sniffing defense, Referrer policy)
app.use(
  helmet({
    contentSecurityPolicy: false, // API streaming & client compatibility
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// Controlled CORS Policy (prevents wildcard origin exposure with credentials)
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  process.env.APP_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error('Cross-Origin Request Blocked: Origin not permitted'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-guest-token'],
}));

// Body Parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize DB schema & start expiry background worker
initDatabase();
startExpiryWorker();

// Mount Administrative Control Center Routes (Phase 45)
app.use('/api/admin', adminRoutes);

// Maintenance Mode Enforcement Gate (Allows admins, restricts non-admins when active)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/admin') || req.path === '/api/health') {
    return next();
  }
  try {
    const maintenanceFlag = db.prepare("SELECT enabled FROM feature_flags WHERE key = 'maintenance_mode'").get();
    if (maintenanceFlag && maintenanceFlag.enabled === 1) {
      return res.status(503).json({
        error: 'Platform Maintenance in Progress',
        message: 'Studio Lumina is currently undergoing scheduled platform maintenance. Normal operations will resume shortly.',
        retryAfter: 300,
      });
    }
  } catch (err) {
    // If DB check fails, continue
  }
  next();
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/guest', guestRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/billing', billingRoutes);


// Liveness probe (Application process is alive)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    live: true,
    timestamp: new Date().toISOString(),
    service: 'Studio Lumina Photography Platform',
    requestId: req.id,
  });
});

// Readiness probe (Application is ready to accept user requests: DB and storage verified)
app.get('/api/ready', (req, res) => {
  try {
    // 1. Verify SQLite connectivity
    db.prepare('SELECT 1').get();

    // 2. Check storage status
    const r2Configured = Boolean(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
    );

    return res.json({
      status: 'ready',
      ready: true,
      database: 'connected',
      storage: r2Configured ? 'cloud_r2' : 'local_fallback',
      queue: queue.getMetrics(),
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  } catch (err) {
    console.error('[Readiness Check Failed]:', err.message);
    return res.status(503).json({
      status: 'not_ready',
      ready: false,
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  }
});

// Queue Backpressure & Telemetry Endpoint (Phase 48 Step 60)
app.get('/api/queue/metrics', (req, res) => {
  res.json({
    success: true,
    metrics: queue.getMetrics(),
    timestamp: new Date().toISOString(),
    requestId: req.id,
  });
});

// Serve frontend in production build if present
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// 404 Route Handler for undefined endpoints
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({
      error: `Endpoint not found: ${req.method} ${req.path}`,
      code: 'ROUTE_NOT_FOUND',
      requestId: req.id,
    });
  }
  const indexPath = path.join(clientDist, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).send('API Server running. Please run frontend via Vite dev server.');
    }
  });
});

// Global Centralized JSON Error Handler (Prevents stack trace leaks in production)
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  console.error(`[API Error] [${req.id || 'no-id'}] ${req.method} ${req.originalUrl}:`, {
    message: err.message,
    status,
    code: err.code,
  });

  res.status(status).json({
    error: isProd && status === 500 ? 'An unexpected internal server error occurred.' : (err.message || 'Internal Server Error'),
    code: err.code || (status === 500 ? 'INTERNAL_SERVER_ERROR' : undefined),
    requestId: req.id,
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`[Server] Studio Lumina Platform running on port ${PORT}`);
    console.log(`[Server] Health: http://localhost:${PORT}/api/health`);
    console.log(`=======================================================`);
  });
}

export default app;
export { app };
