import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requestIdMiddleware } from './middleware/requestId.js';
import { requestLoggerMiddleware } from './middleware/logger.js';
import { errorHandlerMiddleware } from './middleware/errorHandler.js';
import { NotFoundError } from '@photography-saas/errors';
import healthRouter, { readyCheckHandler } from './routes/health.js';
import authRouter from './routes/auth.js';
import eventsRouter from './routes/events.js';
import storageRouter from './routes/storage.js';
import faceSearchRouter from './routes/faceSearch.js';
import { guestRouter } from './routes/guest.js';
import { downloadsRouter } from './routes/downloads.js';
import billingRouter from './routes/billing.js';
import internalIndexingRouter from './routes/internalIndexing.js';
import { getConfig } from '@photography-saas/config';

/**
 * Creates and configures the Express application instance.
 */
export function createApp(): Express {
  const config = getConfig();
  const app = express();

  // Trust first proxy (e.g. Cloudflare / reverse proxy) for accurate IP resolution
  app.set('trust proxy', 1);

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Configured for API mode
      frameguard: { action: 'deny' },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // CORS Policy
  app.use(
    cors({
      origin: config.appUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Guest-Token', 'X-Internal-Service-Key'],
    })
  );

  // Body and Cookie Parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // Request Correlation & Logging
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);

  // Health and Diagnostic Probes
  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);
  app.get('/ready', readyCheckHandler);
  app.get('/api/ready', readyCheckHandler);

  // Internal AI Indexing Domain
  app.use('/internal', internalIndexingRouter);
  app.use('/api/internal', internalIndexingRouter);

  // Authentication Domain
  app.use('/api/auth', authRouter);
  app.use('/auth', authRouter);

  // Phase 18: Guest Domain (PIN Protection & Sessions)
  app.use('/api/guest', guestRouter);
  app.use('/guest', guestRouter);

  // AI Face Search Domain (Guest Find My Photos)
  app.use('/api/events/:eventId/face-search', faceSearchRouter);
  app.use('/events/:eventId/face-search', faceSearchRouter);
  app.use('/api/guest/events/:eventId/face-search', faceSearchRouter);
  app.use('/guest/events/:eventId/face-search', faceSearchRouter);

  // Events Domain (Phase 6)
  app.use('/api/events', eventsRouter);
  app.use('/events', eventsRouter);

  // Storage Domain (Phase 9)
  app.use('/api/storage', storageRouter);
  app.use('/storage', storageRouter);

  // Phase 21: Download System (Direct Media & Job Routes)
  app.use('/api', downloadsRouter);
  app.use(downloadsRouter);

  // Phase 44: SaaS Commercial & Billing Domain
  app.use('/api/billing', billingRouter);
  app.use('/billing', billingRouter);


  // Catch-all for unmatched routes
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // Global Error Handler
  app.use(errorHandlerMiddleware);

  return app;
}
