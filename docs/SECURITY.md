# SECURITY & PRIVACY SPECIFICATION (PHASE 1)

**Document Status:** Master Security Architecture & Threat Mitigation Blueprint  
**Classification:** High-Priority Architecture Requirements  
**Governing Rules:** Strictly governed by `AGENTS.md` and `docs/PRODUCT_REQUIREMENTS.md`  

---

## 1. System Threat Model & Mitigation Matrix

The platform processes high-value proprietary visual media and sensitive biometric facial data. The following threat model evaluates the top 10 attack vectors and specifies architectural mitigations:

| Threat Scenario | Attack Vector | Architectural Mitigation & Defense Mechanism |
| :--- | :--- | :--- |
| **1. Guest Tries Event B URL** | An attendee from Event A attempts to guess or browse Event B's slug (`/gallery/event-b`). | Event lookup validates visibility (`public`), status (`active`), and expiry (`public_until > NOW()`). If Event B has PIN protection, guest is immediately halted at the PIN entry screen without metadata or photo grid exposure. |
| **2. Guest Changes Event ID in API** | Guest alters URL parameters or JSON payloads from `eventIdA` to `eventIdB`. | All guest route handlers derive the event context strictly from the validated slug. Middleware verifies that `req.params.id === resolvedEvent.id`. If a guest submits an ephemeral token from Event A against Event B, `HTTP 403 Forbidden` is returned immediately. |
| **3. Guest Modifies API Request Payload** | Attacker tampers with request bodies (e.g., injecting SQL fragments, modifying folder IDs, altering pagination limits). | All incoming request bodies, query params, and route parameters are validated using strict Zod schemas with stripped unknown keys. All database queries use parameterized SQL prepared statements, rendering SQL injection impossible. |
| **4. Guest Brute-Forces PIN** | Script automated attempts against a 4–8 digit event PIN. | Rate limiter tracks attempts per IP and per event slug in Redis. Maximum 5 failed attempts allowed within a 15-minute sliding window. Exceeding the threshold triggers `HTTP 429 Too Many Requests` with a temporary IP lockout. PIN verification uses salted bcrypt with constant-time comparison. |
| **5. Guest Attempts Unrestricted Download** | Guest attempts direct download when `allow_downloads = false`, or scrapes original master files. | Backend checks `events.allow_downloads === true` prior to generating pre-signed S3 download URLs. Original files are never exposed via public URLs; only short-lived (15-minute) signed URLs with `response-content-disposition=attachment` are generated upon validated request. |
| **6. Malicious File Upload** | Attacker attempts to upload executable binaries, shell scripts, or polyglot files masquerading as images. | 1. Direct uploads require authenticated photographer session. 2. Pre-signed upload validation restricts MIME types. 3. Worker inspects binary magic bytes using Sharp/file-type, rejecting files that do not match pure JPEG, PNG, WebP, or MP4 containers. 4. Filenames are replaced with random UUIDs. |
| **7. R2 Credential Exposure** | Attacker inspects frontend bundles or network traffic to steal Cloudflare R2 credentials. | Cloudflare R2 Access Key ID and Secret Access Key reside strictly server-side in environment variables. Browsers receive only time-limited pre-signed S3 URLs scoped to a specific object key. Cloudflare credentials are never transmitted to any client. |
| **8. Cross-Event Face Search** | Guest selfie in Event A returns matches from Event B. | Vector similarity queries enforce `WHERE event_id = :current_event_id` directly in PostgreSQL `pgvector`. Cross-event similarity is mathematically excluded from the candidate search space. |
| **9. Expired Gallery Access** | Guest attempts to view or download media from an event whose 30-day public window has elapsed. | Dual-layer enforcement: 1. BullMQ cron sweeper transitions expired events to `visibility = 'private'` every 15 minutes. 2. Real-time request guard verifies `public_until >= NOW()` on every request, immediately returning `HTTP 410 Gone`. |
| **10. Unauthorized Gallery Deletion** | Malicious actor attempts to trigger event or photo deletion endpoints. | Destructive deletion routes (`DELETE /api/events/:id`) require an active, authenticated photographer session and double-confirmation (typing the exact event title). Guest tokens possess zero administrative privileges. |

---

## 2. Trust Boundaries & Network Zones

```
[ ZONE 0: Public Untrusted Internet ]
  Photographer Browsers • Mobile Guest Devices • Public QR Scanners
             │
             ▼ HTTPS / TLS 1.3
[ ZONE 1: Edge & CDN Layer (Cloudflare) ]
  • DDoS Mitigation & Cloudflare WAF
  • Edge Caching of Public WebP Thumbnails & Previews
  • Direct Egress-Free R2 Storage Delivery
             │
             ▼
[ ZONE 2: Application Demilitarized Zone (Node.js API) ]
  • Helmet Security Headers & CORS Policy
  • JWT Session Verification (Photographer)
  • Ephemeral Token Scoping (Guest)
  • Redis-Backed IP Rate Limiting
  • Zod Schema Input Sanitization
             │
             ▼ Localhost Only (127.0.0.1) / Private VPC
[ ZONE 3: Internal Core Infrastructure ]
  • PostgreSQL 16 + pgvector (Port 5432, Scoped User)
  • Redis Message Broker (Port 6379, Password Protected)
  • Python AI Microservice (127.0.0.1:8000, Local Socket)
```

---

## 3. Photographer Authentication & Session Security (Phase 4 Implementation)

- **Single-Owner Model:** Exactly one photographer user exists in the system (`id = 1`). Multi-tenant registration endpoints are absent. The database schema enforces `id SERIAL PRIMARY KEY` with a single owner record.
- **Initial Account Provisioning:** Owner account is created via the secure CLI command `npm run setup:owner` (`scripts/setup-owner.ts`), which prompts for email and hidden password from the command line, computes the bcrypt hash (cost 10), and inserts the record into PostgreSQL.
- **Password Hashing & Timing Protection:**
  - Salted one-way hashing using `bcryptjs` with a cost factor of 10.
  - Constant-time dummy comparison (`performDummyCompare`) runs against a pre-computed cost-10 hash if an email does not exist in the database, ensuring attackers cannot infer account existence via timing discrepancies.
  - Generic error message (`Invalid email or password` with code `AUTHENTICATION_REQUIRED`) returned for both nonexistent accounts and bad passwords to eliminate user enumeration.
- **Session Cookie Architecture:**
  - Cookie name: `studio_session`
  - Flags: `HttpOnly: true`, `Secure: true` (in production), `SameSite: Strict` (production) / `Lax` (local dev cross-port), `Path: /`, `Max-Age: 604,800,000` (7 days).
  - Storage: No tokens in `localStorage`, `sessionStorage`, or URL query parameters.
- **Session Tokens (JWT):**
  - Cryptographically signed with server-side `AUTH_SECRET` (minimum 32 characters in production).
  - Payload contains subject ID (`sub: photographer.id`) and `email`.
  - Claims enforce `issuer: 'studio-lumina-api'`, `audience: 'studio-lumina-client'`, and `expiresIn: '7d'`.
- **Session Invalidation & Rotation:**
  - `POST /api/auth/logout`: Clears the cookie with `Max-Age: 0` and `Expires: Thu, 01 Jan 1970`.
  - `PUT /api/auth/password`: Verifies current password, updates password hash, invalidates previous session, and issues a freshly signed token cookie.
- **Brute-Force & Rate Limiting Defense:**
  - Login rate limiter (`createAuthRateLimiter`) tracks failed attempts per client IP.
  - Threshold: Maximum 5 failed attempts per 15-minute sliding window.
  - Exceeding the threshold immediately yields `HTTP 429 Too Many Requests` (`RATE_LIMITED`) before any database or crypto calculations occur.
  - Storage: Distributed Redis backend with in-memory fallback. Counter is reset on successful login.
- **CSRF & Origin Header Protection:**
  - `validateOrigin` middleware inspects the `Origin` header on state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`).
  - Requests originating from unauthorized foreign domains are immediately blocked with `HTTP 403 Forbidden` (`FORBIDDEN`).
- **Authorization Guard:**
  - `requirePhotographer` middleware extracts token from `studio_session` cookie or `Authorization: Bearer <token>` header, verifies cryptographic signature and claims, fetches photographer entity, and binds safe owner context to `req.photographer`.

### 3.1 Event Management Ownership Isolation & IDOR Defense (Phase 6 Implementation)

- **Ownership Derivation:** Client requests cannot pass or spoof `owner_id`. The backend service derives owner identity strictly from `req.photographer.id` authenticated via JWT.
- **SQL Ownership Boundary:** Every event query, mutation, publish/unpublish, archive/restore, and delete action enforces `WHERE id = :id AND owner_id = :ownerId`. Unmatched events return `404 EVENT_NOT_FOUND` to prevent Insecure Direct Object Reference (IDOR) attacks.
- **PIN Security & Zero Plaintext Retention:**
  - Gallery PINs are 4-8 numeric digits (`/^\d{4,8}$/`).
  - Hashed immediately upon intake with salted `bcrypt` (cost 10) and stored in `pin_hash`.
  - Raw PINs and hashes are never returned in API responses (DTOs expose only `pin_enabled: boolean`).
  - Raw PINs are never logged. Disabling PIN sets `pin_hash = NULL` in the database.
- **30-Day Public Expiry Enforcement:**
  - The backend strictly enforces that `public_until - public_from <= 30 days` (2,592,000 seconds). Non-chronological or oversized windows are rejected with `400 BAD_REQUEST` (`PUBLIC_WINDOW_EXCEEDED`).
- **Safe Deletion Protocol:**
  - Deleting an event requires typing the exact matching event name (`{ confirmName: "..." }`), preventing accidental one-click data destruction.

### 3.2 Folder Security & Cross-Event Media Isolation (Phase 7 Implementation)

- **Hierarchical Event Ownership Verification:**
  - Folders do not stand alone. Every folder operation (`create`, `list`, `get`, `update`, `delete`) starts by verifying that `:eventId` exists and belongs to the authenticated photographer (`owner_id = :ownerId`).
  - Access attempts to events belonging to other owners trigger `404 EVENT_NOT_FOUND` to prevent IDOR leaks.
- **Cross-Event Leakage Prevention:**
  - When assigning or moving media (`PATCH /events/:eventId/media/:mediaId/folder` and `POST /events/:eventId/media/move-batch`), the service explicitly validates:
    1. The target folder's `event_id` matches the path `:eventId`.
    2. The target media item's `event_id` matches the path `:eventId`.
  - Supplying a folder ID belonging to Event B while operating in Event A is strictly rejected with `400 INVALID_TARGET_FOLDER`.
  - Batch updates strictly filter by `WHERE event_id = :eventId AND id IN (...)`, mathematically preventing media in other events from being reassigned or manipulated.
- **Safe Folder Deletion Integrity:**
  - Deleting a folder unlinks media (`SET folder_id = NULL`) inside a managed SQL transaction before deleting the folder entity.
  - Zero photo or video assets are destroyed when deleting a folder.
  - All media remains safely preserved within the event container.

### 3.3 Cloudflare R2 Storage Security & Credential Isolation (Phase 8 Implementation)

- **Strict Server-Only Credentials:**
  - Cloudflare R2 Access Key ID (`R2_ACCESS_KEY_ID`) and Secret Access Key (`R2_SECRET_ACCESS_KEY`) exist exclusively in server environment variables.
  - Raw credentials are never bundled into client-side code, never returned in API responses, and never logged in error traces.
- **Private Buckets by Default:**
  - R2 buckets remain private with zero public read or write access configured at the Cloudflare bucket level.
  - Access to media objects is mediated exclusively via short-lived signed URLs generated server-side or proxy endpoints.
- **Key Hierarchy & Traversal Defense:**
  - Storage keys are deterministic and server-controlled: `events/{eventId}/{category}/{filename}`.
  - Strict input sanitization (`sanitizeStorageFilename`, `isValidStorageKey`) rejects path traversal (`../`, `..\`), null bytes (`\0`), absolute paths, and reserved names (`.`, `..`).
  - Event ID is strictly validated against UUID syntax (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`), preventing key injection or cross-event directory hopping.
- **Presigned URL Expiration Bounding:**
  - Presigned URLs are ephemeral bearer capabilities generated only after the caller's authorization is verified by application middleware.
  - Upload presigned URLs (`generatePresignedPutUrl`): capped at 900 seconds (15 minutes).
  - Download presigned URLs (`generatePresignedGetUrl`): capped at 900 seconds (15 minutes).
  - Presigned URLs are never stored in database records as permanent references.
- **Zero Sensitive Data Logging:**
  - Structured storage logger utilities (`redactUrlForLogs`) strip all query parameters (including `X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Date`) prior to emitting storage logs.
  - R2 errors are normalized through `normalizeStorageError`, stripping internal connection strings, bucket ARNs, and AWS/Cloudflare SDK traces from public client responses.

### 3.4 Storage Management & Cloudflare Navigation Security (Phase 9 Implementation)

- **Mandatory Photographer Authentication:**
  - All storage usage analytics (`GET /api/storage/usage` and `GET /api/storage`) strictly require an active, validated photographer JWT session (`requirePhotographer`). Unauthenticated callers are rejected with `401 AUTHENTICATION_REQUIRED`.
- **Relational Ownership & IDOR Protection:**
  - Storage calculations strictly filter events by `WHERE e.owner_id = :photographerId`, mathematically excluding other accounts or foreign events from the usage aggregation.
- **Zero Credential Exposure:**
  - The storage payload returns only aggregate counts and byte numbers. Raw R2 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) and signed tokens are completely excluded from API responses and frontend client bundles.
- **Sanitized External Navigation:**
  - Cloudflare navigation URLs are constructed through `buildCloudflareUrls`, which validates `R2_ACCOUNT_ID` against a strict 32-character hex regex (`/^[0-9a-fA-F]{32}$/`) and URL-encodes bucket identifiers to prevent open redirect vulnerabilities and URL injection.
  - Safe fallback to `https://dash.cloudflare.com` occurs if the Account ID is missing or non-compliant.
- **External Link Hardening:**
  - All external dashboard and billing actions open in new tabs with explicit `rel="noopener noreferrer"` attributes to prevent reverse tabnabbing and window object leakage.

---

## 4. Guest Authorization & Ephemeral Token Model

- **Zero-Registration Access:** Guests never create accounts, log in, or store persistent profile cookies.
- **Ephemeral Session Token:** When a guest unlocks a PIN-protected gallery:
  - Backend issues an ephemeral signed JWT containing `{ eventId, scope: 'guest_gallery_access' }` with a 12-hour expiration.
  - Client sends this token via `X-Guest-Token` header.
  - Server verifies that `token.eventId === request.currentEventId`. Any mismatch triggers `HTTP 403 Forbidden`.

---

## 5. Biometric Data Privacy & Zero-Retention Protocol

The platform processes sensitive biometric facial geometry. We adhere to the **Biometric Zero-Retention Principle**:

```
Selfie Capture (Client)
         │
         ▼ Ephemeral Stream
API Server RAM Buffer
         │
         ▼ Local HTTP Socket
Python AI Microservice (RAM Only)
         │
         ├── OpenCV YuNet Detects Face & Landmarks
         ├── OpenCV SFace Computes 128-D L2-Normalized Vector
         │
         ▼
IMMEDIATELY UNLINK & DESTROY SELFIE BUFFER FROM RAM
         │
         ▼
Query PostgreSQL pgvector with 128-D Vector Coordinates
         │
         ▼
Return Matched Photo IDs (Zero Biometric Persistence)
```

### 5.1 Privacy Guarantees
1. **Zero Raw Selfie Retention:** Raw guest selfies are processed ephemerally in RAM (or temporary encrypted scratch memory) and **permanently destroyed/deleted within milliseconds**. No raw selfies are ever written to Cloudflare R2 or persistent databases.
2. **Anonymous Mathematical Vectors:** Facial embeddings stored for event photos are anonymous 128-dimensional dense vectors linked strictly to internal `photo_id` and `event_id`. They contain no names, demographic tags, or identity labels.
3. **Event Scoping:** Face search similarity searches are mathematically constrained to `WHERE event_id = :current_event_id`.
4. **Mandatory Legal Review:** Before commercial deployment, the photographer must undergo legal/privacy counsel review regarding jurisdictional biometric compliance (e.g., Illinois BIPA, Texas CBO, GDPR Article 9). The platform includes a clear privacy notice informing guests that selfies are destroyed immediately upon search completion.

---

## 6. Secret Management & Prohibited Logging

### 6.1 Server-Side Secret Management
All sensitive configuration variables reside strictly in server environment variables (`.env`), never exposed to frontend client builds:
- `AUTH_SECRET`: JWT signing secret.
- `R2_ACCESS_KEY_ID` & `R2_SECRET_ACCESS_KEY`: Cloudflare S3 credentials.
- `DATABASE_URL`: PostgreSQL connection string with password.
- `REDIS_URL`: Redis authentication connection string.

### 6.2 Prohibited Logging Items
Application logs (Winston/Pino) format output as structured JSON. To prevent credential or biometric leakage into log aggregators, the following data is **STRICTLY PROHIBITED** from appearing in logs:
- Administrative passwords or bcrypt password hashes.
- Cloudflare R2 access keys or secret keys.
- Raw event PIN numbers.
- Raw guest selfie image buffers or base64 data.
- 128-dimensional biometric face embedding vectors.
- Raw JWT session tokens.

---

## 7. Transport Layer Security & Hardening

- **HTTPS Strict Enforcement:** Production deployments strictly enforce HTTPS with TLS 1.3.
- **Security Headers (Helmet):**
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Content-Security-Policy`: Restricts script, connect, and media sources to self and Cloudflare R2 bucket origins.
- **CORS Policies:** Cross-Origin Resource Sharing is locked strictly to the studio's authorized production domains.

---

## 8. Dashboard Frontend & Route Protection Security (Phase 5 Implementation)

### 8.1 Server-Authoritative Session Guard
- Frontend states (`isLoggedIn` or localStorage flags) are **NEVER** trusted as authoritative.
- The dashboard layout (`dashboard/layout.tsx`) invokes `useAuthSession` to verify validity against `GET /api/auth/me`.
- If the session token is absent, invalid, or expired, the layout halts rendering of sensitive studio data, sets the session state to `unauthenticated`, and initiates an immediate client-side redirect to `/login`.
- Direct URL requests to `/dashboard/*` without an active session cookie are rejected at the API layer with `HTTP 401 Unauthorized` and `code: 'AUTHENTICATION_REQUIRED'`.

### 8.2 Zero Secret Leakage in Client Bundles
- Cloudflare R2 credentials, database connection strings, and JWT signing keys are completely excluded from the Next.js client environment.
- No `NEXT_PUBLIC_` secrets exist for sensitive infrastructure.
- Communication with backend services occurs exclusively through the Next.js API rewrite proxy (`/api/:path*`), ensuring backend IP addresses and ports remain encapsulated.

### 8.3 Safe Error & State Exposure
- Frontend error boundaries and UI components display sanitized human-readable explanations (e.g., "Network error", "Session expired").
- Internal database details, SQL queries, stack traces, and filesystem paths are suppressed from all user-facing error states.

---

## 9. Photo Upload Security & Storage Protection (Phase 10 Implementation)

### 9.1 Short-Lived Presigned PUT Capabilities
- Direct browser-to-R2 transfer utilizes temporary AWS S3 presigned PUT URLs generated server-side.
- **Strictly Bounded Expiry:** URLs expire in exactly 30 minutes (1,800 seconds).
- **Narrow Object Scope:** Each URL authorizes PUT access *only* to a single server-generated deterministic object key: `events/{eventId}/originals/{mediaId}.{ext}`.
- **Zero Credential Exposure:** Cloudflare R2 access keys and secret keys are never transmitted to client code or serialized in JSON responses.
- **Prohibited Storage of Signed URLs:** Ephemeral presigned URLs are never written to PostgreSQL tables or persistent metadata.

### 9.2 Path Traversal & Arbitrary Key Overwrite Defense
- Client-provided original filenames are stripped of all directory separators and path traversal sequences (`../`, `..\`) via `path.basename`.
- The storage object key uses a server-generated cryptographically random UUID (`mediaId = randomUUID()`) and validated extension.
- Client requests cannot dictate or override the destination storage key.
- Mismatched storage keys during confirmation are strictly rejected (`parseStorageKey` validation).

### 9.3 Format Validation & Payload Restriction
- **Allowed Formats:** Strictly restricted to photographic master raster images: `image/jpeg`, `image/png`, `image/webp`.
- **Prohibited Payloads:**
  - Vector SVG (`image/svg+xml`) is explicitly rejected (`415 UNSUPPORTED_MEDIA_TYPE`) to eliminate SVG-based XSS vectors.
  - Executable binaries, shell scripts, and unapproved file types are rejected.
  - HEIC/HEIF is rejected with informative guidance until supported in a later phase.
- **Size Bounds:** Max 100 MB per photo (`MAX_PHOTO_SIZE_BYTES`); max 500 photos per upload batch (`MAX_UPLOAD_BATCH_SIZE`).

### 9.4 Event Scoping, Folder Containment & Verification
- Upload presigning and confirmation enforce authenticated photographer session and ownership (`owner_id = req.auth.id`).
- Folder destination validation guarantees the folder belongs to the same target event (`folder.event_id === eventId`), preventing cross-event contamination.
- The confirmation endpoint verifies binary presence in Cloudflare R2 using `headObject` before committing metadata records to PostgreSQL, preventing phantom database records.

---

## 10. Image Processing Pipeline Security (Phase 11 Implementation)

### 10.1 Untrusted Input & File Signature Verification
- Uploaded original files are treated as untrusted binary input.
- In addition to declared MIME types, `validateImageMagicBytes` inspects leading binary header bytes (magic numbers) to enforce authentic JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), or WebP (`RIFF....WEBP`) file formats.
- Polyglots, disguised executable binaries, scripts, or corrupt files are rejected with `422 CORRUPT_IMAGE`.

### 10.2 Decompression Bomb & Resource Exhaustion Defense
- Extremely high-resolution or maliciously crafted images ("pixel bombs") designed to exhaust server RAM during decoding are neutralized before rasterization.
- Image metadata is parsed safely via Sharp without full decompression.
- If total pixel area exceeds 50,000,000 pixels (50 Megapixels), the worker terminates processing immediately and returns `422 DECOMPRESSION_BOMB_DETECTED`.

### 10.3 Bounded Concurrency & Worker Isolation
- Derivative processing executes in an asynchronous queue (`AsyncImageProcessingQueue`) with a strict worker concurrency limit (default 2 workers).
- Sharp's internal libvips thread pool and memory limits prevent worker crashes or starvation of the Express HTTP server.
- Processing occurs completely outside HTTP request loops; API endpoints return immediately upon enqueue.

### 10.4 Immutable Originals & Deterministic Derivative Keys
- Original R2 objects (`events/{eventId}/originals/{mediaId}.{ext}`) are the immutable source of truth and are **never** modified, overwritten, or deleted by the processing pipeline.
- Derivatives use server-enforced deterministic keys:
  - `events/{eventId}/thumbnails/{mediaId}.webp`
  - `events/{eventId}/previews/{mediaId}.webp`
- Retries and repeated executions overwrite only the specific derivative keys without generating orphaned R2 objects.

### 10.5 Metadata Stripping & Privacy
- Thumbnail and preview WebP derivatives automatically strip non-essential EXIF, IPTC, and XMP metadata (such as GPS coordinates or camera serial numbers) while normalizing orientation via `.rotate()`.
- Original metadata remains intact on the master original object in Cloudflare R2 for authorized photographer downloads.

---

## 11. Video Upload & Processing Pipeline Security (Phase 12 Implementation)

### 11.1 Shell Injection Elimination & Safe Process Execution
- Media inspection and transcoding invoke `ffmpeg` and `ffprobe` exclusively using `child_process.execFile` with explicit argument arrays.
- Shell interpolation (`child_process.exec` or shell wrapping) is strictly prohibited. Client-supplied filenames or metadata strings are never passed as raw command line arguments.
- FFprobe JSON output is parsed defensively inside `try...catch` blocks with full schema validation of streams, dimensions, and duration.

### 11.2 Resource Exhaustion & Denial of Service Defense
- **Maximum File Size:** 500 MB ceiling (`VIDEO_MAX_SIZE_BYTES = 524288000`).
- **Maximum Duration:** 1,800 seconds (30 minutes). Files exceeding this duration fail fast with `VideoDurationExceededError`.
- **Maximum Dimensions:** 3840 × 2160 (4K UHD). Files exceeding 4K fail fast with `VideoDimensionsExceededError`.
- **Execution Timeout:** Strict 120,000 ms (2 minutes) timeout enforced on all FFmpeg and FFprobe process executions.
- **Worker Concurrency Limit:** Dedicated `AsyncVideoProcessingQueue` enforced with `concurrency = 1`. Video transcoding workloads can never saturate CPU or memory and cannot starve photo processing (`concurrency = 2`) or future biometric vector search pipelines.

### 11.3 Ephemeral Scratch File Protection & Guaranteed Cleanup
- Video streaming and intermediate files use unique, isolated temporary directories generated via `fs.promises.mkdtemp(path.join(os.tmpdir(), 'studio_lumina_vid_{mediaId}_'))`.
- Temporary scratch directories and all contained files (`input.mp4`, `poster.webp`, `rendition.mp4`) are guaranteed to be purged in a `finally` block on both success and failure states, preventing disk exhaustion.

### 11.4 Immutable Originals & Separate Derivative Storage
- Original video assets stored at `events/{eventId}/originals/{mediaId}.{ext}` remain 100% immutable.
- Generated poster frames are stored separately at `events/{eventId}/thumbnails/{mediaId}.webp`.
- Web-optimized 1080p H.264/AAC playback renditions are stored separately at `events/{eventId}/previews/{mediaId}.mp4`.
- Partial failure or error states never modify or delete the original video asset in Cloudflare R2.

---

## 12. AI Face Search & Biometric Data Security (Phase 16 Implementation)

### 12.1 Biometric Zero-Retention Architecture
- **In-Memory Ephemeral Processing:** Guest selfies submitted to `/api/events/:eventId/face-search` are decoded in RAM and passed to the local AI inference engine.
- **Immediate Discard:** Once the 128-D embedding vector is generated, the selfie buffer is immediately dereferenced and garbage collected.
- **Zero Storage Persistence:** Guest selfies are **never** persisted to Cloudflare R2, filesystem disk, database blobs, or caching layers.
- **Zero Raw Vectors in Client Payloads:** Neither the query embedding vector nor the database embedding vectors are ever returned to the client or browser.

### 12.2 Strict Event-Scoped Similarity Queries
- **Database-Level Isolation:** Vector search queries enforce event scoping in SQL:
  ```sql
  WHERE fe.event_id = :eventId AND m.event_id = :eventId AND m.status = 'ready'
  ```
- **Cross-Event Proof:** Mathematical nearest-neighbor calculations are strictly partitioned by `event_id`. Even if an identical face embedding exists in Event B, a search authorized for Event A will never inspect or return Event B records.
- **IDOR Defense:** Ephemeral guest tokens are cryptographically verified using JWT signatures, confirming that the token's `eventId` matches the route parameter.

### 12.3 Rate Limiting & Resource Exhaustion Defense
- **Sliding-Window Limiter:** Maximum 10 face search requests per minute per client IP + event ID.
- **HTTP 429 & Retry-After:** Requests exceeding the rate limit receive HTTP 429 with standard `Retry-After: <seconds>` headers.
- **Memory Ceiling:** Upload payload size is bounded to 10 MB, and decoded pixel area is capped at 25 Megapixels, preventing memory exhaustion attacks.
- **Exactly-One-Face Rule:** Rejects multi-face query uploads (`422 MULTIPLE_FACES_DETECTED`) to eliminate computational ambiguity and prevent injection attacks using composite images.

### 12.4 Verified Commercial Licensing & Weight Provenance
- All neural networks deployed in the biometric pipeline are verified for commercial software operation.
- **Detector:** YuNet (`face_detection_yunet_2023mar.onnx`) is licensed under MIT / Apache-2.0.
- **Recognizer:** SFace (`face_recognition_sface_2021dec.onnx`) is licensed under Apache-2.0 / BSD 3-Clause.
- Pretrained weights with Non-Commercial clauses (e.g. Creative Commons CC-BY-NC or research-only clauses found in original InsightFace/ArcFace models) are strictly prohibited from all production, staging, and container builds.

### 12.5 Internal Service API Authentication & Scoping
- Background indexing endpoints (`POST /internal/index-photo`, `GET /internal/index-jobs/:jobId`, `POST /internal/index-jobs/:jobId/retry`) are strictly fortified against unauthorized tampering.
- Requests must supply either:
  1. An authenticated photographer session with confirmed ownership of the target photo and event.
  2. A pre-shared cryptographic internal service key via header `X-Internal-Service-Key: <INTERNAL_SERVICE_KEY>`.
- Calls failing both checks are rejected with `401 AUTHENTICATION_REQUIRED` or `403 FORBIDDEN`.

### 12.6 Permanent Deletion & Cascading Vector Erasure
- Stored face embeddings are permanently bound to the lifecycle of their parent entities.
- The `face_embeddings` table defines `photo_id UUID REFERENCES media(id) ON DELETE CASCADE` and `event_id UUID REFERENCES events(id) ON DELETE CASCADE`.
- Permanent deletion of a photo or event executes an atomic cascading delete, purging all 128-D embedding vectors from Supabase PostgreSQL without leaving orphaned biometric records.

---

## 13. Guest PIN Protection & Ephemeral Sessions Security (Phase 18 Implementation)

### 13.1 Fail-Closed Security Model
- **Configuration Integrity:** If an event has `pin_enabled = true` but `pin_hash IS NULL` (misconfigured state), the backend fails closed immediately with `HTTP 403 PIN_CONFIGURATION_ERROR`. Under no circumstances is access granted to an improperly configured protected event.
- **Strict Verification Order:** Access gates enforce `pin_enabled` before returning gallery media. Requests lacking a valid guest session token receive `HTTP 401 EVENT_PIN_REQUIRED` with `{ requiresPin: true }`.
- **String Integrity & Leading Zeros:** PIN codes are strictly validated as 4 to 8 numeric digits (`/^\d{4,8}$/`). They are processed, stored, and verified strictly as raw strings; numeric coercion (which strips leading zeros, e.g. turning `"0042"` into `42`) is prohibited across all layers.

### 13.2 Constant-Time Salted Bcrypt Hashing
- Event PINs are stored as salted bcrypt hashes with a minimum cost factor of 10.
- Raw PIN strings are never stored in the database, cached in memory, serialized in API responses, or printed in application logs.
- Timing attack mitigation: When verifying a PIN against an event, constant-time bcrypt verification is executed, and non-existent or invalid events fail without leaking event state.

### 13.3 Ephemeral Guest Session Token Lifecycle (JWT + Database Hash)
- **Zero Guest Accounts:** Guests never register, create accounts, supply emails, or receive persistent identities.
- **Short-Lived Signed JWTs:** Successful PIN verification grants a cryptographically signed JWT with a strict 12-hour expiration window (`expiresIn: '12h'`).
- **Cryptographic Token Hashing in DB:** The issued JWT is hashed using SHA-256 (`token_hash = sha256(token)`), and the hash is stored in `guest_sessions` along with an anonymized client IP hash (`ip_address_hash`). The raw JWT is never persisted server-side.
- **Dual Verification:** For PIN-protected events, `verifyEventAccess` middleware requires both valid cryptographic JWT signature verification and an active unexpired record in `guest_sessions`.
- **Strict Event Isolation:** The session token's `eventId` claim is compared against the target event's canonical UUID. A token verified for Event A is rejected with `HTTP 403 FORBIDDEN` if presented against Event B.

### 13.4 Sliding-Window Brute-Force Rate Limiting
- **Attempt Tracking:** Failed PIN attempts are tracked per IP and canonical event UUID using a sliding window in-memory limiter (`PinRateLimiter`).
- **Lockout Threshold:** Maximum 5 failed attempts per 15-minute sliding window.
- **Rate Limit Response:** Exceeding the threshold immediately yields `HTTP 429 PIN_RATE_LIMITED` with a calculated `Retry-After: <seconds>` HTTP header.
- **Counter Invalidation:** The failed attempt counter is immediately cleared upon successful PIN verification.

### 13.5 Instant Session Revocation on PIN Mutation
- **Atomic Session Invalidation:** When the photographer updates an event's PIN or toggles `pin_enabled = false`, `eventService.updateEvent` atomically calls `guestSessionService.revokeEventGuestSessions(eventId)`.
- **Immediate Ejection:** All previously issued guest sessions for that event are wiped from `guest_sessions`. Any guest holding a previously issued token is immediately required to re-authenticate with the new PIN on their next request.
- **Guest-Initiated Session Clear:** Guests can explicitly invalidate their temporary session via `POST /api/guest/session/clear/:eventId`, deleting the session row and clearing the client-side session cookie.

---

## 14. Public / Private Gallery System & Media Authorization Security (Phase 19 Implementation)

### 14.1 Server-Authoritative Fail-Closed Visibility Gate
- **Authoritative Server Enforcement:** Event visibility (`events.visibility`) is validated in the backend middleware layer (`verifyEventAccess`) and direct media stream handlers. The frontend UI never serves as an authorization boundary.
- **Fail-Closed Private Lockout:** An event marked `private` denies all guest requests with `HTTP 403 Forbidden` (`This gallery is currently private.`).
- **Complete Decoupling from PIN Security:** Knowing the correct PIN or passing a previously verified PIN payload does not bypass private visibility. In `verifyEventAccess`, the check `if (event.visibility !== 'public' || event.status !== 'active')` executes before any PIN or guest token evaluation.
- **Zero Information Leakage:** Responses for private galleries contain no media count, folder hierarchy, thumbnail previews, or camera metadata.

### 14.2 Instant Guest Ejection & In-Flight Revocation
- **Cascade Session Purge:** When the photographer updates visibility to `private` via `PATCH /api/events/:id/visibility`, `eventService.updateEventVisibility` immediately calls `guestSessionService.revokeEventGuestSessions(eventId)`.
- **Session DB Deletion:** All database session rows in `guest_sessions` matching `event_id` are purged.
- **In-Flight Rejection:** Even if an unauthorized or previously authorized client submits an in-flight request holding a validly signed JWT, the server evaluates database visibility on each request and terminates the session with `HTTP 403`.

### 14.3 Direct Media Streaming & Cache-Control Hardening
- **Media Endpoint Gating:** Requests to `/api/media/stream` parse the deterministic storage key to extract `eventId` (`events/{eventId}/...`).
- **Authorization Before Stream:** Non-photographer requests query the database to verify `event.status === 'active'` and `event.visibility === 'public'`. Requests for media belonging to private events are rejected with `HTTP 403 Forbidden`.
- **Cache Poisoning Defense:** Private media responses explicitly set `Cache-Control: no-store, no-cache, must-revalidate` to prevent CDN or browser caching of private assets. Public media streams use a conservative cache window (`max-age=300`) ensuring privacy transitions propagate within 5 minutes.

### 14.4 Photographer Uninterrupted Management
- **Single-Owner Access Preservation:** Authenticated photographer requests carry valid photographer credentials verified via `requirePhotographer`.
- **Unrestricted Dashboard Access:** The photographer can view, edit, configure, upload, and process private events with zero interruption. Private event previews in the management console use the authenticated photographer authorization path, never a guest bypass.

---

## 15. Automatic Gallery Expiry & Fail-Closed Privacy Enforcement (Phase 20 Implementation)

### 15.1 Dual-Layer Fail-Closed Expiry Defense
- **Authoritative Clock Synchronization:** Expiry evaluation is strictly based on the server UTC clock (`NOW()`). Guest client device clocks or HTTP request header times are completely disregarded.
- **Reactive Request-Time Guard:** Every guest-facing route (`verifyEventAccess` middleware, `getGuestEventBySlug`, `verifyGuestPin`, media stream delivery, and AI face search) executes `isEventExpired(public_until)` synchronously before dispatching data.
- **Zero Gap Window:** At or after the exact expiry boundary (`now >= public_until`), requests are instantly rejected with `HTTP 410 Gone` (`GALLERY_EXPIRED`), eliminating any vulnerable time window between the scheduled expiry timestamp and asynchronous worker sweeper execution.
- **Fail-Closed on Queue or Worker Outage:** If Redis is down, BullMQ workers crash, or the background scheduler experiences delayed execution, guest access remains strictly locked out because the request-time guard enforces the expiry boundary independently of background worker status.

### 15.2 Guest Session Invalidation & Stale Token Neutralization
- **Physical Session Revocation:** When an event transitions to private upon expiry (via BullMQ worker or periodic reconciler), `revokeEventGuestSessions(eventId)` physically purges all corresponding rows from PostgreSQL `guest_sessions`.
- **Dual JWT + Database Verification:** Even if a malicious guest attempts to replay a previously valid 12-hour signed JWT, both the request-time `isEventExpired` guard and the database session lookup fail closed, preventing unauthorized access.
- **PIN Re-Verification Rejection:** Submitting the correct PIN to an expired gallery (`POST /api/guest/verify-pin/:slug`) is rejected with `HTTP 410 GALLERY_EXPIRED`, preventing guests from generating fresh session tokens for expired galleries.

### 15.3 Face Search Race-Condition Defense
- **Pre-Search Gate:** Face search submission checks `isEventExpired(event.public_until)` before allocating memory or invoking the neural network.
- **Post-Search Re-Check:** Before returning vector similarity matches, `faceSearchService` re-evaluates `isEventExpired(event.public_until)`. If the gallery expired while the neural network or vector index was computing, the response is discarded and an `HTTP 410 GALLERY_EXPIRED` is returned, preventing biometric result leakage at the expiry boundary.

### 15.4 Safe Guarded State Transitions & Anti-Tampering
- **Guarded SQL Transitions:** Background workers execute guarded atomic SQL updates (`UPDATE events SET visibility = 'private', expired_at = NOW() WHERE id = $1 AND visibility = 'public' AND public_until <= NOW()`).
- **Protection Against Race Conditions:** A concurrent republishing request that sets a new `public_until` timestamp safely invalidates any stale in-flight expiry worker jobs. Stale jobs cannot overwrite new public publication windows.
- **Zero Data Deletion Invariant:** Expiry operations perform zero `DELETE` operations on media, folders, face embeddings, or Cloudflare R2 storage objects. Operational security is maintained without risking accidental photographer data destruction.

---

## 16. Photo & Video Download Authorization & Security Policy (Phase 21 Implementation)

### 16.1 10-Point Server-Side Authorization Gate
The backend enforces complete authorization on every download request; client UI button hiding is never treated as a security boundary:
1. **Event Resolution:** Target event must exist in the database.
2. **Operational Status:** `event.status` must be `'active'` (drafts and archived galleries reject downloads).
3. **Gallery Visibility:** `event.visibility` must be `'public'` (or request must hold verified photographer session).
4. **Gallery Expiry:** Current UTC time must be strictly before `public_until` (`now < public_until`). Expired events reject downloads with `HTTP 410 GALLERY_EXPIRED`.
5. **PIN Protection:** If `event.pin_enabled` is true, caller must present a valid, unexpired guest session token or photographer session.
6. **Session Scope:** Guest session token `eventId` claim must match the target event UUID exactly.
7. **Download Permission:** `event.allow_downloads` must be `true`. If `false`, requests fail immediately with `HTTP 403 DOWNLOADS_DISABLED`.
8. **Media Ownership:** Every requested media record must satisfy `media.event_id === event.id`. Foreign IDs are rejected with `HTTP 404 MEDIA_NOT_FOUND`.
9. **Media Processing Status:** `media.status` must be `'ready'`. Unprocessed or failed media cannot be downloaded.
10. **Storage Representation:** The requested representation (`original` or `preview`) must exist in Cloudflare R2.

### 16.2 Short-Lived Presigned URLs & Bearer Capability Limitations
- **15-Minute Expiry (900 seconds):** All presigned Cloudflare R2 `GetObject` URLs are generated strictly server-side with a 900-second time-to-live.
- **Honest Security Assessment:** A presigned URL is an S3 bearer capability. Anyone possessing the URL during its 15-minute active window can retrieve the specified object from Cloudflare R2. Once issued, a presigned URL cannot be instantly revoked without rotating storage credentials. The platform mitigates this by enforcing an aggressive 15-minute ceiling and rechecking full access policy before generating any new URL.
- **Credential Protection:** Cloudflare R2 Access Keys, Secret Keys, and endpoint configuration remain strictly server-side in environment variables and are never transmitted to clients.

### 16.3 Cross-Event Isolation & IDOR Protection
- **Zero Batch Trust:** Bulk download requests (`POST /api/guest/gallery/:slug/download-zip`) accept an array of media IDs. The backend validates **every single ID** via `SELECT id, event_id FROM media WHERE id IN (...) AND event_id = $eventId`.
- **Foreign Media Rejection:** If any requested ID belongs to another event or does not exist, the request fails or omits the unauthorized item. Cross-event photo harvesting is impossible.

### 16.4 Filename Sanitization & Header Injection Defense
- **Defensive Filename Normalization:** `sanitizeDownloadFilename` strips all directory navigation sequences (`../`, `..\`), control characters (`\x00-\x1f`), quotes, and CRLF line breaks (`\r\n`).
- **Response Header Injection Prevention:** By stripping newlines and control characters, the `response-content-disposition` parameter cannot inject malicious HTTP response headers or split response streams.

### 16.5 Archive Entry Path Traversal Defense
- **ZIP Packaging Safety:** When adding files to bulk archives via `archiver`, filenames are strictly sanitized and flattened. Archive entries cannot contain relative path segments (`../../`) and cannot escape the archive root upon extraction.
- **Collision Deduplication:** Duplicate original filenames in a bulk selection are automatically deduplicated by appending an incremental index (`photo_1.jpg`, `photo_2.jpg`), preventing archive corruption or silent overwrites.

### 16.6 Temporary Archive Isolation & Zero Media Deletion Guarantee
- **Isolated Key Namespace:** Temporary ZIP exports are saved exclusively under the deterministic prefix `events/{eventId}/exports/{jobId}.zip`.
- **Zero Media Deletion Guarantee:** The hourly cleanup sweeper (`cleanupExpiredDownloadJobs`) executes S3 `DeleteObjectCommand` ONLY for keys recorded in `download_jobs.storage_key` matching `events/{eventId}/exports/`. Under no circumstance does the cleanup routine delete original master files, videos, WebP previews, thumbnails, or biometric embeddings.

---

## 17. Watermark System Security & Biometric Protection (Phase 22 Implementation)

### 17.1 SVG & XML Injection Defense
- **Rigorous Sanitization (`escapeXmlText`):** Watermark text is strictly sanitized before vector SVG assembly. Special characters (`&`, `<`, `>`, `"`, `'`) are converted to their corresponding XML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`), and any HTML/XML tags are stripped.
- **XXE & Script Injection Defense:** Prevents arbitrary vector scripting, external entity expansion (XXE), or malicious payloads from being parsed by the Sharp/libvips rendering pipeline.
- **Server-Side Validation:** Max length is enforced to 100 characters, and opacity is clamped between `0.05` and `1.00`.

### 17.2 Clean Original & Download Preservation
- **Inviolable Original Master Storage:** Cloudflare R2 original objects (`events/{eventId}/originals/*`) are strictly read-only inputs for the derivative pipeline. They are never overwritten, edited in-place, or watermarked.
- **Download Integrity:** Authorized high-resolution downloads (governed by Phase 21 authorization rules) continue serving pristine, unwatermarked originals directly from storage.
- **No Preview Bypass:** Guest gallery endpoints only return watermarked preview and thumbnail derivative keys when watermarking is enabled, ensuring unwatermarked originals are never leaked through derivative URLs.

### 17.3 AI Biometric Pipeline Isolation
- **Pristine Facial Feature Extraction:** Neural face detection (YuNet) and 128-D face embedding extraction (SFace) operate exclusively on clean original photos.
- **Zero Biometric Degradation:** Watermarks are never composited onto images used for facial alignment, embedding extraction, or similarity queries. Similarity search accuracy and cosine distance metrics remain 100% unaffected.

### 17.4 Monotonic Versioning & Atomic Concurrency Guards
- **Stale Job Pre-Check:** Each worker job verifies its target watermark version against `events.watermark_version`. If a newer configuration epoch exists, stale jobs abort immediately.
- **Guarded Atomic Update:** The database update query applies an atomic conditional guard:
  ```sql
  WHERE id = $9 AND (watermark_version <= $8 OR watermark_version IS NULL)
  ```
  Out-of-order writes from delayed background jobs cannot overwrite newer derivatives or roll back metadata.

### 17.5 Honest Security Limitation
- **Visual Deterrent Only:** A visual watermark is an effective deterrent against casual screenshot redistribution and brand misappropriation. It does not constitute cryptographic digital rights management (DRM) and cannot guarantee prevention of screen capture or advanced computational watermark removal tools.

---

## 18. QR Code & Gallery Sharing Security Controls (Phase 23)

### 18.1 HTTP Host Header Injection & Poisoning Defense
- **Strictly Configured Canonical Origin:** Canonical guest URLs are derived exclusively from the application's validated `APP_URL` configuration (`getConfig().appUrl`).
- **Header Rejection:** The backend never derives production public URLs from client-controlled headers such as `Host`, `X-Forwarded-Host`, or `Forwarded`. This completely eliminates HTTP Host Header Poisoning, password-reset-style link hijacking, and reverse proxy cache poisoning.
- **Normalization:** Enforces uniform URL construction with trimmed trailing slashes on origin and sanitized event slugs.

### 18.2 Zero Secret Leakage in Links & QR Payloads
- **Public URL Only:** The QR code encodes only the public, guest-facing URL (`/gallery/:slug`).
- **No Embedded Credentials:** The QR code payload, query string, URL fragments, and download filenames never contain:
  - Photographer credentials or JWT session tokens
  - Event PIN codes (raw or hashed)
  - Temporary guest session tokens (`X-Guest-Token`)
  - Cloudflare R2 object keys or pre-signed S3 download URLs
  - Internal database UUIDs where a public slug exists
- **PIN Isolation:** The sharing interface displays an informative badge explaining that a PIN is required, without revealing the secret PIN to onlookers or screens.

### 18.3 In-Process Local QR Generation & XSS Immunity
- **Zero Third-Party Data Egress:** QR codes are generated entirely in-process using the local `qrcode` engine. Event titles, client names, and canonical links are never transmitted to external QR generation APIs.
- **SVG Vector Sanitization:** Generated SVG strings are verified to be strict XML starting with `<svg` and containing zero executable `<script>` tags, preventing SVG-based Stored Cross-Site Scripting (XSS).
- **High-Resolution PNG Safety:** Generated PNG data URLs are constructed directly from in-memory raster buffers without temporary disk storage or shell command execution.

### 18.4 Authorization, IDOR Defense & Access Preservation
- **Photographer Authentication Required:** `GET /api/events/:id/qr` requires an active photographer session (`requirePhotographer`).
- **Event Ownership Enforcement:** The query strictly verifies event ownership (`WHERE id = :id AND owner_id = :ownerId`). Attempts by Photographer 1 to generate QR codes for Photographer 2's events return `404 EVENT_NOT_FOUND`.
- **Zero Bypass of Access Controls:** Possessing or scanning a QR code is merely a navigation convenience; it confers zero authorization:
  - Private events remain private (`403 Forbidden`).
  - Expired events remain blocked (`410 Gone`).
  - PIN-protected events still require passing server-side PIN verification with brute-force rate limiting.

### 18.5 Filename Path Traversal Prevention
- **Filename Sanitization:** The download handler sanitizes event names via `sanitizeQrFilename`, replacing all characters outside `[a-zA-Z0-9_-]` with underscores and falling back to `Event_QR.*` for empty/symbol-only inputs.
- **Traversal Defense:** Path separators (`/`, `\`), null bytes (`\0`), and directory traversal tokens (`..`) are stripped, preventing arbitrary file write or Content-Disposition header manipulation.

---

## 19. Secure Event Deletion & Complete Biometric Erasure Controls

### 19.1 Biometric Data Purge & pgvector Erasure
- **Complete Vector Destruction:** When an event is permanently deleted, all 128-D neural face embedding vectors in `face_embeddings` associated with the event are permanently deleted via database transactions.
- **Zero Raw Selfie Persistence:** Guest selfies submitted during "Find My Photos" searches are processed in RAM/ephemeral scratch files and destroyed immediately after vector extraction. Raw guest selfies are NEVER persisted to disk or object storage.
- **Worker Vector Commit Abort:** Any background face indexing or detection worker process that is currently in-flight checks event status before inserting vectors; if the event is marked `status = 'deleting'`, the worker aborts immediately and rolls back, ensuring no zombie vectors are written.

### 19.2 Cloudflare R2 Object Purge & Zero Credential Exposure
- **Deterministic Prefix Purge:** All object storage assets under `events/{eventId}/` (originals, previews, thumbnails, video files, poster frames, and zip archives) are inventoried via `ListObjectsV2` and deleted in batches of up to 1,000 keys using `DeleteObjectsCommand`.
- **Server-Side Credentials:** R2 access keys and secret keys remain strictly server-side. No client-side S3 credentials or deletion tokens are ever exposed to browsers.
- **Zero Remaining Objects Verification:** A follow-up `ListObjectsV2` query verifies that 0 objects remain under the prefix before the deletion job transitions to `verified`.

### 19.3 Immediate Access Restriction & Session Invalidation
- **Atomic Soft-Lock:** Confirmation immediately marks `events.status = 'deleting'`, which causes all API routes, upload presigning endpoints, and indexing services to reject new requests with `409 Conflict` (`EVENT_INACCESSIBLE`).
- **Guest Session Revocation:** All active guest sessions (`guest_sessions`) associated with the event are immediately purged.

### 19.4 Honest Privacy, Retention & Backup Declaration
- **Live Storage Erasure:** Data in active PostgreSQL tables, `pgvector` indexes, Redis queues, and Cloudflare R2 buckets is permanently erased upon job completion.
- **Database Backup Retention:** In accordance with standard enterprise data retention and disaster recovery policies, point-in-time database backups and write-ahead logs (WAL) may retain historical snapshots for the duration of the backup retention window (typically 7–30 days depending on infrastructure configuration). Snapshots naturally expire and are overwritten as the retention window slides forward.
---

## 20. Phase 26: Security Hardening & Access Control Controls

### 20.1 Inter-Service Authentication (`X-Internal-Service-Key`)
- **Shared Secret Verification:** All internal service communications between the Node.js API server and the Python FastAPI face processing service require an `X-Internal-Service-Key` header.
- **Fail-Safe Fallback:** Defaults securely to `config.internalServiceKey` with automatic fallback to `config.authSecret` when not explicitly separated.
- **Service Isolation:** Public guests and clients cannot invoke internal indexing or extraction endpoints without presenting either an authenticated photographer session or a valid internal service key.

### 20.2 Constant-Time PIN Verification & Slug Timing Mitigation
- **Constant-Time bcrypt Comparison:** PIN checks against non-existent, private, or expired events execute a dummy comparison (`performDummyCompare`) against a standard cost-10 hash, completely eliminating timing differentials that could reveal valid event slugs or PIN configuration status.
- **Fail-Closed PIN Policy:** Galleries marked with `pin_enabled = true` that lack a valid hash immediately fail closed with `PinConfigurationError` (403), preventing unauthenticated gallery bypass.

### 20.3 Multi-Tier Rate Limiting Architecture & Edge IP Resolution
- **Edge IP Resolution:** `getClientIp` inspects Cloudflare's `CF-Connecting-IP` header first, followed by sanitized `X-Forwarded-For` IPs and `req.ip` behind trusted proxies (`app.set('trust proxy', 1)`).
- **Operation-Specific Quotas:**
  - Password Updates: 5 requests per 15 minutes (`passwordRateLimiter`).
  - Media Upload Presigning: 60 requests per minute (`uploadPresignRateLimiter`).
  - Bulk ZIP Archives: 25 requests per hour (`bulkDownloadRateLimiter`).
  - Public Gallery Navigation: 120 requests per minute (`publicGalleryRateLimiter`).
  - Watermark Reprocessing: 10 requests per hour (`reprocessRateLimiter`).
  - PIN Verification: 5 attempts per 15 minutes (`pinRateLimiterMiddleware`).
  - AI Face Searches: 10 requests per minute (`searchRateLimiter`).
- **Standardized Retry-After Propagation:** All rate limit rejections issue `HTTP 429 Too Many Requests` with a computed `Retry-After` header.

### 20.4 Dangerous Double Extension & Binary Upload Defense
- **Executable Script Extension Detection:** File validation scans for prohibited intermediate script extensions (e.g., `backdoor.php.jpg`, `exploit.exe.png`, `script.sh.webp`, `app.jsp.jpg`) using a comprehensive blocklist (`php`, `exe`, `dll`, `sh`, `bat`, `cmd`, `ps1`, `cgi`, `py`, `js`, `jsp`, `asp`, etc.).
- **Filename Sanitization:** Strips path separators (`/`, `\`), null bytes (`\0`), and ASCII control characters (`\x00-\x1f\x7f`).
- **Size & Dimension Limits:** Enforces strict 100 MB limits for photos, 500 MB for videos, and 50 Megapixel decompression bomb thresholds via Sharp.

### 20.5 Biometric Privacy, In-Memory Zero-Retention & Log Sanitization
- **Strict In-Memory Processing:** Guest selfies submitted during "Find My Photos" are processed ephemerally in RAM. Buffer references are promptly dereferenced post-inference and zero raw selfie bytes or query vectors are stored in database records or Cloudflare R2 buckets.
- **Log Data Redaction:** `censorSensitiveData` systematically redacts passwords, tokens, PINs, credentials, JWTs, vector embeddings (`[REDACTED_VECTOR_128D]`), and data URIs / base64 image strings (`[REDACTED_IMAGE_DATA]`).

### 20.6 PostgreSQL Row Level Security (RLS) Isolation
- **Table Coverage:** RLS enabled on all application tables (`photographer`, `events`, `folders`, `media`, `face_embeddings`, `face_detections`, `guest_sessions`, `processing_jobs`, `download_jobs`, `event_deletion_jobs`).
- **Public Query Boundary:** Public/anonymous roles can only select media and events where `status = 'active'`, `visibility = 'public'`, and `public_until >= NOW()`.
- **Biometric Isolation:** Public/anonymous roles are denied direct access to `face_embeddings` and `face_detections` tables.

### 20.7 Production Error Sanitization & Security Headers
- **500 Error Masking:** In `production` mode, non-operational 500 errors are sanitized to generic `An unexpected internal server error occurred` messages, suppressing internal stack traces and SQL query details.
- **Next.js & API Headers:** Configured with `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(self), microphone=(), geolocation=()`.









