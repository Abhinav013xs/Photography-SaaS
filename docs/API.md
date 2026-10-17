# MASTER API SPECIFICATION & DOMAIN CONTRACTS (PHASE 1)

**Document Status:** Master API Contract Specification  
**Protocol:** RESTful JSON over HTTPS / TLS 1.3  
**Implementation Phase:** Formal endpoint implementation belongs to subsequent phases (Phases 4 through 28)  
**Security Governance:** Strictly governed by `docs/SECURITY.md` and `AGENTS.md`  

---

## 1. Architectural Principles & Security Boundaries

The backend API is partitioned into two distinct security domains:
1. **Photographer Domain (`/api/...`):** Administrative endpoints requiring a valid photographer JWT session cookie/header. Only the single photographer owner has access.
2. **Guest Domain (`/api/guest/...`):** Public-facing endpoints scoped strictly to a single event via URL slug. Access is gated by event visibility, the 30-day public limit, and optional PIN verification issuing an ephemeral guest JWT (`X-Guest-Token`).

### 1.1 Universal Envelope Contract
All endpoints return standard envelopes:

```typescript
// Standard Success Response
interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    requestId: string;
    total?: number;
    page?: number;
    limit?: number;
  };
}

// Standard Error Response
interface ApiError {
  success: false;
  error: {
    code: string;       // Machine-readable error code
    message: string;    // Human-readable message
    details?: unknown;  // Validation field mappings (omitted in production for security)
    requestId: string;
  };
}
```

---

## 2. Photographer API Domains

### 2.1 Authentication Domain (`/api/auth`)
- **Purpose:** Manages authentication and session security for the single photographer owner.
- **Authentication:** Public for login; HttpOnly `studio_session` cookie or `Authorization: Bearer <token>` for authenticated endpoints.
- **Authorization:** Only the single authenticated photographer owner.
- **Event Context:** N/A (Global administrative scope).
- **Rate Limiting:** Max 5 failed attempts per 15-minute sliding window per client IP on `/login`.
- **CSRF / Origin Check:** Enforced via `validateOrigin` on all mutation endpoints (`POST`, `PUT`, `DELETE`).
- **Endpoints:**
  - `POST /api/auth/login`:
    - **Request:** `{ email: string (max 255), password: string (max 128) }`
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "photographer": {
            "id": 1,
            "email": "photographer@studiolumina.photo",
            "businessName": "Studio Lumina",
            "tagline": "Fine Art Photography",
            "bio": null,
            "website": null,
            "instagram": null,
            "avatarUrl": null,
            "createdAt": "2026-10-08T00:00:00.000Z"
          },
          "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Header:** Sets `Set-Cookie: studio_session=<token>; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`
    - **Errors:** `400 VALIDATION_ERROR`, `401 AUTHENTICATION_REQUIRED` (generic "Invalid email or password"), `429 RATE_LIMITED`.
  - `POST /api/auth/logout`:
    - **Authentication:** Optional/safe.
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": { "message": "Successfully logged out" },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Header:** Clears `studio_session` cookie (`Max-Age=0`).
  - `GET /api/auth/me`:
    - **Authentication:** Required (`requirePhotographer`).
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": { "photographer": { "id": 1, "email": "...", "businessName": "..." } },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Errors:** `401 AUTHENTICATION_REQUIRED` if unauthenticated or token expired/forged.
  - `PUT /api/auth/password`:
    - **Authentication:** Required (`requirePhotographer`).
    - **Request:** `{ currentPassword: string, newPassword: string (min 8, max 128) }`
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": { "message": "Password updated successfully" },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Behavior:** Hashes new password with bcrypt (cost 10), updates database, rotates session token, issues updated cookie.
    - **Errors:** `400 VALIDATION_ERROR`, `401 AUTHENTICATION_REQUIRED` (if current password incorrect).
- **Error Codes:** `AUTHENTICATION_REQUIRED` (401), `VALIDATION_ERROR` (400), `RATE_LIMITED` (429), `FORBIDDEN` (403).

### 2.2 Events Lifecycle Domain (`/api/events`)
- **Purpose:** Full lifecycle and visibility management of client event containers.
- **Authentication:** Required (`requirePhotographer` middleware).
- **Authorization:** Authenticated photographer owner. Owner derived strictly from session (`req.photographer.id`).
- **Event Context & IDOR Defense:** Scoped via `:eventId` parameter enforcing `WHERE id = :id AND owner_id = :ownerId`.
- **Endpoints:**
  - `GET /api/events`:
    - **Query Parameters:** `status` (`all | draft | active | archived`), `visibility` (`all | public | private`), `search` (case-insensitive name substring), `page` (default 1), `limit` (default 50, max 100).
    - **Response:** `200 OK` with `EventListItem[]` and pagination metadata (`requestId`, `total`, `page`, `limit`).
  - `POST /api/events`:
    - **Request Body:** `{ name: string (1-255), description?: string, clientName?: string, eventDate?: ISOString, location?: string, visibility?: 'public' | 'private', publicFrom?: ISOString, publicUntil?: ISOString, public_duration_days?: number (1-30, default 30), pinEnabled?: boolean, pin?: string (4-8 digits), allowDownloads?: boolean, watermarkEnabled?: boolean, watermarkText?: string, faceSearchEnabled?: boolean }`
    - **Safe Defaults Applied:** `status = 'draft'`, `visibility = 'private'`, `public_duration_days = 30`, `allow_downloads = false`, `pin_enabled = false`, `watermark_enabled = false`.
    - **Rules Enforced:** Auto-generates URL-safe unique slug (appends numeric counter if collision occurs). Enforces maximum 30-day public window (`public_duration_days <= 30`). Hashes PIN via bcrypt cost 10 and never exposes `pin_hash`.
    - **Response:** `201 Created` with created `EventDetail`.
  - `GET /api/events/:eventId`:
    - **Response:** `200 OK` with `EventDetail` (includes `public_duration_days`, `public_start`, `public_until`, `expired_at`; never includes `pin_hash`). Returns `404 EVENT_NOT_FOUND` if event does not exist or belongs to another owner.
  - `PATCH /api/events/:eventId`:
    - **Request Body:** Partial `UpdateEventDTO` (including optional `public_duration_days: number (1-30)`).
    - **Behavior:** Updates only supplied fields without unintentionally resetting existing configuration. Recalculates slug if `name` changed. Hashes new PIN if supplied and updates `pin_hash`. Clears `pin_hash = NULL` if `pinEnabled = false`. If `public_duration_days` is updated for a currently public event, recalculates `public_until = public_start + (public_duration_days * 24h)`. Unrelated edits (name, location, PIN) do not reset or extend `public_until`.
    - **Response:** `200 OK` with updated `EventDetail`.
  - `PATCH /api/events/:eventId/visibility`:
    - **Purpose:** Dedicated endpoint for photographer to toggle event visibility between `public` and `private`.
    - **Authentication:** Required (`requirePhotographer` middleware).
    - **Request Body:** `{ "visibility": "public" | "private", "public_duration_days"?: number (1-30) }`
    - **Validation:** Strict enum validation rejecting unexpected fields, empty payloads, or invalid types (`HTTP 400 VALIDATION_ERROR`). Duration strictly validated between 1 and 30 days.
    - **Behavior:**
      - If transitioning to `'private'`: Updates database, sets `expired_at = NOW()` if transitioning due to expiry, and immediately invalidates all active guest sessions for this event in `guest_sessions` table (`revokeEventGuestSessions`). Subsequent guest requests are instantly denied with `HTTP 403 Forbidden`.
      - If transitioning to `'public'`: Starts a brand-new fresh public period from authoritative `NOW()`, calculating `public_until = NOW() + (public_duration_days * 24h)` (default 30 days). Enqueues delayed BullMQ expiry job.
      - Preserves all other event fields, folders, media, and PIN configuration untouched.
    - **Response:** `200 OK` with updated `EventDetail`.
  - `POST /api/events/:eventId/publish`:
    - **Request Body:** `{ publicFrom?: ISOString, publicUntil?: ISOString, public_duration_days?: number (1-30) }` (optional; defaults to NOW and NOW + 30 days).
    - **Behavior:** Starts a fresh publication period from authoritative `NOW()`, sets `visibility = 'public'`, `status = 'active'`, `expired_at = NULL`, and recalculates `public_until`. Enqueues delayed BullMQ expiry job.
    - **Response:** `200 OK` with updated `EventDetail`.
  - `POST /api/events/:eventId/unpublish`:
    - **Behavior:** Sets `visibility = 'private'`. Immediately stops future public guest access while preserving all media and configuration.
    - **Response:** `200 OK` with updated `EventDetail`.
  - `POST /api/events/:eventId/archive`:
    - **Behavior:** Transitions lifecycle to `status = 'archived'`. Preserves all folders, media, and embeddings.
    - **Response:** `200 OK` with updated `EventDetail`.
  - `GET /api/events/bin`:
    - **Purpose:** Lists all soft-deleted events in the photographer's Recycle Bin.
    - **Authentication:** Required (`requirePhotographer` middleware).
    - **Response:** `200 OK` with `TrashedEventListItem[]` including `days_remaining`, `deleted_at`, `purge_after`, and total items count.
  - `POST /api/events/:eventId/trash`:
    - **Purpose:** Moves an active or archived event to the Recycle Bin (Soft Delete).
    - **Authentication:** Required (`requirePhotographer` middleware).
    - **Behavior:** Updates status to `'trashed'`, records `deleted_at` (UTC), `purge_after` (default 30 days, UTC), `deleted_by`, immediately revokes all guest sessions, re-privatizes gallery, and preserves 100% of photos, videos, R2 objects, and face embeddings.
    - **Response:** `200 OK` with `{ eventId, trashed: true, status: 'trashed', deleted_at, purge_after, days_remaining }`.
  - `POST /api/events/:eventId/restore`:
    - **Purpose:** Restores an archived or trashed event back to active status.
    - **Authentication:** Required (`requirePhotographer` middleware).
    - **Behavior:** Transitions lifecycle from `archived` or `trashed` to `status = 'active'`, clearing trash timestamps. Preserves intact photos and face embeddings with zero re-indexing needed. Rejects with `409 Conflict` if permanent deletion has already started (`status === 'deleting'`).
    - **Response:** `200 OK` with updated `EventDetail`.
  - `DELETE /api/events/:eventId/permanent`:
    - **Purpose:** Explicitly purges an individual trashed event before the 30-day retention deadline.
    - **Authentication:** Required (`requirePhotographer` middleware).
    - **Request Body:** `{ confirmEventName: string }`
    - **Behavior:** Verifies typed event name match, locks status to `'deleting'`, purges all R2 objects under `events/{id}/`, deletes database records and face embeddings, verifies complete purge, and records durable audit state.
    - **Response:** `200 OK` with `DeleteEventResponseDTO`.
  - `POST /api/events/bin/empty`:
    - **Purpose:** Permanently deletes all trashed events belonging to the authenticated photographer.
    - **Authentication:** Required (`requirePhotographer` middleware).
    - **Request Body:** `{ confirm: true }`
    - **Behavior:** Sequentially claims and purges each trashed event of the photographer while strictly isolating active events and other photographers' events.
    - **Response:** `200 OK` with `{ totalRequested, successfullyDeleted, failedCount, failedEventIds }`.
  - `DELETE /api/events/:eventId`:
    - **Request Body:** `{ confirmEventName: string }` (or `{ confirmName: string }`)
    - **Behavior:** Permanently deletes the event and all associated records and storage objects. Requires exact matching event name typed by photographer. Immediately applies soft-lock (`status = 'deleting'`), invalidates active guest sessions, blocks new uploads/searches/indexing jobs, purges all Cloudflare R2 objects under `events/{eventId}/` (handling pagination, batching up to 1,000 keys per chunk, and bounded retries), cascades deletes across PostgreSQL tables (`media`, `folders`, `face_embeddings`, `processing_jobs`, `download_jobs`, `storage_usage`, `events`), verifies complete erasure (0 DB rows, 0 R2 keys), and records durable completion in `event_deletion_jobs`.
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "deleted": true,
          "id": "e0000000-0000-0000-0000-000000000001",
          "name": "Heritage Palace Gala 2026",
          "jobId": "uuid",
          "r2ObjectsDeleted": 42,
          "stage": "completed"
        },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Errors:** `400 VALIDATION_ERROR` (name mismatch), `401 AUTHENTICATION_REQUIRED`, `404 EVENT_NOT_FOUND`.
  - `GET /api/events/:eventId/deletion-status`:
    - **Purpose:** Inspects real-time durable deletion job status, stage, attempt count, error codes, and purged R2 object count.
    - **Authentication:** Required (`requirePhotographer` middleware).
    - **Response:** `200 OK` with `EventDeletionJobDTO` or `null` if no job exists.
      ```json
      {
        "success": true,
        "data": {
          "id": "uuid",
          "eventId": "e0000000-0000-0000-0000-000000000001",
          "ownerId": 1,
          "eventName": "Heritage Palace Gala 2026",
          "status": "completed",
          "stage": "completed",
          "attempts": 1,
          "r2ObjectsDeleted": 42,
          "errorCode": null,
          "errorMessage": null,
          "startedAt": "2026-10-10T10:00:00.000Z",
          "completedAt": "2026-10-10T10:00:03.000Z",
          "createdAt": "2026-10-10T10:00:00.000Z",
          "updatedAt": "2026-10-10T10:00:03.000Z"
        },
        "meta": { "requestId": "uuid" }
      }
      ```
  - `GET /api/events/:eventId/qr`:
    - **Purpose:** Generates canonical guest gallery URL, high-resolution printable PNG data URL (1000px, 300+ DPI equivalent), and scalable vector SVG markup for sharing and physical event signage.
    - **Authentication:** Required (`requirePhotographer` middleware).
    - **Authorization:** Authenticated photographer owner (`WHERE id = :id AND owner_id = :ownerId`).
    - **Canonical URL Construction:** Strictly uses the configured application origin (`APP_URL`) and the event's stable public slug (`/gallery/:slug`). Never uses unvalidated request `Host` headers. Never embeds PINs, internal database UUIDs, session tokens, or private R2 URLs in the QR code or link.
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "shareUrl": "https://gallery.studiolumina.photo/gallery/autumn-wedding-2026",
          "qrDataUrl": "data:image/png;base64,...",
          "qrSvg": "<svg ...></svg>",
          "eventName": "Autumn Wedding",
          "clientName": "Sarah & Tom",
          "eventDate": "2026-10-15",
          "pinProtected": false,
          "visibility": "public",
          "isExpired": false,
          "publicUntil": "2026-11-14T00:00:00.000Z"
        },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Errors:** `401 AUTHENTICATION_REQUIRED`, `400 VALIDATION_ERROR` (invalid UUID), `404 EVENT_NOT_FOUND`.
- **Error Codes:** `EVENT_NOT_FOUND` (404), `VALIDATION_ERROR` (400), `PUBLIC_WINDOW_EXCEEDED` (400), `INVALID_LIFECYCLE_TRANSITION` (400), `SLUG_ALREADY_EXISTS` (409), `CONFIRMATION_MISMATCH` (400).

### 2.3 Folders Domain (`/api/events/:eventId/folders`)
- **Purpose:** Ceremony or category grouping within an event container. Flat hierarchy per event.
- **Authentication:** Required (`requirePhotographer` middleware).
- **Authorization:** Authenticated photographer owner. Owner verified via session (`req.photographer.id`).
- **Event Context & Isolation:** Verified: `:eventId` must exist and belong to the photographer owner. All folders are strictly scoped to `:eventId`.
- **Endpoints:**
  - `GET /api/events/:eventId/folders`:
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "folders": [
            {
              "id": "uuid",
              "eventId": "uuid",
              "name": "Ceremony",
              "sortOrder": 0,
              "mediaCount": 42,
              "createdAt": "2026-10-09T08:00:00.000Z",
              "updatedAt": "2026-10-09T08:00:00.000Z"
            }
          ],
          "uncategorizedCount": 15
        },
        "meta": { "requestId": "uuid" }
      }
      ```
  - `POST /api/events/:eventId/folders`:
    - **Request Body:** `{ name: string (1-100 characters, trimmed), sortOrder?: integer (min 0) }`
    - **Validation:** Enforces non-empty name, case-insensitive uniqueness within `:eventId`.
    - **Response:** `201 Created` with `FolderItem` (with `mediaCount: 0`).
    - **Errors:** `400 VALIDATION_ERROR`, `404 EVENT_NOT_FOUND`, `409 FOLDER_NAME_CONFLICT`.
  - `GET /api/events/:eventId/folders/:folderId`:
    - **Response:** `200 OK` with `FolderDetail` (`{ id, eventId, name, sortOrder, mediaCount, createdAt, updatedAt }`).
    - **Errors:** `404 FOLDER_NOT_FOUND` (if folder doesn't exist or belongs to another event).
  - `PATCH /api/events/:eventId/folders/:folderId` (and `PUT` alias):
    - **Request Body:** `{ name?: string (1-100 characters, trimmed), sortOrder?: integer (min 0) }`
    - **Validation:** If `name` provided, checks case-insensitive uniqueness against other folders in `:eventId`.
    - **Response:** `200 OK` with updated `FolderItem`.
    - **Errors:** `400 VALIDATION_ERROR`, `404 FOLDER_NOT_FOUND`, `409 FOLDER_NAME_CONFLICT`.
  - `DELETE /api/events/:eventId/folders/:folderId`:
    - **Behavior:** **Safe Folder Deletion**. Runs within a database transaction:
      1. Reassigns all media in this folder to `folder_id = NULL` (event root / uncategorized pool).
      2. Deletes the folder record.
      3. **Media items and storage files are NEVER deleted.**
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "message": "Folder deleted successfully. Media items have been moved to event root.",
          "reassignedMediaCount": 42
        },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Errors:** `404 FOLDER_NOT_FOUND`.
- **Error Codes:** `FOLDER_NOT_FOUND` (404), `FOLDER_NAME_CONFLICT` (409), `EVENT_NOT_FOUND` (404), `VALIDATION_ERROR` (400).

### 2.4 Media Upload & Management Domain (`/api/events/:eventId/media`)
- **Purpose:** Orchestrates direct-to-R2 batch uploads, media queries, folder organization, and bulk actions.
- **Authentication:** Required (`requirePhotographer` middleware).
- **Authorization:** Authenticated photographer owner.
- **Event Context:** Verified: media operations strictly bound to `:eventId`. Cross-event operations are rejected.
- **Folder Assignment Endpoints (Phase 7):**
  - `PATCH /api/events/:eventId/media/:mediaId/folder`:
    - **Request Body:** `{ folderId: string | null }` (UUID or null to move to event root).
    - **Validation:** Verifies media belongs to `:eventId`. If `folderId` is non-null, validates target folder exists and belongs to `:eventId`. Rejects cross-event assignment.
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "mediaId": "uuid",
          "folderId": "uuid" | null,
          "message": "Media moved successfully"
        },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Errors:** `400 INVALID_TARGET_FOLDER`, `404 MEDIA_NOT_FOUND`, `404 EVENT_NOT_FOUND`.
  - `POST /api/events/:eventId/media/move-batch`:
    - **Request Body:** `{ mediaIds: string[] (1-500 UUIDs), targetFolderId: string | null }`
    - **Validation:** Validates array length (1-500). If `targetFolderId` is non-null, verifies folder belongs to `:eventId`.
    - **Behavior:** Executes transactional batch update scoped strictly by `event_id = :eventId`:
      ```sql
      UPDATE media SET folder_id = $1, updated_at = NOW() WHERE event_id = $2 AND id IN (...)
      ```
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "message": "Successfully moved 12 media items",
          "movedCount": 12,
          "targetFolderId": "uuid" | null
        },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Errors:** `400 INVALID_TARGET_FOLDER`, `400 VALIDATION_ERROR`, `404 EVENT_NOT_FOUND`.
- **Photo Upload Endpoints (Phase 10 Implementation):**
  - `POST /api/events/:eventId/media/presign-batch`:
    - **Purpose:** Authorizes and generates short-lived S3 presigned PUT URLs for direct browser-to-R2 binary upload without application server buffering.
    - **Request Body:** `{ folderId?: string | null, items: Array<{ filename: string, mimeType: string, sizeBytes: number, folderId?: string | null }> }` (1-500 items).
    - **Validation:** Enforces supported formats (`image/jpeg`, `image/png`, `image/webp`), size limits (max 100 MB per photo), batch limits (max 500 items), event ownership, and destination folder ownership. Strictly rejects SVG (`415 UNSUPPORTED_MEDIA_TYPE`) and HEIC/HEIF (`415 UNSUPPORTED_MEDIA_TYPE`).
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "items": [
            {
              "mediaId": "uuid",
              "originalName": "photo.jpg",
              "filename": "uuid.jpg",
              "storageKey": "events/{eventId}/originals/{mediaId}.jpg",
              "uploadUrl": "https://{r2}.cloudflarestorage.com/events/...X-Amz-Signature=...",
              "expiresAt": "2026-10-09T18:30:00.000Z",
              "folderId": "uuid" | null
            }
          ]
        },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Errors:** `400 VALIDATION_ERROR`, `400 INVALID_TARGET_FOLDER`, `404 EVENT_NOT_FOUND`, `413 FILE_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`.
  - `POST /api/events/:eventId/media/confirm-upload`:
    - **Purpose:** Verifies that uploaded binary assets exist in Cloudflare R2 storage via `headObject` and persists confirmed original metadata in PostgreSQL with `status = 'uploaded'`.
    - **Request Body:** `{ items: Array<{ mediaId: string, storageKey: string, originalName: string, mimeType: string, sizeBytes: number, folderId?: string | null }> }`
    - **Idempotency:** Repeated confirmation attempts for the same `mediaId` return the existing confirmed record without creating duplicate rows or corrupting storage calculations.
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "confirmed": [
            {
              "id": "uuid",
              "eventId": "uuid",
              "folderId": "uuid" | null,
              "type": "photo",
              "filename": "uuid.jpg",
              "originalName": "photo.jpg",
              "mimeType": "image/jpeg",
              "fileSize": 15728640,
              "storageKeyOriginal": "events/{eventId}/originals/{mediaId}.jpg",
              "status": "uploaded",
              "createdAt": "2026-10-09T18:00:00.000Z",
              "updatedAt": "2026-10-09T18:00:00.000Z"
            }
          ],
          "failed": []
        },
        "meta": { "requestId": "uuid" }
      }
      ```
  - `GET /api/events/:eventId/media`:
    - **Purpose:** Lists media assets for an event with folder, status, and pagination filters.
    - **Query Parameters:** `folderId` (`all | root | <uuid>`), `type` (`all | photo | video`), `status` (`all | uploaded | processing | ready | failed`), `page` (default 1), `limit` (default 50, max 200).
    - **Response:** `200 OK` with `{ media: MediaListItem[] }` and pagination metadata (`requestId`, `total`, `page`, `limit`).
  - `POST /api/events/:eventId/media/:mediaId/process` (Phase 11 Implementation):
    - **Purpose:** Manually triggers or retries background derivative generation (thumbnail & preview) for a single photo.
    - **Validation:** Verifies `:eventId` ownership and `:mediaId` existence.
    - **Behavior:** Downloads original from private R2 storage, generates WebP thumbnail (480px, q80) and preview (1920px, q85) via Sharp, uploads derivatives to R2, and updates PostgreSQL `media` record to `status = 'ready'`. Idempotent: returns existing metadata if already processed.
    - **Response:** `200 OK`
      ```json
      {
        "success": true,
        "data": {
          "mediaId": "uuid",
          "status": "ready",
          "thumbnailKey": "events/{eventId}/thumbnails/{mediaId}.webp",
          "previewKey": "events/{eventId}/previews/{mediaId}.webp",
          "thumbnailSize": 45120,
          "previewSize": 348910,
          "width": 2400,
          "height": 1600
        },
        "meta": { "requestId": "uuid" }
      }
      ```
    - **Errors:** `400 VALIDATION_ERROR`, `401 AUTHENTICATION_REQUIRED`, `404 EVENT_NOT_FOUND`, `404 MEDIA_NOT_FOUND`, `422 CORRUPT_IMAGE`, `422 DECOMPRESSION_BOMB_DETECTED`.
  - `POST /api/events/:eventId/media/process-batch` (Phase 11 Implementation):
    - **Purpose:** Batch retries or processes multiple photos in an event.
    - **Request Body:** `{ mediaIds: string[] }` (1-500 UUIDs).
    - **Response:** `200 OK` with `{ processed: ProcessPhotoResponseDTO[], failed: Array<{ mediaId: string, error: string }> }`.
- **Error Codes:** `INVALID_TARGET_FOLDER` (400), `MEDIA_NOT_FOUND` (404), `UNSUPPORTED_MEDIA_TYPE` (415), `FILE_TOO_LARGE` (413), `BATCH_LIMIT_EXCEEDED` (400), `CORRUPT_IMAGE` (422), `DECOMPRESSION_BOMB_DETECTED` (422).

### 2.5 Storage Management Domain (`/api/storage`) (Phase 9 Implementation)
- **Purpose:** Measured application-tracked storage consumption and direct Cloudflare R2 navigation.
- **Authentication:** Required (Photographer JWT session).
- **Authorization:** Single photographer owner.
- **Endpoints:**
  - `GET /api/storage/usage` (and alias `GET /api/storage`):
    - Returns `StorageUsageSummary`:
      - `source`: `'application_metadata'` | `'application_media_records'`
      - `totalBytes`: Total application-tracked byte sum (originals + derivatives + videos).
      - `breakdown`: `{ originalPhotosBytes, derivedImagesBytes, videosBytes, otherBytes }`
      - `mediaCounts`: `{ photos, videos, total }`
      - `calculatedAt`: ISO timestamp of latest calculation or media record.
      - `isStale`: Boolean flag indicating if calculation is older than 24 hours or newer media has been uploaded.
      - `r2`: `{ configured, bucketName, status: 'healthy'|'unconfigured'|'error', managementUrl, billingUrl }`
      - `events`: Array of per-event storage summaries (`eventId`, `eventName`, `slug`, `status`, `totalBytes`, `photoCount`, `videoCount`, `lastCalculatedAt`).
- **Error Codes:** `AUTHENTICATION_REQUIRED` (401), `INTERNAL_SERVER_ERROR` (500).

### 2.6 QR & Sharing Domain (`/api/events/:eventId/qr`)
- **Purpose:** Generates print-ready QR codes pointing to the public gallery URL.
- **Authentication:** Required (Photographer JWT).
- **Authorization:** Photographer owner.
- **Endpoints:**
  - `GET /api/events/:eventId/qr`: Query parameter `format=svg|png`. Generates high-resolution QR code pointing to `${APP_URL}/gallery/${event.slug}`. Does NOT expose internal credentials.
- **Error Codes:** `EVENT_NOT_FOUND` (404).

---

## 3. Guest API Domains

### 3.1 Guest Gallery Access Domain (`/api/guest/gallery/:slug`)
- **Purpose:** Public event retrieval for accountless guests.
- **Authentication:** None (Public / Accountless).
- **Authorization:** Gated by event visibility and optional PIN.
- **Event Context:** Bound strictly to `:slug`.
- **Endpoints:**
  - `GET /api/guest/gallery/:slug`:
    1. Looks up event by `:slug`.
    2. Evaluates public visibility: if `visibility !== 'public'` or `status !== 'active'`, returns `HTTP 403 Forbidden` (`This gallery is currently private.`) with no folder or photo disclosure.
    3. Evaluates 30-day public window: if `public_until < NOW()`, returns `HTTP 410 Gallery Expired`.
    4. Evaluates PIN: if `pin_enabled = true`, checks for valid `X-Guest-Token` or session cookie.
       - If valid token present and matches event ID: returns full gallery metadata, folders, and photo grid.
       - If token missing or invalid: returns `HTTP 200` with payload `{ requiresPin: true, name, clientName, coverPhotoUrl }` (photo grid withheld).
  - `GET /api/guest/gallery/:slug/media`: Returns paginated photos and folders for authorized guests. Fails with `HTTP 403 Forbidden` if gallery is private.
- **Error Codes:** `EVENT_NOT_FOUND` (404), `GALLERY_PRIVATE` (403), `GALLERY_EXPIRED` (410), `PIN_REQUIRED` (401), `INVALID_GUEST_TOKEN` (403).

### 3.2 Guest PIN Verification Domain (`/api/guest/gallery/:slug/pin` / `POST /verify-pin/:slug`)
- **Purpose:** Validates client PIN and issues ephemeral guest JWT.
- **Authentication:** None.
- **Authorization:** Rate-limited IP verification.
- **Event Context:** Bound strictly to `:slug`.
- **Visibility Gate (Phase 19):** If `visibility !== 'public'` or `status !== 'active'`, immediately returns `HTTP 403 Forbidden` (`This gallery is currently private.`). Valid PINs never grant access to a private gallery.
- **Endpoints:**
  - `POST /api/guest/gallery/:slug/pin`: Accepts `{ pin: string }`.
    1. Verifies gallery is active and public. If private, returns `HTTP 403`.
    2. Checks rate limiter: maximum 5 failed attempts per IP + slug per 15 minutes. If exceeded, returns `HTTP 429 Too Many Requests`.
    3. Compares PIN against salted `events.pin_hash` using bcrypt.
    3. If invalid: increments failed counter, returns `HTTP 401 Invalid PIN`.
    4. If valid: resets failed counter, issues ephemeral signed JWT containing `{ eventId, scope: 'guest_gallery_access' }` valid for 12 hours.
- **Error Codes:** `INVALID_PIN` (401), `RATE_LIMITED` (429), `EVENT_NOT_FOUND` (404).

### 3.3 Guest AI Face Search Domain (`/api/guest/gallery/:slug/search`)
- **Purpose:** "Find My Photos" biometric facial similarity search.
- **Authentication:** None. Requires valid `X-Guest-Token` if PIN enabled.
- **Authorization:** Event-scoped guest access.
- **Event Context:** Strictly bound to `:slug`.
- **Endpoints:**
  - `POST /api/guest/gallery/:slug/search`: Accepts multipart form with `selfie` image buffer.
    1. Verifies gallery is public, unexpired, and PIN-authorized.
    2. Streams selfie directly to Python AI microservice in RAM (zero disk persistence).
    3. YuNet detects face; SFace generates 128-D L2-normalized vector.
    4. Python service immediately unlinks and destroys the selfie buffer.
    5. API executes SQL query with strict event boundary:
       ```sql
       SELECT fe.photo_id, 1 - (fe.embedding <=> $vector) AS score
       FROM face_embeddings fe
       WHERE fe.event_id = $eventId
         AND (fe.embedding <=> $vector) < 0.38
       ORDER BY fe.embedding <=> $vector ASC;
       ```
    6. Returns matching unique `photo_id` list and metadata (including group photos).
- **Error Codes:** `NO_FACE_DETECTED` (422), `MULTIPLE_FACES_IN_SELFIE` (422), `RATE_LIMITED` (429), `GALLERY_EXPIRED` (410).

### 3.4 Media Downloads Domain (`/api/guest/gallery/:slug/download`)
- **Purpose:** Authorized download of single photos or bulk ZIP archives.
- **Authentication:** None. Requires valid `X-Guest-Token` if PIN enabled.
- **Authorization:** Gated by `events.allow_downloads === true`.
- **Event Context:** Strictly bound to `:slug`.
- **Endpoints:**
  - `GET /api/guest/gallery/:slug/download/:mediaId`:
    1. Verifies `events.allow_downloads === true`.
    2. Verifies `media.event_id === event.id`.
    3. Generates time-limited (15-minute) pre-signed Cloudflare R2 GET URL for original master with `response-content-disposition=attachment`.
    4. Redirects guest directly to Cloudflare R2 with zero server egress fees.
  - `POST /api/guest/gallery/:slug/download-zip`:
    1. Verifies `events.allow_downloads === true`.
    2. For collections < 50 photos: streams dynamic ZIP archive over HTTP.
    3. For collections >= 50 photos: enqueues `queue:zip-generation`, returning a job ID to poll. Once compiled, provides pre-signed download URL for temporary ZIP on R2.
- **Error Codes:** `DOWNLOADS_DISABLED` (403), `MEDIA_NOT_FOUND` (404), `EVENT_MISMATCH` (403).

---

## 4. System Health & Observability Domain (`/health`)

- **Purpose:** System liveness and diagnostic probe.
- **Authentication:** Public (no sensitive configuration, credentials, or signed URLs revealed).
- **Endpoints:**
  - `GET /health`: Returns overall health and subsystem diagnostics:
    ```json
    {
      "status": "healthy",
      "timestamp": "2026-10-09T10:00:00.000Z",
      "version": "1.0.0",
      "uptimeSeconds": 142,
      "environment": "development",
      "checks": {
        "database": { "status": "healthy", "latencyMs": 3 },
        "redis": { "status": "healthy", "latencyMs": 1 },
        "aiService": { "status": "disabled", "message": "AI microservice disabled in dev" },
        "storage": { "status": "healthy", "latencyMs": 12, "message": "Cloudflare R2 bucket \"studio-lumina-photos\" is accessible", "details": { "bucket": "studio-lumina-photos" } }
      }
    }
    ```
  - `GET /health/live`: Liveness probe for process managers (`{ "status": "ok", "service": "photography-api" }`).
  - `GET /health/ready`: Readiness probe verifying database connectivity before routing traffic.
- **Storage Error Codes:**
  - `STORAGE_CONFIG_MISSING` (503): R2 environment variables are not set or incomplete.
  - `STORAGE_AUTH_FAILED` (502): Access key ID or secret signature mismatch.
  - `STORAGE_PERMISSION_DENIED` (403): Insufficient bucket IAM policy permissions.
  - `STORAGE_BUCKET_NOT_FOUND` (502): Configured bucket name does not exist.
  - `STORAGE_OBJECT_NOT_FOUND` (404): Key not found in bucket.
  - `STORAGE_TIMEOUT` (504): R2 request timed out (> 10s).
  - `STORAGE_NETWORK_ERROR` (502): Network or DNS resolution failure.
  - `STORAGE_RATE_LIMITED` (429): Cloudflare R2 rate limit exceeded.
  - `STORAGE_KEY_INVALID` (400): Malformed key or path traversal attempt.
  - `STORAGE_ERROR` (500): General storage operation failure.

---

## 5. Video Processing & Management Endpoints (Phase 12)

### 5.1 Media Upload Presigning (`POST /api/events/:eventId/media/presign-batch`)
- **Authentication:** Photographer session cookie required.
- **Allowed Video Types:** `video/mp4`, `video/quicktime`, `video/webm`.
- **Max Video Size:** 500 MB (524,288,000 bytes).
- **Request Body:**
  ```json
  {
    "folderId": "optional-uuid",
    "items": [
      {
        "filename": "ceremony_recap.mp4",
        "mimeType": "video/mp4",
        "sizeBytes": 209715200
      }
    ]
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "mediaId": "uuid-v4",
          "filename": "ceremony_recap.mp4",
          "storageKey": "events/:eventId/originals/:mediaId.mp4",
          "uploadUrl": "https://<account>.r2.cloudflarestorage.com/events/...?X-Amz-Signature=...",
          "expiresInSeconds": 1800,
          "folderId": "optional-uuid"
        }
      ]
    }
  }
  ```

### 5.2 Upload Confirmation (`POST /api/events/:eventId/media/confirm-upload`)
- Automatically registers `type: 'video'` when MIME type begins with `video/`.
- Verifies uploaded object presence with R2 `headObject`.
- Enqueues video to isolated `AsyncVideoProcessingQueue` (concurrency = 1).

### 5.3 Single Media Derivative Processing (`POST /api/events/:eventId/media/:mediaId/process`)
- Automatically inspects media type in database:
  - If `type === 'video'`: Executes video probing, WebP poster extraction, and web-optimized 1080p MP4 transcoding.
  - If `type === 'photo'`: Executes sharp WebP thumbnail and preview generation.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "mediaId": "uuid-v4",
      "status": "ready",
      "posterKey": "events/:eventId/thumbnails/:mediaId.webp",
      "playbackKey": "events/:eventId/previews/:mediaId.mp4",
      "posterSize": 45120,
      "playbackSize": 18450120,
      "duration": 42.5,
      "width": 1920,
      "height": 1080,
      "videoCodec": "h264",
      "audioCodec": "aac"
    }
  }
  ```

### 5.4 Dedicated Video Processing (`POST /api/events/:eventId/media/:mediaId/process-video`)
- Explicit endpoint for retrying or reprocessing video items directly.

---

## 6. AI Biometrics & Face Search Domain (`POST /api/events/:eventId/face-search`)

### 6.1 Guest Face Search (`POST /api/events/:eventId/face-search`)
- **Purpose:** Core "Find My Photos" feature. Guests upload a query selfie to retrieve all photos containing their face from the authorized event.
- **Authorization Boundary:**
  - Authenticated single photographer owner session (`studio_session` cookie or `Authorization: Bearer <token>`).
  - OR ephemeral event-scoped guest token via `X-Guest-Token` header.
  - Access is denied with `401 AUTHENTICATION_REQUIRED` if unauthenticated, or `403 FORBIDDEN` if accessing an unauthorized event.
  - Denied with `403 FACE_SEARCH_DISABLED` if `face_search_enabled = false` on the event.
  - Denied with `409 CONFLICT` if event is currently in `deleting` lifecycle state.
- **Rate Limiting:** Enforced via sliding-window rate limiter: max 10 face searches per minute per client IP + event. Returns `429 Too Many Requests` with `Retry-After: <seconds>`.
- **Privacy & Biometric Zero-Retention:**
  - Query selfies are processed ephemerally in RAM.
  - Converted to a 128-D vector embedding and immediately destroyed.
  - Raw query selfies are **never** stored in Cloudflare R2, database, or logs.
  - Raw vector embeddings are **never** exposed in client responses.
- **Exactly-One-Face Policy:**
  - 0 detected faces: Returns `422 NO_FACE_DETECTED` with actionable user guidance to submit a clearer, well-lit photo.
  - >1 detected faces: Returns `422 MULTIPLE_FACES_DETECTED` requesting a selfie containing only one person.
  - 1 detected face: Proceed to SFace feature extraction and event-scoped vector search.
- **Similarity Metric & Threshold:**
  - pgvector cosine distance: `fe.embedding <=> $1::vector` (using HNSW index `idx_face_embeddings_hnsw`).
  - Calibrated default threshold: `0.363` (corresponding to OpenCV SFace cosine similarity $\ge 0.637$ at FAR 0.001 benchmark).
  - Score formula: `matchScore = Math.max(0, Math.min(1, 1 - cosineDistance))`.
- **Group Photo Deduplication:**
  - Multiple matching faces in the same photograph are grouped by `media.id` with `MIN(distance)`.
  - A photograph appears at most once in results, ranked by its closest matching face.
- **Request:**
  - `Content-Type: application/json`
  - Body: `{ "image": "data:image/jpeg;base64,..." }` or `{ "imageBase64": "..." }`
  - Query Parameters:
    - `limit`: Integer (1-100, default 20)
    - `offset`: Integer (default 0)
    - `threshold`: Float (default 0.363)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "status": "completed",
      "results": [
        {
          "mediaId": "10000000-0000-0000-0000-0000000000a1",
          "filename": "reception_dance.jpg",
          "width": 4000,
          "height": 2667,
          "storageKeyPreview": "events/a000.../previews/1000...webp",
          "storageKeyThumbnail": "events/a000.../thumbnails/1000...webp",
          "createdAt": "2026-10-09T18:00:00.000Z",
          "matchRank": 1,
          "matchScore": 0.9412,
          "cosineDistance": 0.0588
        }
      ],
      "pagination": {
        "total": 12,
        "limit": 20,
        "offset": 0,
        "hasMore": false
      },
      "queryFace": {
        "confidence": 0.985,
        "boxX": 0.28,
        "boxY": 0.22,
        "boxW": 0.35,
        "boxH": 0.40
      },
      "searchDurationMs": 14
    },
    "meta": {
      "requestId": "uuid",
      "total": 12,
      "limit": 20,
      "page": 1
    }
  }
  ```

---

## 7. Guest Domain & PIN Protection (`/api/guest`)

### 7.1 Public Event Metadata (`GET /api/guest/event/:slug`)
- **Purpose:** Public metadata resolution for guest gallery landing and PIN protection check.
- **Authorization:** Public access (restricted only by event active status and 30-day public visibility limit).
- **Security:**
  - Strips all internal secrets, database IDs, and password/PIN hashes.
  - Returns `pin_protected: boolean` to signal whether PIN verification is required.
  - Rejects private events with `403 FORBIDDEN`.
  - Rejects expired events with `410 GALLERY_EXPIRED`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "event": {
        "id": "a0000000-0000-0000-0000-000000000001",
        "slug": "royal-wedding-2026",
        "name": "Royal Wedding 2026",
        "client_name": "Priya & Rahul",
        "event_date": "2026-11-15",
        "location": "Umaid Bhawan Palace, Jodhpur",
        "description": "Three days of royal celebration.",
        "status": "active",
        "visibility": "public",
        "public_until": "2026-12-15T00:00:00.000Z",
        "is_expired": false,
        "pin_protected": true,
        "allow_downloads": true,
        "watermark_enabled": false,
        "watermark_text": "Studio Lumina",
        "face_search_enabled": true,
        "cover_photo_id": "cover-uuid",
        "cover_preview_url": "/api/media/preview/a000.../cover-uuid",
        "photographer": {
          "business_name": "Studio Lumina",
          "tagline": "Editorial & Fine Art Photography",
          "instagram": "@studiolumina",
          "website": "https://studiolumina.photo"
        }
      }
    }
  }
  ```

### 7.2 Verify Guest PIN (`POST /api/guest/verify-pin/:slug`)
- **Purpose:** Verifies event PIN code, grants temporary authorization, and sets an event-scoped HttpOnly cookie.
- **Authorization:** Public submission gated by strict brute-force rate limiting.
- **Rate Limiting:** Max 5 failed attempts per 15-minute sliding window per client IP + event. Returns `429 Too Many Requests` with `Retry-After: <seconds>`.
- **Validation:** Exactly 4 to 8 numeric digits (`^\d{4,8}$`). Preserves leading zeros.
- **Fail-Closed:** If `pin_enabled = true` but `pin_hash IS NULL`, fails closed with `403 PIN_CONFIGURATION_ERROR`.
- **Session Lifecycle:**
  - On success, issues a signed JWT with 12-hour expiration scoped strictly to `eventId`.
  - Computes SHA-256 hash of token and records in PostgreSQL `guest_sessions` table.
  - Sets HttpOnly, Secure (production), `SameSite=Lax` cookie `guest_session_<eventId>`.
- **Request:**
  ```json
  {
    "pin": "004271"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "success": true,
      "guestToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresInSeconds": 43200,
      "eventId": "a0000000-0000-0000-0000-000000000001"
    }
  }
  ```

### 7.3 Guest Gallery Media & Folders (`GET /api/guest/gallery/:slug`)
- **Purpose:** Retrieves ceremony folders and ready photos for guest gallery browsing.
- **Authorization:**
  - If event has `pin_enabled = true`: Requires verified guest session cookie, `X-Guest-Token`, or photographer session. Missing authorization returns `401 EVENT_PIN_REQUIRED`.
  - If event has `pin_enabled = false`: Public access permitted for active events within visibility window.
- **Query Parameters:** `folderId` (`all`, `uncategorized`, or folder UUID).
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "folders": [
        {
          "id": "f0000000-0000-0000-0000-000000000001",
          "name": "Ceremony",
          "sort_order": 0,
          "photo_count": 45
        }
      ],
      "media": [
        {
          "id": "10000000-0000-0000-0000-000000000001",
          "event_id": "a0000000-0000-0000-0000-000000000001",
          "folder_id": "f0000000-0000-0000-0000-000000000001",
          "type": "photo",
          "filename": "ceremony_01.jpg",
          "original_name": "IMG_4901.CR3",
          "storage_key_preview": "events/.../previews/1000...webp",
          "storage_key_thumbnail": "events/.../thumbnails/1000...webp"
        }
      ],
      "totalCount": 45
    }
  }
  ```

### 7.4 Clear Guest Session (`POST /api/guest/session/clear/:eventId`)
- **Purpose:** Explicit guest exit. Clears session cookie and deletes session record from `guest_sessions` table.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "message": "Guest session cleared successfully"
    }
  }
  ```

### 7.5 Guest Individual Media Download (`GET /api/guest/gallery/:slug/download/:mediaId`)
- **Purpose:** Issues an authorized, short-lived (15-minute) presigned Cloudflare R2 download URL for a high-resolution photo or original video.
- **Query Parameters:**
  - `representation`: Optional `'original'` (default) or `'preview'`.
  - `redirect`: Optional `'true'` | `'false'`. If `'true'`, returns `302 Found` redirecting directly to the presigned R2 download URL.
- **Authorization:** Enforces 10-point policy (`allow_downloads = true`, `visibility = 'public'`, `status = 'active'`, `public_until > NOW()`, valid PIN/session if enabled, media belongs to event, `media.status = 'ready'`).
- **Response (200 OK without redirect):**
  ```json
  {
    "success": true,
    "data": {
      "downloadUrl": "https://<r2-bucket>.r2.cloudflarestorage.com/events/.../originals/...?X-Amz-Signature=...",
      "filename": "ceremony_01.jpg",
      "contentType": "image/jpeg",
      "sizeBytes": 12582912,
      "expiresInSeconds": 900
    }
  }
  ```
- **Errors:**
  - `403 DOWNLOADS_DISABLED`: Downloads are disabled for this event.
  - `403 FORBIDDEN`: Event is private or session invalid.
  - `410 GALLERY_EXPIRED`: Gallery public access window has expired.
  - `404 MEDIA_NOT_FOUND`: Media not found or does not belong to this event.
  - `409 MEDIA_NOT_READY`: Media is still processing or has failed.

### 7.6 Guest Bulk ZIP Download Request (`POST /api/guest/gallery/:slug/download-zip`)
- **Purpose:** Initiates an asynchronous bulk ZIP archive generation job for selected photographs and videos.
- **Authorization:** Full 10-point policy. Validates every requested media ID against event ownership.
- **Request:**
  ```json
  {
    "mediaIds": [
      "10000000-0000-0000-0000-000000000001",
      "10000000-0000-0000-0000-000000000002"
    ]
  }
  ```
- **Limits:** 1 to 500 items (`MAX_BULK_DOWNLOAD_ITEMS = 500`).
- **Response (202 Accepted):**
  ```json
  {
    "success": true,
    "data": {
      "jobId": "d0000000-0000-0000-0000-000000000001",
      "status": "queued",
      "totalItems": 2,
      "message": "Bulk download archive generation queued"
    }
  }
  ```
- **Errors:** `400 NO_MEDIA_SELECTED`, `400 DOWNLOAD_LIMIT_EXCEEDED`, `403 DOWNLOADS_DISABLED`, `410 GALLERY_EXPIRED`.

### 7.7 Guest Bulk Download Job Status (`GET /api/guest/gallery/:slug/download-jobs/:jobId`)
- **Purpose:** Polls real-time progress and completion status of a bulk ZIP generation job.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "d0000000-0000-0000-0000-000000000001",
      "status": "completed",
      "progress": 100,
      "totalItems": 2,
      "processedItems": 2,
      "archiveSizeBytes": 24903680,
      "downloadUrl": "https://.../events/.../exports/d000....zip?...",
      "expiresAt": "2026-10-11T12:00:00.000Z",
      "errorMessage": null
    }
  }
  ```
- **Status Enum:** `'queued'` | `'processing'` | `'completed'` | `'failed'` | `'expired'`.

### 7.8 Guest Bulk Download Archive Retrieval (`GET /api/guest/gallery/:slug/download-jobs/:jobId/download`)
- **Purpose:** Reauthorizes access and delivers the completed ZIP archive.
- **Response:** `302 Found` redirecting directly to the signed R2 export URL, or `200 OK` with JSON download details.
- **Errors:** `400 ARCHIVE_NOT_READY`, `410 ARCHIVE_EXPIRED`, `403 DOWNLOADS_DISABLED`.

---

## 8. Direct Download API Endpoints (`/api/...`)
Direct API aliases mirroring guest endpoints for API consumers:
- `GET /api/media/download/:mediaId` (Query: `?representation=original|preview&redirect=true`)
- `POST /api/media/download-zip/:eventId` (Body: `{ "mediaIds": [...] }`)
- `GET /api/download-jobs/:jobId`
- `GET /api/download-jobs/:jobId/download`

---

## 9. Watermark System API Endpoints (Phase 22)

### 9.1 Event Watermark Configuration (`PUT /api/events/:id` | `PATCH /api/events/:id`)
- **Authorization:** Authenticated single photographer owner (`studio_session` cookie or Bearer token).
- **Request Body Fields:**
  ```json
  {
    "watermark_enabled": true,
    "watermark_text": "STUDIO LUMINA EDITORIAL",
    "watermark_opacity": 0.50,
    "watermark_size": "medium",
    "watermark_position": "bottom-right",
    "watermark_color": "white"
  }
  ```
- **Validation Rules:**
  - `watermark_text`: Optional string, 1 to 100 characters. Sanitized safely against XML/SVG injections.
  - `watermark_opacity`: Optional number strictly bounded to `0.05` to `1.00`.
  - `watermark_size`: Optional enum (`'small'` | `'medium'` | `'large'`).
  - `watermark_position`: Optional enum (`'bottom-right'` | `'bottom-center'` | `'center'`).
  - `watermark_color`: Optional enum (`'white'` | `'black'`).
- **Versioning Behavior:**
  - If any watermark attribute is altered, `events.watermark_version` is atomically incremented by 1.
  - Asynchronous background jobs are scheduled across all eligible photos in the event to regenerate derivatives under the new version.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "event": {
        "id": "uuid-v4",
        "watermark_enabled": true,
        "watermark_text": "STUDIO LUMINA EDITORIAL",
        "watermark_opacity": 0.50,
        "watermark_size": "medium",
        "watermark_position": "bottom-right",
        "watermark_color": "white",
        "watermark_version": 2
      }
    }
  }
  ```

### 9.2 Trigger Watermark Reprocessing (`POST /api/events/:id/watermark/reprocess`)
- **Authorization:** Authenticated single photographer owner.
- **Purpose:** On-demand endpoint to dispatch background jobs reconciling all event photos to the current `watermark_version`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "enqueuedCount": 24,
      "version": 2
    }
  }
  ```

### 9.3 Get Watermark Reprocessing Status (`GET /api/events/:id/watermark/status`)
- **Authorization:** Authenticated single photographer owner.
- **Purpose:** Inspects real-time derivative synchronization progress across all event photos.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "eventId": "uuid-v4",
      "watermarkVersion": 2,
      "totalPhotos": 24,
      "syncedPhotos": 24,
      "pendingPhotos": 0,
      "inSync": true
    }
  }
  ```

---

## 10. Face Indexing & Reusable Face Search Engine APIs

### 10.1 AI Service & Dependency Readiness Probe (`GET /ready` | `GET /api/ready`)
- **Authorization:** Public / Infrastructure probe.
- **Purpose:** Confirms that the Python AI microservice is reachable, ONNX models (YuNet and SFace) are loaded and warm in memory, and the system is ready for zero-latency inference.
- **Response (200 OK):**
  ```json
  {
    "status": "ready",
    "services": {
      "ai": {
        "status": "ready",
        "detector": "YuNet (face_detection_yunet_2023mar.onnx)",
        "recognizer": "SFace (face_recognition_sface_2021dec.onnx)",
        "embedding_dim": 128,
        "detector_license": "MIT / Apache-2.0",
        "recognizer_license": "Apache-2.0 / BSD-3-Clause",
        "commercial_use_permitted": true
      }
    },
    "timestamp": "2026-10-10T07:00:00.000Z"
  }
  ```

### 10.2 Enqueue Authorized Photo Indexing (`POST /internal/index-photo` | `POST /api/internal/index-photo`)
- **Authorization:** Authenticated photographer owner OR internal service key (`X-Internal-Service-Key` matching `INTERNAL_SERVICE_KEY`).
- **Purpose:** Enqueues an asynchronous face detection and 128-D embedding extraction job for a confirmed photo without blocking client responses.
- **Request Body:**
  ```json
  {
    "photoId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "eventId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"
  }
  ```
- **Validation Rules:**
  - `photoId`: Valid UUID string.
  - `eventId`: Valid UUID string.
  - Must belong to the authenticated photographer or verified event container.
- **Response (202 Accepted):**
  ```json
  {
    "success": true,
    "data": {
      "jobId": "idx-9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "photoId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "eventId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "status": "queued"
    }
  }
  ```

### 10.3 Inspect Indexing Job Status (`GET /internal/index-jobs/:jobId` | `GET /api/internal/index-jobs/:jobId`)
- **Authorization:** Authenticated photographer owner OR internal service key.
- **Purpose:** Inspects the current state of an indexing background job.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "jobId": "idx-9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "state": "completed",
      "progress": 100,
      "failedReason": null,
      "timestamp": 1775630400000
    }
  }
  ```

### 10.4 Retry Failed Indexing Job (`POST /internal/index-jobs/:jobId/retry` | `POST /api/internal/index-jobs/:jobId/retry`)
- **Authorization:** Authenticated photographer owner OR internal service key.
- **Purpose:** Retries a failed or stalled indexing job with idempotency guarantees.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "jobId": "idx-9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "status": "retried"
    }
  }
  ```

### 10.5 Guest Face Search via Ephemeral Selfie (`POST /guest/events/:eventId/face-search` | `POST /api/guest/face-search/:slug`)
- **Authorization:** Guest gallery access (subject to public visibility, 30-day expiry, and PIN verification if enabled).
- **Rate Limiting:** Enforced via `faceSearchRateLimiter` (max 10 requests per minute per IP).
- **Request Body:** `multipart/form-data` with:
  - `selfie`: Binary image file (JPEG, PNG, WebP; max 10 MB; max 25 Megapixels).
  - Optional `threshold`: Number between 0.30 and 0.90 (default 0.62 similarity / 0.38 cosine distance).
  - Optional `limit`: Number between 1 and 100 (default 50).
- **Behavior:**
  1. Validates event existence, active status, public visibility, and expiry.
  2. For PIN-protected events, validates ephemeral guest session token.
  3. Ephemeral RAM decoding of selfie; passes image to Python AI microservice.
  4. Detects faces; enforces the **Exactly-One-Face Rule** (rejects 0 faces or 2+ faces with descriptive error codes).
  5. Computes unit-normalized 128-D SFace embedding.
  6. Immediately discards and garbage collects selfie image from RAM.
  7. Executes pgvector similarity query strictly scoped to `event_id`:
     ```sql
     SELECT m.id, m.storage_key_thumbnail, 1 - (fe.embedding <=> $1::vector) AS similarity
     FROM face_embeddings fe
     JOIN media m ON m.id = fe.photo_id
     WHERE fe.event_id = $2 AND m.event_id = $2 AND m.status = 'ready'
       AND (fe.embedding <=> $1::vector) < $threshold
     GROUP BY m.id
     ORDER BY MIN(fe.embedding <=> $1::vector) ASC
     LIMIT $limit;
     ```
  8. Returns authorized photo IDs and thumbnails.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "eventId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "matchesCount": 4,
      "results": [
        {
          "photoId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          "thumbnailUrl": "https://cdn.example.com/events/1a2b3c4d.../thumbnails/9b1deb4d....webp",
          "similarity": 0.842
        }
      ]
    }
  }
  ```
- **Error Codes:**
  - `400 BAD_REQUEST`: No selfie file provided or corrupt image.
  - `422 NO_FACES_DETECTED`: Selfie does not contain a detectable face.
  - `422 MULTIPLE_FACES_DETECTED`: Query selfie contains multiple faces (user instructed to upload a single-face photo).
  - `429 RATE_LIMITED`: Rate limit exceeded.






