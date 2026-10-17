# MASTER PRODUCT REQUIREMENTS: PHOTOGRAPHER GALLERY & AI FACE SEARCH PLATFORM

**Document Status:** Master Product Requirements (Single Source of Truth)  
**Target User:** One Professional Fine-Art & Commercial Photographer (Sole Owner)  
**Application Type:** Standalone Private Production Web Application  

---

## 1. Product Identity & Purpose
The platform is a bespoke, premium photography gallery management and AI-powered biometric face search platform engineered exclusively for **ONE** professional photographer. The photographer is the sole owner, administrator, and authenticated user of the entire system.

The product solves two core workflows:
1. **Photographer Workflow:** Creating high-end client events, organizing media into ceremony/category folders, uploading high-resolution batches directly to Cloudflare R2, configuring privacy and automated 30-day public visibility lifecycles, monitoring asynchronous background derivative and facial indexing pipelines, and tracking actual Cloudflare storage metrics.
2. **Guest Workflow (Zero-Friction, Zero-Account):** Scanning an event QR code or opening a unique share link on mobile/desktop, unlocking via an optional client PIN, browsing responsive photo-focused galleries, and using **"Find My Photos"** AI face search to immediately locate all single and group photos containing their face via a real-time selfie comparison with zero biometric retention.

---

## 2. User Model & Actors

### 2.1 The Photographer (Owner)
- Exactly **ONE** authenticated user exists in the system.
- Operates the sole dashboard in the platform.
- Capabilities:
  - Secure login/logout and session management.
  - Studio profile configuration (business name, tagline, bio, social links, password).
  - Event lifecycle management (create, configure, edit, archive, restore, permanently delete).
  - Folder hierarchy management within events (create, rename, safe deletion).
  - Batch media upload with progress tracking and failure handling.
  - Granular event settings: PIN protection, public/private state, public expiry window (maximum 30 days), download toggle, watermark toggle, AI face search toggle.
  - Real-time monitoring of asynchronous processing jobs (thumbnails, previews, facial indexing).
  - Deterministic Cloudflare R2 storage inspection and direct navigation to Cloudflare billing/management.
  - Generating and downloading print-quality event QR codes and copying share links.

### 2.2 The Guest (Client & Attendees)
- **Zero Account Model:** Guests DO NOT have accounts, DO NOT register, DO NOT log in, and HAVE NO dashboards.
- Access is strictly scoped to an individual event via its unique shareable URL or QR code.
- Capabilities:
  - Enter event PIN if protection is enabled.
  - Browse event ceremony folders and high-resolution media grids.
  - View full-resolution photo previews with camera metadata (EXIF) in an uncluttered lightbox.
  - Execute **Find My Photos** face search using live camera capture or image upload.
  - View matching single and group photos sorted by biometric confidence score.
  - Download individual photos or bulk event ZIP archives when permitted by photographer settings.

---

## 3. Explicit Non-Goals
The architecture must remain clean, modular, and unencumbered by SaaS multi-tenancy. The following features are strictly **NON-GOALS**:
- Multiple photographer accounts or organization switching.
- Team, studio assistant, or staff sub-accounts.
- Role-Based Access Control (RBAC) or super-admin management consoles.
- Guest registration, user logins, profiles, or persistent guest dashboards.
- Multi-tenant SaaS pricing tiers, subscriptions, or Stripe billing integrations.
- Application-level artificial storage quotas (e.g., selling 50GB / 100GB packages).
- Live camera tethering, direct FTP camera ingestion, or live camera-to-cloud feeds.
- Client proofing CRM, messaging systems, invoicing, or payment processing.

---

## 4. Core System Hierarchy
The product enforces a rigid 4-tier structural hierarchy:

```
PHOTOGRAPHER (Sole Owner)
    └── EVENT / GALLERY (Independent container with unique slug & settings)
            └── FOLDERS (Logical organization: e.g., Haldi, Mehndi, Wedding, Reception)
                    └── MEDIA (Photos & Videos with original, preview, thumbnail derivatives)

AI FACE EMBEDDINGS (128-D vector records strictly linked to EVENT_ID + MEDIA_ID)
```

---

## 5. Event & Gallery Specifications
Every event represents an independent client gallery with full isolation from all other events:
- **Unique Identifiers:** UUID primary key + URL-safe public slug token (e.g., `rahul-priya-wedding-4a9f`).
- **Metadata:** Event name, client name, client contact email, event date, location, description, cover photo ID.
- **Status:** `active` or `archived`.
- **Visibility Architecture (Phase 19):**
  - Explicit states: `public` vs `private`. Default state is `private` for newly created events.
  - Complete orthogonality: Visibility is strictly decoupled from operational status (`active`, `archived`), PIN protection (`pin_enabled`, `pin_hash`), and media processing states.
  - Fail-Closed Access: When visibility is `private`, all guest-facing endpoints (`/api/guest/gallery/:slug`, `/api/guest/gallery/:slug/media`, `/api/guest/gallery/:slug/search`, `/api/media/stream`) deny guest access immediately with `HTTP 403 Forbidden` (`GALLERY_PRIVATE`).
  - Independent PIN Protection: Knowing or submitting a valid PIN never grants access to a private gallery. When an event transitions to `private`, all active guest sessions in `guest_sessions` are revoked immediately.
  - Photographer Management Continuity: Authenticated photographer retains 100% full access to view, edit, upload, process, and manage private galleries via the owner dashboard.
  - Asset & Setting Preservation: Changing visibility between `public` and `private` preserves all photos, videos, folders, face embeddings, watermarks, download settings, and PIN hashes without modification or deletion.
- **Public Window:** `public_start` timestamp and `public_until` timestamp (enforced maximum of 30 days).
- **Security Configuration:** PIN protection toggle (`pin_enabled`) and salted password hash (`pin_hash`). Raw PIN is never stored.
- **Permissions:** `allow_downloads` (boolean), `watermark_enabled` (boolean), `watermark_text` (string), `face_search_enabled` (boolean).
- **Timestamps:** `created_at` and `updated_at`.

---

## 6. Folder System
- Each event contains multiple flat folders for ceremony and category breakdown (e.g., *Haldi*, *Mehndi*, *Wedding*, *Reception*, *Couple Shoot*).
- **Safe Folder Deletion:** Deleting a folder MUST NOT accidentally delete media. Photos inside a deleted folder are safely reassigned to the default event pool (*Uncategorized* / *All Media*) or explicitly moved to an alternate folder.
- Photographer can create, rename, reorder, and delete folders, and move photos between folders in bulk.
- Guests can filter the photo grid by folder tabs or view the entire collection seamlessly.

---

## 7. Media Storage & Cloudflare R2 Integration
- **Primary Storage:** Cloudflare R2 Object Storage (S3-compatible, zero-egress fees).
- **Ownership Model:** The photographer owns the Cloudflare account and bucket directly and pays Cloudflare without markup.
- **Deterministic Key Architecture:**
  ```
  events/{event_id}/originals/{filename}
  events/{event_id}/previews/{filename}
  events/{event_id}/thumbnails/{filename}
  events/{event_id}/videos/{filename}
  ```
- **Zero Secret Leakage:** R2 credentials remain exclusively server-side. Pre-signed URLs or secure server proxy endpoints are used for browser delivery.
- **Storage Metrics:** Display accurate, measured byte consumption across Photo Originals, Video Assets, Derivatives (Thumbnails/Previews), and Per-Event breakdowns. Direct links provided to the Cloudflare dashboard and billing page.

---

## 8. Batch Upload & Media Processing Engine
- **Upload Scale:** Robust batch uploads handling 1 to 5,000+ files per batch.
- **Features:** Drag-and-drop zone, multi-file validation (JPEG, PNG, WebP, TIFF, MP4, MOV), file size checks, upload progress tracking (percentage and loaded bytes), cancellation, and duplicate handling.
- **Asynchronous Derivatives Generation:**
  - **Original:** Untouched high-resolution master preserved safely in storage.
  - **Thumbnail:** Max 400px width/height, WebP format, quality 80 (used for ultra-fast masonry grids).
  - **Preview:** Max 1600px width/height, WebP/JPEG format, quality 85 (used for viewing and lightboxes).
  - **Watermarking:** Elegant, semi-transparent typographical studio watermark overlaid on previews if enabled for the event, while originals remain clean.
  - **EXIF Extraction:** Camera make/model, focal length, aperture, shutter speed, ISO, dimensions, date taken.
- **Video Processing:** Validation, thumbnail/poster generation, playback streaming, and download packaging without blocking photo pipelines.

---

## 9. Background Job & Worker Infrastructure
- All heavy operations run through background worker queues:
  - Image resizing and derivative generation.
  - Neural face detection and landmark bounding.
  - Biometric face embedding generation.
  - Bulk ZIP archive compilation.
  - Automated gallery expiry sweep.
  - Storage cleanup on permanent deletion.
- Jobs support concurrency limits, real-time progress updates (processed/total items), status categories (`pending`, `processing`, `completed`, `failed`), and error recovery.

---

## 10. AI Face Detection, Biometric Embeddings & Search

### 10.1 Detection & Indexing
- During photo processing, each photo is evaluated for human faces.
- Multi-face support: Every detected face in a group photo is bounded, aligned, and extracted.
- Each face produces a 128-dimensional L2-normalized biometric vector embedding.
- Embeddings are stored with: `id`, `event_id`, `photo_id`, `face_index`, `box_x`, `box_y`, `box_w`, `box_h`, `confidence`.

### 10.2 Guest Search ("Find My Photos")
- Guest captures a selfie using the camera or uploads a portrait from their device.
- Face detector locates the primary face in the selfie and computes a 128-D vector embedding.
- **Strict Event Isolation:** Vector similarity search is constrained strictly by `WHERE event_id = :current_event_id`. Guests from Event A can NEVER query or match photos from Event B.
- **Group Photo Matching:** If a guest matches ANY face in a group photo, the entire group photo is matched and returned.
- **Biometric Zero-Retention Privacy:** Guest selfies are processed ephemerally in RAM or temporary scratch files and **immediately deleted/destroyed** upon search completion. Guest biometric selfies are never persisted to disk or database.

---

## 11. Security, PIN Protection & Event Isolation
- **Event Isolation:** Multi-layer server-side enforcement across API routes, database queries, storage keys, and vector search.
- **PIN Protection:** Optional per-event 4-8 digit security PIN. Stored using salted one-way hashing (bcrypt). Raw PINs are never stored.
- **Brute-Force Rate Limiting:** Consecutive failed attempts from an IP trigger exponential delays and lockout windows.
- **Temporary Guest Sessions:** Successful PIN entry grants an ephemeral signed session token (JWT) scoped strictly to that specific event ID.

---

## 12. Gallery Lifecycle, Expiry & Deletion Rules
- **Configurable Public Access Window (Phase 20):**
  - Photographers configure a public duration between 1 and 30 days (`public_duration_days`), with standard presets (1, 7, 14, 30 days; default 30).
  - The server strictly validates and rejects duration values < 1 or > 30 days with `PublicWindowExceededError`.
  - UTC timestamps `public_start` and `public_until` define the exact public access period.
- **Authoritative Expiry Boundary Semantics:**
  - An event is expired when authoritative current time `now >= public_until`.
  - Expiry is calculated using the server UTC clock, never client browser clocks.
- **Dual-Layer Enforcement Architecture:**
  1. *Reactive Request-Time Guard:* Every guest route (`/api/guest/event/:slug`, `/api/guest/gallery/:slug`, `/api/guest/verify-pin/:slug`, media delivery, face search) evaluates `isEventExpired()`. At or after the boundary, requests fail immediately with `HTTP 410 Gone` (`GALLERY_EXPIRED`), providing zero access window even if background queues or worker sweepers are delayed.
  2. *Proactive Asynchronous Sweeper & Reconciler:* BullMQ delayed job scheduler and periodic reconciliation worker execute guarded atomic updates (`UPDATE events SET visibility = 'private', expired_at = NOW() WHERE id = $1 AND visibility = 'public' AND public_until <= NOW()`), and synchronously revoke all active guest sessions in `guest_sessions`.
- **Republishing & Fresh Window Semantics:**
  - When an expired or private gallery is republished (`POST /api/events/:id/publish` or `PATCH /visibility`), a brand-new public period begins starting from authoritative `NOW()`, calculating `public_until = NOW() + (duration_days * 24h)`.
  - Unrelated event metadata updates (name, description, client email, PIN changes, media uploads) never silently reset or extend `public_until`.
  - Stale queued expiry jobs from earlier publications are rejected idempotently and cannot affect newer publication windows.
- **Non-Destructive Guarantee (Zero Media Deletion):**
  - Expiry is strictly a guest visibility transition (`public` -> `private`).
  - **EXPIRY NEVER DELETES MEDIA.** Photographs, videos, ceremony folders, face detections, 128-D biometric vector embeddings, Cloudflare R2 storage objects, and photographer management tools remain 100% intact.
  - The authenticated photographer can access, manage, and republish the expired gallery at any time from the dashboard.
- **Archive vs. Permanent Delete:**
  - *Archive:* Gallery becomes private and inactive, media preserved, can be restored with one click.
  - *Permanent Delete:* Irreversible administrative destruction requiring explicit confirmation. Safely purges database records, folders, media rows, face embeddings, jobs, and all corresponding Cloudflare R2 storage objects.

---

## 13. Photo & Video Download System (Phase 21)
- **Authoritative Event Download Policy:**
  - Guests may download media only when all conditions are met:
    1. Event exists and is `status = 'active'`.
    2. Event is `visibility = 'public'`.
    3. Event has not expired (`now < public_until`).
    4. Required PIN verification has been completed and verified server-side.
    5. Event download toggle is enabled (`allow_downloads = true`).
    6. Requested media belongs strictly to the current event.
    7. Requested media is processed and `status = 'ready'`.
  - Hiding the download button in the frontend is presentation only; backend re-authorizes every download and status poll.
- **Individual Photo & Video Downloads:**
  - Delivers original-resolution high-res photographs and supported videos.
  - Direct delivery via Cloudflare R2 short-lived presigned GET URLs (15-minute TTL / 900 seconds) with zero egress bandwidth fees.
  - Generates safe `Content-Disposition: attachment; filename="${safeFilename}"` with path traversal defense, CRLF injection stripping, and 120-character bounds.
  - Disabling downloads or setting gallery to private immediately rejects all subsequent download requests.
- **Multi-Select & Bulk ZIP Downloads:**
  - Multi-select UI in guest gallery allows selecting specific photographs or selecting all visible photos up to a maximum limit of **500 items**.
  - Requests exceeding 500 items are rejected with `HTTP 400 Bad Request` (`DOWNLOAD_LIMIT_EXCEEDED`).
  - Large ZIP archives are generated asynchronously via dedicated BullMQ worker queue (`zip-generation`).
  - Worker streams original media from Cloudflare R2 without unbounded memory buffering, packs using archiver, and stores the resulting archive in private R2 storage at `events/{eventId}/exports/{jobId}.zip`.
  - Guests poll real-time progress (`pending`, `processing`, `completed`, `failed`) and receive presigned archive download URLs upon completion.
- **Temporary Archive Retention & Cleanup:**
  - Temporary ZIP exports are retained for **24 hours** from generation (`expires_at = created_at + 24h`).
  - Scheduled bounded background sweeper (`cleanupExpiredDownloadJobs`, running hourly) deletes expired R2 ZIP export objects and marks job records `expired`.
  - **NON-DESTRUCTIVE GUARANTEE:** Temporary archive cleanup deletes ONLY export ZIP objects under `events/{eventId}/exports/` and NEVER touches original photographs, videos, thumbnails, or previews.
- **QR Codes:** Print-ready SVG and high-resolution PNG QR codes pointing directly to the event's shareable link.

---

## 14. Design System & User Experience Philosophy
- **Aesthetic Direction:** Bespoke fine-art studio tone (deep carbon/onyx backgrounds, champagne bronze accents, architectural hairline borders, crisp typography pairing Plus Jakarta Sans with Cormorant Garamond).
- **Prohibited Clichés:** No generic SaaS purple/blue AI gradients, floating bouncy cards, bubbly pill containers, emojis as core icons, or decorative empty blobs.
- **Responsive & Mobile-First:** Fluid performance across mobile phones (key for QR code scans), tablets, and high-DPI desktop displays.
- **Complete UI States:** Every feature must account for Default, Loading, Empty, Success, Error, Disabled, Processing, Permission Denied, and Expired states.

---

## 15. QR Code & Gallery Sharing System (Phase 23)
- **Authoritative Canonical URL:**
  - Constructed exclusively from server-configured application base (`APP_URL`) and the event's stable public slug (`/gallery/:slug`).
  - Strict Host header injection protection: request `Host` / `X-Forwarded-Host` headers are never trusted for production URL synthesis.
  - Zero secret exposure: internal UUIDs, photographer routes, PIN codes, guest tokens, and Cloudflare R2 object keys are never included in canonical URLs.
- **In-Process QR Code Generation:**
  - Local generation via `qrcode` library with zero egress to third-party QR APIs.
  - Generates both 1000x1000px high-resolution PNG data URLs and clean SVG vector markup.
  - Error Correction Level `M` (15% redundancy) with `margin: 2` quiet-zone spacing for robust scanning in diverse lighting and camera angles.
  - Automatic download filename sanitization (`${sanitizedEventName}_QR.png` / `${sanitizedEventName}_QR.svg`).
- **Privacy & Security Boundaries:**
  - A QR code is an access URL, never an authorization credential or bypass.
  - PIN protection: QR codes never contain or encode event PINs. Guests scanning PIN-protected events must pass server-side PIN verification.
  - Private events: Photographers can preview QR codes in the dashboard, but guest access remains blocked with `HTTP 403 Forbidden`.
  - Expired events: Guest access remains blocked with `HTTP 410 Gone`. Republishing immediately restores guest access for the existing QR code.
  - IDOR defense: Only the authenticated photographer owner can access `GET /api/events/:id/qr`.
- **Editorial Sharing UI & Print-Friendly Signage:**
  - Refined modal with real-time access status badges (Public, PIN-Protected, Private, Expired).
  - One-click copy with clipboard permission fallback and accessible feedback.
  - Print-friendly layout (`@media print`): suppresses dashboard navigation and buttons to produce an elegant, centered sign displaying the event headline, QR code, guest instructions, and legible canonical URL.
