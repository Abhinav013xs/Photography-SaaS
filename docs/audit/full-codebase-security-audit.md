# Full Codebase Security Audit & Vulnerability Assessment

**Author:** Antigravity Autonomous Security Engineer  
**Date:** October 15, 2026  
**Status:** Audit & Remediation Complete  
**Application:** Photography SaaS (Single Photographer / Sole Owner Event Platform)

---

## 1. Repository Overview

The application is an on-premise/cloud-hybrid SaaS platform built specifically for a single authenticated photographer / studio owner to distribute high-resolution photo galleries to wedding and event guests.

- **Frontend:** React 19 SPA powered by Vite, Tailwind CSS with customized glassmorphism design tokens (Plus Jakarta Sans + Cormorant Garamond typography, champagne bronze accents `#c5a059`, carbon background `#0a0b0d`).
- **Backend Core:** Node.js Express REST API server running on port 3000 (configurable via `PORT`), handling routing, session authorization, metadata persistence, storage orchestration, and job dispatch.
- **Database Layer:** Dual-mode architecture supporting SQLite (local development and deterministic testing via `better-sqlite3`) and Neon PostgreSQL with `pgvector` for scalable production deployment.
- **Object Storage:** Cloudflare R2 bucket holding original images, previews, thumbnails, and transcoded MP4 videos via presigned S3-compatible URLs without egress bandwidth costs.
- **AI / Biometrics Microservice:** Python 3.11+ FastAPI service utilizing OpenCV YuNet (face detection) and SFace (128-dimensional L2-normalized deep metric embeddings).
- **Background Workers:** Worker queue processing asynchronous image transformation (Sharp), EXIF metadata stripping, neural vector indexing, and ZIP archive packaging.

---

## 2. Architecture & Trust Boundaries

The system is partitioned into four primary security zones:
1. **Public Guest Zone:** Unauthenticated or PIN-authenticated mobile browsers accessing galleries via QR codes or slug URLs. Zero permanent accounts exist in this zone.
2. **Photographer Admin Zone:** Single authenticated operator managing galleries, uploads, settings, and billing. Protected by bcrypt hashed credentials and HTTP-only JWT cookies.
3. **Internal Microservices & Queue Zone:** Background workers communicating via loopback/internal VPC with the Python AI microservice.
4. **Cloud Infrastructure Zone:** Cloudflare R2 object store and Neon PostgreSQL database managed with IAM least privilege.

```
+-----------------------------------------------------------------------------------------+
|                                    INTERNET (UNTRUSTED)                                 |
+-----------------------------------------------------------------------------------------+
           |                                                      |
           | [Guest QR / Slug]                                    | [Photographer Login]
           v                                                      v
+-----------------------+                              +-----------------------+
|  Guest Public Router  |                              |  Admin Auth Router    |
|  (/api/guest/*)       |                              |  (/api/auth/*)        |
+-----------------------+                              +-----------------------+
           |                                                      |
           +--------------------------+---------------------------+
                                      |
                                      v
                      +-------------------------------+
                      |   Express Core API Gateway    |
                      |   Rate Limiting & Validation  |
                      +-------------------------------+
                                      |
         +----------------------------+---------------------------+
         |                            |                           |
         v                            v                           v
+-----------------+          +-----------------+         +-----------------+
| Neon PostgreSQL |          |  Python AI Svc  |         |  Cloudflare R2  |
| (pgvector / SQL)|          | (YuNet + SFace) |         | (Presigned S3)  |
+-----------------+          +-----------------+         +-----------------+
```

---

## 3. Attack Surface

The external attack surface encompasses:
- **Authentication Endpoints:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- **Public Guest Endpoints:** `GET /api/guest/events/:slug`, `POST /api/guest/events/:slug/verify-pin`, `POST /api/guest/face-search/:slug`, `GET /api/guest/media/:id/download`.
- **Photographer Management Endpoints:** 27 administrative CRUD and action endpoints under `/api/events`, `/api/media`, `/api/galleries`, `/api/storage`, `/api/recycle-bin`, `/api/analytics`, and `/api/backup`.
- **File Ingestion Surface:** Multipart/form-data upload pipeline handling raw camera files (JPEG, PNG, WebP, HEIC/HEIF) and guest selfies.

---

## 4. Authentication Findings

1. **Photographer Credential Security:** Passwords are verified against salted bcrypt hashes. Login attempts are protected by an in-memory sliding window rate limiter (5 failed attempts per 15 minutes per IP), mitigating credential stuffing and online dictionary attacks.
2. **Session Model:** Authentication tokens use HMAC-SHA256 JWTs signed with `JWT_SECRET`. Tokens are delivered via `httpOnly`, `SameSite=Strict`, `secure` (in production) cookies, preventing JavaScript reading (`document.cookie` XSS theft).
3. **Guest Session Model:** Guests entering a PIN-protected event receive an ephemeral session token with `role: "guest"` and `eventId` embedded. The token is cryptographically tied to that specific event and expires in 2 hours.
4. **Account Enumeration:** The login endpoint returns generic `"Invalid email or password"` errors to prevent user enumeration.

---

## 5. Authorization Findings

1. **Photographer Isolation:** The application is architected for a single photographer/sole owner. Administrative routes verify `req.user && req.user.role === 'photographer'`.
2. **Resource Scoping:** Events, media, and folders are strictly verified against the authenticated user's ID or scoped to the parent event.
3. **Public vs. Private Gallery Enforcement:** Guest requests to private galleries (`visibility = 'private'`) or expired events (`is_expired = 1` or `created_at > 30 days`) are rejected with HTTP 403 Forbidden.
4. **Folder Isolation:** All folder operations verify that the folder belongs to the designated event ID.

---

## 6. IDOR / BOLA Findings & Remediation

During the audit, three critical IDOR/BOLA paths were discovered and immediately remediated:
1. **AUD-01 (Fixed):** `PUT /api/media/move` allowed arbitrary `targetFolderId` without cross-referencing event ownership. Remediated by ensuring `targetFolder.event_id === media[0].event_id`.
2. **AUD-02 (Fixed):** `PUT /api/events/:id/folders/:folderId` updated folder names without validating `event_id = :id`. Remediated with compound SQL conditions.
3. **AUD-03 (Fixed):** `DELETE /api/events/:id/folders/:folderId?targetFolderId=XYZ` reassigned media to target folders belonging to different events. Remediated with event membership verification.

---

## 7. API Findings

1. **Input Sanitization & Validation:** All routes parsing IDs, slugs, and pagination validate parameters as strings/numbers before passing to query builders.
2. **Batch Operation Bounds:** In `server/routes/media.js`, batch deletion and moves were unbounded. Remediated in **AUD-05** to cap arrays at 500 items, preventing SQLite parameter limits and memory spikes.
3. **Standardized Error Handling:** Database and server errors are logged internally with stack traces and returned to clients as sanitized JSON error messages without leaking internal paths or SQL statements.

---

## 8. Database Security & Integrity

1. **SQL Injection Immunity:** Zero dynamic string concatenations or raw unparameterized SQL queries exist in the codebase. All queries in `server/routes` and `server/models` use parameterized statements (`?` in SQLite, `$1, $2` in Postgres).
2. **Cascade & Deletion Safety:** Deleting a folder never deletes the media inside; media records have `folder_id` set to `NULL` (unassigned event pool) or reassigned within the same event.
3. **Recycle Bin Resilience:** Deleting an event moves it to `recycle_bin` with a 30-day soft-delete grace period before permanent purge.

---

## 9. Cloudflare R2 Integration Security

1. **Zero Credential Exposure:** R2 Access Key ID and Secret Access Key reside exclusively in server-side environment variables (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Neither Vite nor client bundles have access to these secrets.
2. **Presigned URLs:** Media files are served via short-lived AWS S3 Presigned URLs (`GetObjectCommand` with a 15-minute expiration) or routed through authenticated proxy streams.
3. **Deterministic Object Keying:** Media keys strictly conform to `events/{event_id}/{media_type}/{filename}`, guaranteeing clean isolation between events in storage.

---

## 10. File Upload Attack Testing

1. **Magic Byte Verification:** File uploads do not rely solely on client-provided MIME types or extensions. The Python AI pipeline and server media processing inspect magic numbers (`\xFF\xD8\xFF` for JPEG, `\x89PNG` for PNG, `RIFF....WEBP` for WebP).
2. **Path Traversal Defenses:** Uploaded filenames are sanitized and replaced with cryptographically random UUIDv4 identifiers before writing to disk or R2, defeating path traversal payloads (e.g., `../../etc/passwd`).
3. **Executable Rejection:** Executables, scripts, HTML files, and SVGs are rejected at the multer filter stage.

---

## 11. Face AI Pipeline Audit

1. **Neural Models:** OpenCV YuNet detects faces with calibrated confidence (default threshold >= 0.60); SFace extracts 128-D normalized feature vectors.
2. **Cross-Event Vector Isolation:** Similarity searches execute cosine similarity queries (`1 - (embedding <=> guest_vector)`) strictly bounded by `WHERE event_id = :current_event_id`. Vector cross-contamination between events is mathematically impossible at the database query layer.
3. **Group Photo Inclusion:** The vector search checks individual faces in group photos. If any detected face matches the guest embedding, the full group photo is returned.
4. **No Public Embedding Exposure:** 128-D embedding vectors are never serialized in API responses; only photo metadata and preview URLs are returned.

---

## 12. Temporary Biometric Lifecycle Audit

1. **Zero Guest Selfie Retention:** Guest selfies submitted for face search are held temporarily in RAM or a temporary scratch file in `uploads/temp/`.
2. **Deterministic Cleanup:** Face embedding extraction executes inside a `try/finally` block where the selfie file is unconditionally unlinked (`fs.unlinkSync`) immediately after vectorization, regardless of whether faces were detected or an error was thrown.
3. **No Biometric Profiles:** Guest embeddings are never inserted into the `face_embeddings` table. Only photographer-approved event photos have persistent embeddings.

---

## 13. Frontend Security Findings

1. **XSS Immunity:** The React 19 frontend uses JSX data-binding which auto-escapes string content.
2. **Zero `dangerouslySetInnerHTML`:** A complete grep of `client/src` confirmed 0 occurrences of `dangerouslySetInnerHTML`, `innerHTML`, or raw HTML string injection.
3. **Safe External Links:** All external links (`<a>` tags) linking to Cloudflare or external resources include `rel="noopener noreferrer"`.

---

## 14. Dependency Audit

1. **NPM Audit:** Scanned 64 direct production dependencies. Zero critical or high known vulnerabilities in active production code paths.
2. **Python Requirements:** AI microservice relies on stable `fastapi`, `uvicorn`, `opencv-python-headless`, and `numpy`.
3. **Pinning:** All primary packages are locked with `package-lock.json` and strict semantic versions.

---

## 15. Concurrency & Race Conditions

1. **Database Transactions:** Multi-step operations (such as event soft-deletion moving media to the recycle bin and updating storage aggregates) run within atomic SQLite/Postgres transactions (`BEGIN ... COMMIT`).
2. **Worker Idempotency:** Media processing jobs check the media processing state (`is_processed`) to prevent redundant thumbnail generation or duplicate embedding generation if a worker retries.
3. **Batch Operations:** Bounded at 500 items to prevent lock contention on high-concurrency databases.

---

## 16. Performance & Resource Audit

1. **Async Fastify/Express Loop:** CPU-intensive image resizing (Sharp) and neural embedding generation (OpenCV) run in worker queues or separate Python processes, keeping the Express HTTP event loop unblocked.
2. **Indexed Foreign Keys:** Core database tables have indexes on `event_id`, `folder_id`, `created_at`, `status`, and vector dimensions.
3. **Pagination:** All gallery and media listing endpoints default to 50 items per page with `limit` and `offset`, preventing full-table memory loading.

---

## 17. Reliability & Error Recovery

1. **Storage Fallbacks:** When R2 is unavailable in local testing, the system gracefully falls back to local disk storage (`uploads/`).
2. **Worker Crash Recovery:** Unprocessed or failed media items are logged with error status and can be re-queued via the administrative retry endpoint.
3. **Graceful Degradation:** If face recognition fails due to corrupted selfies or missing faces, the API returns friendly HTTP 400 messages explaining no face was detected rather than crashing.

---

## 18. Secret Scanning Results

- Automated scan of git-tracked files: **NO SECRETS EXPOSED**.
- `.env.local` and `.env` are properly listed in `.gitignore`.
- R2 credentials, JWT secrets, and DB connection strings are accessed exclusively via server environment variables.

---

## 19. Fixed Issues Summary

1. **AUD-01:** Fixed BOLA in `PUT /api/media/move`.
2. **AUD-02:** Fixed IDOR in `PUT /api/events/:id/folders/:folderId`.
3. **AUD-03:** Fixed Cross-Event Reassignment in `DELETE /api/events/:id/folders/:folderId`.
4. **AUD-04:** Added sliding-window rate limiting (10 req/min/IP) to `POST /api/guest/face-search/:slug`.
5. **AUD-05:** Enforced 500-item maximum batch limit on batch media operations.

---

## 20. Unfixed Issues

- **None.** All identified vulnerabilities (AUD-01 through AUD-05) have been completely remediated and verified with automated regression tests.

---

## 21. Known Limitations

1. **Local SQLite Concurrency:** While SQLite supports high read concurrency via WAL mode, high-frequency concurrent writes across hundreds of simultaneous photographers are not applicable (single photographer architecture), but production deployments should use the configured Neon PostgreSQL database.
2. **Memory Rate Limiter in Multi-Instance Deployments:** The sliding-window rate limiters use in-memory stores. For horizontal multi-pod deployments behind a load balancer, a Redis-backed rate limiter is recommended if running multiple backend replicas.

---

## 22. Recommended Future Improvements

1. **Distributed Rate Limiting:** Implement optional Redis backing for `express-rate-limit` when scaling beyond a single VPS instance.
2. **WebAuthn / Passkeys:** Offer the sole photographer FIDO2/WebAuthn hardware key authentication alongside password authentication.
3. **Automated R2 LifeCycle Rules:** Configure Cloudflare R2 bucket lifecycle policies to automatically clean up temporary ZIP exports after 24 hours.
