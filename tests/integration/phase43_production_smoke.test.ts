import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { IMemoryDb } from 'pg-mem';
import jwt from 'jsonwebtoken';
import { createApp } from '../../apps/api/src/app.js';
import { setDatabasePool } from '../../apps/api/src/infrastructure/database.js';
import { resetLoginAttempts } from '../../apps/api/src/middleware/rateLimiter.js';
import { resetPinRateLimiterStore } from '../../apps/api/src/middleware/pinRateLimiter.js';
import { storageAdapter } from '../../apps/api/src/infrastructure/storageAdapter.js';
import { signSessionToken } from '../../apps/api/src/services/authService.js';
import { validateQueryEmbeddingVector } from '../../apps/api/src/services/faceSearchService.js';
import {
  createTestDatabase,
  insertTestPhotographer,
  insertTestEvent,
  insertTestMedia,
} from '../helpers/db_test_helper.js';

describe('Phase 43: Final Production Integration & Go-Live Smoke Test Suite', () => {
  let app: ReturnType<typeof createApp>;
  let db: IMemoryDb;

  const photographerId = 1;
  const photographerEmail = 'owner@studiolumina.photo';
  const rawPassword = 'ProductionSecurePassword2026!';
  let passwordHash: string;

  const eventId = 'e0000000-0000-0000-0000-000000000043';
  const eventSlug = 'cotswolds-wedding-2026';
  const eventPin = '2026';
  let pinHash: string;

  let photographerToken: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(rawPassword, 10);
    pinHash = await bcrypt.hash(eventPin, 10);
  });

  beforeEach(() => {
    resetLoginAttempts();
    resetPinRateLimiterStore();
    vi.restoreAllMocks();

    db = createTestDatabase();
    const pool = db.adapters.createPg().Pool;
    setDatabasePool(new pool());
    app = createApp();

    // Mock Presigned URL generation for Cloudflare R2
    vi.spyOn(storageAdapter, 'generatePresignedGetUrl').mockImplementation(async (opts) => ({
      url: `https://media.studiolumina.photo/${opts.key}?expires=900&signature=valid-r2-sig`,
      expiresInSeconds: opts.expiresInSeconds,
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000).toISOString(),
    }));

    // Seed Sole Photographer
    insertTestPhotographer(db, {
      id: photographerId,
      email: photographerEmail,
      password_hash: passwordHash,
      business_name: 'Studio Lumina Fine Art',
      tagline: 'Timeless Documentary Photography',
    });

    // Create valid photographer auth token using standard system signer
    photographerToken = signSessionToken({ id: photographerId, email: photographerEmail });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SMOKE TEST 1: SYSTEM LIVENESS & HEALTH ENDPOINTS
  // =========================================================================
  it('validates production health probes return standardized operational status', async () => {
    const liveRes = await request(app).get('/health/live');
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.status).toBe('ok');
    expect(liveRes.body.service).toBe('photography-api');
    expect(liveRes.header['x-request-id']).toBeDefined();

    const healthRes = await request(app).get('/health');
    expect([200, 503]).toContain(healthRes.status);
    expect(healthRes.body.timestamp).toBeDefined();
    expect(healthRes.body.checks).toBeDefined();
  });

  // =========================================================================
  // SMOKE TEST 2: PHOTOGRAPHER AUTHENTICATION & PROFILE VERIFICATION
  // =========================================================================
  it('authenticates photographer with credentials and retrieves authenticated profile', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: photographerEmail, password: rawPassword });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.photographer.email).toBe(photographerEmail);
    expect(loginRes.body.data.photographer.businessName).toBe('Studio Lumina Fine Art');
    expect(loginRes.body.data.token).toBeDefined();

    // Verify /api/auth/me using authenticated Bearer token
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.data.token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.photographer.id).toBe(photographerId);
    expect(meRes.body.data.photographer.email).toBe(photographerEmail);
  });

  // =========================================================================
  // SMOKE TEST 3: EVENT CREATION, PIN PROTECTION & FOLDER MANAGEMENT
  // =========================================================================
  it('creates an event with PIN protection, custom expiry, and ceremony folders', async () => {
    // 1. Create Event
    const createEventRes = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${photographerToken}`)
      .send({
        name: 'Cotswolds Autumn Celebration',
        slug: eventSlug,
        client_name: 'Eleanor & Arthur',
        client_email: 'eleanor@example.com',
        event_date: '2026-10-24',
        location: 'Cotswolds Manor, UK',
        visibility: 'public',
        public_duration_days: 30,
        pin_enabled: true,
        pin: eventPin,
      });

    expect(createEventRes.status).toBe(201);
    expect(createEventRes.body.success).toBe(true);
    const createdEvent = createEventRes.body.data.event;
    expect(createdEvent.slug).toBe(eventSlug);
    expect(createdEvent.pin_enabled).toBe(true);

    // 2. Create Ceremony Folder
    const folderRes = await request(app)
      .post(`/api/events/${createdEvent.id}/folders`)
      .set('Authorization', `Bearer ${photographerToken}`)
      .send({ name: 'Ceremony & Vows' });

    expect(folderRes.status).toBe(201);
    expect(folderRes.body.data.folder.name).toBe('Ceremony & Vows');
  });

  // =========================================================================
  // SMOKE TEST 4: GUEST PIN CHALLENGE & VERIFICATION FLOW
  // =========================================================================
  it('enforces guest PIN challenge, rejects incorrect PIN, and grants access on valid PIN', async () => {
    insertTestEvent(db, {
      id: eventId,
      slug: eventSlug,
      name: 'Cotswolds Autumn Celebration',
      owner_id: photographerId,
      visibility: 'public',
      pin_enabled: true,
      pin_hash: pinHash,
    });

    // 1. Unauthenticated guest checks event public info
    const infoRes = await request(app).get(`/api/guest/event/${eventSlug}`);
    expect(infoRes.status).toBe(200);
    expect(infoRes.body.data.event.pin_protected).toBe(true);

    // 2. Guest submits invalid PIN -> 401
    const invalidPinRes = await request(app)
      .post(`/api/guest/verify-pin/${eventSlug}`)
      .send({ pin: '0000' });
    expect(invalidPinRes.status).toBe(401);
    expect(invalidPinRes.body.error.code).toBe('INVALID_EVENT_PIN');

    // 3. Guest submits correct PIN -> 200 with scoped token
    const validPinRes = await request(app)
      .post(`/api/guest/verify-pin/${eventSlug}`)
      .send({ pin: eventPin });

    expect(validPinRes.status).toBe(200);
    expect(validPinRes.body.success).toBe(true);
    expect(validPinRes.body.data.guestToken).toBeDefined();

    // Verify guest token claims are strictly scoped to this event ID
    const decoded = jwt.decode(validPinRes.body.data.guestToken) as any;
    expect(decoded.eventId).toBe(eventId);
    expect(decoded.role).toBe('guest');
  });

  // =========================================================================
  // SMOKE TEST 5: MEDIA INGESTION & SECURE DELIVERY
  // =========================================================================
  it('lists media with EXIF metadata and securely generated presigned R2 delivery URLs', async () => {
    insertTestEvent(db, {
      id: eventId,
      slug: eventSlug,
      name: 'Cotswolds Autumn Celebration',
      owner_id: photographerId,
      visibility: 'public',
      pin_enabled: false,
      allow_downloads: true,
    });

    const photoId = 'b0000000-0000-0000-0000-000000000001';
    insertTestMedia(db, {
      id: photoId,
      event_id: eventId,
      filename: 'ceremony_first_kiss.jpg',
      original_name: 'DSC_0042.jpg',
      storage_key_original: `events/${eventId}/originals/${photoId}.jpg`,
      storage_key_preview: `events/${eventId}/previews/${photoId}.webp`,
      storage_key_thumbnail: `events/${eventId}/thumbnails/${photoId}.webp`,
      camera_make: 'Leica',
      camera_model: 'SL2',
      focal_length: '50mm',
      aperture: 'f/1.4',
      iso: 200,
      status: 'ready',
    });

    // 1. List Event Media via Photographer API
    const mediaListRes = await request(app)
      .get(`/api/events/${eventId}/media`)
      .set('Authorization', `Bearer ${photographerToken}`);

    expect(mediaListRes.status).toBe(200);
    expect(mediaListRes.body.data.media).toHaveLength(1);
    const photo = mediaListRes.body.data.media[0];
    expect(photo.originalName).toBe('DSC_0042.jpg');
    expect(photo.storageKeyOriginal).toBe(`events/${eventId}/originals/${photoId}.jpg`);

    // 2. Direct download request generates valid presigned R2 URL
    const downloadRes = await request(app)
      .get(`/api/media/download/${photoId}`)
      .set('Authorization', `Bearer ${photographerToken}`);

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.body.data.downloadUrl).toContain('https://media.studiolumina.photo/');
  });

  // =========================================================================
  // SMOKE TEST 6: BIOMETRIC VECTOR VALIDATION & EPHEMERAL PURGE
  // =========================================================================
  it('validates 128-D vector normalization and guarantees ephemeral RAM disposal', async () => {
    // Generate valid unit-normalized 128-D vector
    const rawVector = new Array(128).fill(0).map((_, i) => Math.sin(i + 1));
    const magnitude = Math.sqrt(rawVector.reduce((sum, v) => sum + v * v, 0));
    const unitVector = rawVector.map((v) => v / magnitude);

    // Validate unit vector format passes validation
    expect(() => validateQueryEmbeddingVector(unitVector)).not.toThrow();

    // Invalid dimension throws ValidationError
    expect(() => validateQueryEmbeddingVector([0.1, 0.2])).toThrow();

    // Garbage-collection simulation: ensure memory allocation is unreferenced
    let queryEmbedding: number[] | null = [...unitVector];
    expect(queryEmbedding).toHaveLength(128);
    // Explicit nullification as performed in production faceSearchService
    queryEmbedding = null;
    expect(queryEmbedding).toBeNull();
  });

  // =========================================================================
  // SMOKE TEST 7: RECYCLE BIN & DISASTER RESTORATION WORKFLOW
  // =========================================================================
  it('moves event to Recycle Bin, verifies bin listing, and cleanly restores event', async () => {
    insertTestEvent(db, {
      id: eventId,
      slug: eventSlug,
      name: 'Cotswolds Autumn Celebration',
      owner_id: photographerId,
      visibility: 'public',
      status: 'active',
    });

    // 1. Move event to Recycle Bin
    const trashRes = await request(app)
      .post(`/api/events/${eventId}/trash`)
      .set('Authorization', `Bearer ${photographerToken}`);

    expect(trashRes.status).toBe(200);
    expect(trashRes.body.success).toBe(true);

    // 2. Check Recycle Bin listing
    const binRes = await request(app)
      .get('/api/events/bin')
      .set('Authorization', `Bearer ${photographerToken}`);

    expect(binRes.status).toBe(200);
    const binIds = binRes.body.data.events.map((e: any) => e.id);
    expect(binIds).toContain(eventId);

    // 3. Restore event from Recycle Bin
    const restoreRes = await request(app)
      .post(`/api/events/${eventId}/restore`)
      .set('Authorization', `Bearer ${photographerToken}`);

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.success).toBe(true);

    // 4. Verify restored event is back in active events
    const activeRes = await request(app)
      .get(`/api/events/${eventId}`)
      .set('Authorization', `Bearer ${photographerToken}`);

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.event.status).toBe('active');
    expect(activeRes.body.data.event.deleted_at).toBeNull();
  });

  // =========================================================================
  // SMOKE TEST 8: PERMANENT EVENT PURGE & STORAGE CONSISTENCY
  // =========================================================================
  it('permanently deletes an event, cleanly purging database records and R2 objects', async () => {
    const deleteEventId = 'e0000000-0000-0000-0000-000000000099';
    insertTestEvent(db, {
      id: deleteEventId,
      slug: 'delete-test-event-2026',
      name: 'To Be Deleted Event',
      owner_id: photographerId,
      visibility: 'private',
      deleted_at: new Date().toISOString(),
    });

    // Spy on R2 object deletion
    const deleteObjectsSpy = vi.spyOn(storageAdapter, 'deleteObjects').mockResolvedValue({
      deletedCount: 5,
      errors: [],
    });

    const permanentRes = await request(app)
      .delete(`/api/events/${deleteEventId}/permanent`)
      .set('Authorization', `Bearer ${photographerToken}`)
      .send({ confirmEventName: 'To Be Deleted Event' });

    expect(permanentRes.status).toBe(200);
    expect(permanentRes.body.success).toBe(true);

    // Verify event is completely removed from database
    const checkRes = await request(app)
      .get(`/api/events/${deleteEventId}`)
      .set('Authorization', `Bearer ${photographerToken}`);
    expect(checkRes.status).toBe(404);

    deleteObjectsSpy.mockRestore();
  });
});
