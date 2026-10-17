# MASTER ENGINEERING ROADMAP (PHASES 0 TO 33)

This roadmap establishes the strict sequential implementation phases for the Photographer Gallery + AI Face Search Platform. Each phase builds incrementally on previous foundations. Future agents must execute one phase at a time and stop for validation.

---

### PHASE 0 — Project Initialization, Master Requirements & Engineering Rules
- **Status:** In Progress (Current Phase)
- **Scope:** Workspace inspection, single source of truth requirements definition (`docs/PRODUCT_REQUIREMENTS.md`), permanent agent rules (`AGENTS.md`), master roadmap, traceability matrix, and governance documents.

---

### PHASE 1 — Technical Architecture & System Design
- **Scope:** Deep architectural blueprint, component interaction diagrams, state management strategy, API contracts, R2 storage protocol, worker queue design, vector math specifications, and system boundaries.

---

### PHASE 2 — Project Foundation & Development Environment
- **Scope:** Environment variable conventions (`.env.example`), tooling scripts, TypeScript/ESM configuration, linting, formatting, project directory structure, and development scripts.

---

### PHASE 3 — Database Architecture & Migrations
- **Scope:** Complete relational schema (photographer, events, folders, media, face_embeddings, processing_jobs), vector schema, foreign key constraints, indexes, connection pools, and migration engine.

---

### PHASE 4 — Photographer Authentication & Security
- **Scope:** Single-owner authentication, bcrypt password hashing, secure JWT tokens, session lifecycle, protected API middleware, and credential management.

---

### PHASE 5 — Photographer Dashboard & Design System
- **Scope:** Editorial fine-art design system (typography, colors, tokens, spacing), responsive layout shells, top navigation, metrics strip, and base UI component library.

---

### PHASE 6 — Event Creation & Event Management
- **Scope:** Event CRUD operations, unique slug generation, event cover photo handling, metadata validation, status filtering, and search capabilities.

---

### PHASE 7 — Folder Management
- **Status:** Complete (Verified)
- **Scope:** Flat folder hierarchy within events, folder CRUD, reordering, event-scoped media assignment, batch media reassignment, and safe folder deletion mechanics (preserving media assets in event root).

---

### PHASE 8 — Cloudflare R2 Integration
- **Status:** Complete (Verified)
- **Scope:** S3-compatible R2 SDK client (`@aws-sdk/client-s3`), centralized storage adapter (`StorageAdapter`), deterministic object key generator (`events/{id}/originals|previews|thumbnails|videos|exports`), short-lived presigned URL generation (upload/download), metadata lookup (`headObject`, `objectExists`), controlled deletion, error normalization, and health-check monitoring (`/health`).

---

### PHASE 9 — Storage Management & Cloudflare Billing Navigation
- **Status:** Complete (Verified)
- **Scope:** Storage byte calculation engine (originals, derivatives, videos, per-event breakdown), freshness & staleness tracking, editorial Storage Management dashboard UI, zero fake quota enforcement, direct Cloudflare R2 bucket and billing navigation actions.

---

### PHASE 10 — Photo Upload Engine
- **Status:** Complete (Verified)
- **Scope:** Direct-to-R2 batch upload pipeline via presigned S3 PUT URLs, drag-and-drop client, per-file XHR progress tracking, client concurrency pool (4 workers), format validation (JPEG, PNG, WebP; strict SVG/HEIC rejection), size limits (100MB), batch limits (500 items), event/folder ownership validation, storage existence verification via headObject, idempotent database confirmation (`status = 'uploaded'`), cancellation, and retry handlers.

---

### PHASE 11 — Image Processing Pipeline
- **Status:** Complete (Verified)
- **Scope:** Asynchronous Sharp pipeline generating 480px WebP thumbnails and 1920px WebP previews, EXIF/orientation normalization (`rotate()`), decompression-bomb defense (50MP ceiling), magic bytes binary verification, bounded in-process worker queue (`AsyncImageProcessingQueue`, concurrency: 2), deterministic R2 storage keys (`events/{eventId}/thumbnails|previews/{mediaId}.webp`), PostgreSQL migration 003 tracking derivative sizes and errors, storage usage integration with Phase 9, manual retry endpoints (`POST /:mediaId/process`, `POST /process-batch`), and immutable original preservation.


---

### PHASE 12 — Video Upload & Processing
- **Status:** Complete (Verified)
- **Scope:** Video validation (MP4, MOV, WebM; max 500MB), direct-to-R2 presigned upload pipeline, defensive FFprobe probing (duration, streams, codecs, dimensions), WebP poster frame extraction (handling short videos < 1s), web-optimized 1080p H.264/AAC MP4 transcoding (+faststart moov atom, silent video handling), isolated worker queue (`AsyncVideoProcessingQueue`, concurrency = 1), immutable original video preservation in Cloudflare R2, PostgreSQL migration 004 (`video_codec`, `audio_codec`, `idx_media_event_type_status`), Phase 9 storage accounting integration (original videos, playback renditions, poster images without double counting), UI video support (badges, type filtering, duration tags, manual retry).

---

### PHASE 13 — Background Job & Worker Infrastructure
- **Status:** Complete (Verified)
- **Scope:** Centralized BullMQ & Redis worker infrastructure (`apps/api/src/services/queue/`), partitioned workload isolation (`photo-processing` concurrency = 4 with 3 retries, `video-processing` concurrency = 1 with 2 retries), PostgreSQL transactional outbox handoff in `confirmUploadBatch`, idempotent job execution (verifying DB status before execution and deterministic `jobId = mediaId`), graceful worker shutdown (`stopWorkers` with 10s grace period), migration 005 enhancing `processing_jobs` table (`attempts`, `last_attempt_at`, `completed_at`, `job_id`, performance indexes), failed job recovery service (`retryFailedJob`, `dispatchPendingOutboxJobs`), real-time queue metrics and subsystem `/health` integration.

---

### PHASE 14 — AI Face Detection
- **Status:** Complete (Verified)
- **Scope:** Deep learning face detection model integration (OpenCV YuNet ONNX `face_detection_yunet_2023mar.onnx` in `apps/ai`), multi-face bounding box extraction with normalized coordinates `[0, 1]`, 5-point facial landmark alignment, confidence score filtering, zero-face detection support, and Node.js AI client integration (`detectFacesInImage`).

---

### PHASE 15 — AI Face Embedding & Vector Storage
- **Status:** Complete (Verified)
- **Scope:** Deep learning face recognition model (OpenCV SFace ONNX `face_recognition_sface_2021dec.onnx` in `apps/ai`), 128-dimensional L2-normalized embedding extraction, pgvector storage in `face_embeddings` table with HNSW index (`vector_cosine_ops`), strict event scoping (`WHERE event_id = $eventId`), background queue photo post-processing integration in `workerManager.ts`, and cascade deletion lifecycle guarantees.

---

### PHASE 16 — AI Face Search
- **Status:** Complete (Verified)
- **Scope:** "Find My Photos" guest search pipeline (`POST /api/events/:eventId/face-search`), untrusted query selfie validation (JPEG/PNG/WebP magic bytes, 100B-10MB bounds, 25MP ceiling), exactly-one-face policy enforcement (`NO_FACE_DETECTED`, `MULTIPLE_FACES_DETECTED`), OpenCV YuNet + SFace compatible 128-D embedding extraction via Python AI service, query vector validation, event-scoped pgvector similarity query (`fe.embedding <=> $1::vector`), calibrated SFace threshold (0.363 cosine distance at FAR 0.001 benchmark), multi-face group photo deduplication (`GROUP BY m.id WITH MIN(distance)`), bounded pagination, sliding-window rate limiting (10 req/min per IP/event with Retry-After header), verified event access authorization guard (`requireEventAccess`), and biometric zero-retention guarantee (RAM-only decode and immediate buffer dereference).


---

### PHASE 17 — Guest Gallery
- **Scope:** Standalone, mobile-first guest interface, hero banner, folder tabs, responsive photo grid, fluid image loading, and full-screen lightbox viewer.

---

### PHASE 18 — Guest PIN Protection & Temporary Sessions
- **Status:** Complete (Verified)
- **Scope:** Event-scoped optional PIN protection (`pin_enabled`, `pin_hash` via salted bcrypt cost 10), leading-zeros string preservation (`0042` kept verbatim), fail-closed error handling (`403 PIN_CONFIGURATION_ERROR` on misconfiguration), sliding-window brute-force rate limiter (`PinRateLimiter`, 5 attempts in 15m returning `429 PIN_RATE_LIMITED` with `Retry-After`), ephemeral 12-hour signed guest session tokens (JWT + SHA-256 token hash in `guest_sessions` table), dual verification in `verifyEventAccess` middleware, instant cascade session invalidation on PIN update/disablement (`revokeEventGuestSessions`), guest session clearing (`POST /api/guest/session/clear/:eventId`), and strict event isolation preventing cross-event token reuse.

---

### PHASE 19 — Public/Private Gallery System
- **Status:** Complete (Verified)
- **Scope:** Dynamic visibility controls (`public` vs. `private`), strict server-side access enforcement (`verifyEventAccess` middleware and `/api/media/stream` route guard), fail-closed guest lockout on private galleries, complete independence of visibility and PIN protection (knowing PIN never overrides private visibility), instant cascade guest session revocation upon transition to `private` (`revokeEventGuestSessions`), protected direct media streaming with `Cache-Control: no-store` defense, photographer uninterrupted dashboard management, and editorial photographer UI controls (`PATCH /api/events/:id/visibility` with confirmation dialog and clear guest access warnings).

---

### PHASE 20 — Automatic 30-Day Gallery Expiry
- **Status:** Complete (Verified)
- **Scope:** Configurable public access duration (1..30 days, default 30, strictly validated rejecting > 30), migration `007_gallery_expiry.sql` (`public_duration_days`, `expired_at`, `idx_events_public_due`), authoritative UTC comparison (`now >= public_until`), dual-layer enforcement (instantaneous request-time guard returning HTTP 410 `GALLERY_EXPIRED` across all guest routes + proactive BullMQ delayed queue and 60s periodic reconciliation sweeper), atomic guarded transition (`UPDATE events SET visibility = 'private', expired_at = NOW() WHERE visibility = 'public' AND public_until <= NOW()`), cascade guest session revocation (`revokeEventGuestSessions`), republishing with fresh public period from authoritative `NOW()`, and inviolable non-destructive retention guarantee (zero deletion of media, folders, face embeddings, or R2 objects).

---

### PHASE 21 — Photo & Video Download System
- **Status:** Complete (Verified)
- **Scope:** Single high-resolution photo and supported video downloads via 15-minute presigned GET URLs with safe `Content-Disposition`, multi-select photo selection UX (up to 500 items) in guest gallery, asynchronous bulk ZIP archive generation via BullMQ (`zip-generation` queue) with real-time status polling, temporary ZIP archive storage in Cloudflare R2 (`events/{eventId}/exports/{jobId}.zip`) with 24-hour retention and periodic bounded cleanup, authoritative 10-point backend authorization check (`allow_downloads = true`, `status = 'active'`, `visibility = 'public'`, not expired, PIN verified, media belongs to event, `media.status = 'ready'`), safe filename sanitization preventing path traversal and header injection, and zero media deletion guarantee (cleanup, expiry, or privacy transitions never delete original media or derivatives).

---

### PHASE 22 — Watermark System
- **Status:** Complete (Verified)
- **Scope:** Event-configurable watermark system (`watermark_enabled`, `watermark_text`, `watermark_opacity`, `watermark_size`, `watermark_position`, `watermark_color`, `watermark_version`) applied selectively to guest-facing thumbnails and previews using Sharp SVG compositing. Complete preservation of clean master originals (`storage_key_original`) in Cloudflare R2 and authorized high-resolution downloads (Phase 21). Strict isolation from AI face recognition/embeddings (which operate exclusively on pristine originals). Monotonically increasing `watermark_version` per event with atomic database concurrency guards (`WHERE watermark_version <= $target OR watermark_version IS NULL`) to eliminate race conditions from out-of-order stale background jobs. Asynchronous reprocessing with manual trigger (`POST /api/events/:id/watermark/reprocess`) and status monitoring (`GET /api/events/:id/watermark/status`). Fine-art photographer UI with real-time responsive simulation card and reprocessing status.

---

### PHASE 23 — QR Code & Gallery Sharing
- **Status:** Complete (Verified)
- **Scope:** Canonical gallery URL construction derived strictly from validated server configuration (`APP_URL`) and stable public slug (`/gallery/:slug`) with HTTP Host Header injection defense. In-process local QR code generation via trusted `qrcode` library producing 1000px high-resolution print-ready PNG data URLs and clean SVG vector markup without third-party data egress. Strict preservation of gallery privacy (403 Forbidden), expiration (410 Gone), and PIN authorization (PINs are never embedded in URLs, QR matrixes, or filenames). Download filename sanitization (`${sanitizedEventName}_QR.png` / `${sanitizedEventName}_QR.svg`). Fine-art photographer sharing modals in both client applications (`client/src/components/QrModal.jsx` and `apps/web/components/dashboard/ShareModal.tsx`) featuring real-time access status banners (Public, PIN Protected, Private, Expired), interactive QR preview, one-click clipboard copy with feedback and fallback, and dedicated `@media print` printable event sign for physical event display.

---

### PHASE 24 — Gallery Lifecycle, Archive & Deletion
- **Scope:** Gallery archiving, gallery restoration, and permanent destructive deletion workflow (two-factor confirmation, cascading database purge, and complete R2 storage object deletion).

---

### PHASE 25 — Storage Cleanup & Data Integrity
- **Scope:** Orphaned R2 object garbage collection, media consistency checks, dangling embedding cleanup, and storage audit utilities.

---

### PHASE 26 — Security & Privacy Hardening
- **Scope:** Security headers (Helmet), CORS policies, strict input sanitization, rate limiting, biometric privacy compliance, and zero-retention verification.

---

### PHASE 27 — Performance & Concurrency Optimization
- **Scope:** SQLite WAL tuning / PostgreSQL pooling, Redis caching (where applicable), asset CDN caching headers, image delivery optimization, and client render optimization.

---

### PHASE 28 — Monitoring, Logging & Reliability
- **Scope:** Application logging, worker queue metrics, upload health tracking, error logging, and system health endpoints.

---

### PHASE 29 — Complete Automated & Browser Testing
- **Scope:** Comprehensive unit tests, integration tests, API route tests, authorization tests, and Playwright/Puppeteer browser tests across photographer and guest flows.

---

### PHASE 30 — Load Testing & Realistic Photography Workloads
- **Scope:** Simulated 5,000-photo event uploads, multi-user concurrent search load testing (500 concurrent guest face searches), and worker queue throughput benchmarks.

---

### PHASE 31 — Production Deployment
- **Scope:** Production environment configuration, process management (PM2 / Docker), reverse proxy (Nginx / Cloudflare), SSL/TLS certification, and domain configuration.

---

### PHASE 32 — Production Security Audit
- **Scope:** Penetration testing, cross-event isolation verification, secret scanning, biometric compliance audit, and brute-force resistance verification.

---

### PHASE 33 — Final End-to-End QA & Launch Readiness
- **Scope:** Final walkthrough of all photographer and guest flows, responsive cross-device validation, client sign-off checklist, and production cutover.
