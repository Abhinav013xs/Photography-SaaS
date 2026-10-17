# DATABASE & VECTOR STORAGE ARCHITECTURE (PHASE 3)

**Document Status:** Production Database Architecture & Migration Specification (Implemented & Validated)  
**Target Engine:** PostgreSQL 16+ with `pgvector` Extension  
**Implementation Phase:** Completed in **Phase 3**  
**Core Invariants:** Single photographer ownership, mathematical event isolation, safe folder deletion (`ON DELETE SET NULL`), sub-15ms HNSW vector similarity queries, zero plaintext credentials/biometrics.

---

## 1. Architectural Overview & Engine Selection

The platform coordinates high-throughput relational metadata (photographer profile, client events, ceremony folders, media asset catalogs, asynchronous job queues) with high-density biometric vector indexing (thousands of 128-dimensional L2-normalized face embeddings).

### 1.1 Why PostgreSQL 16+ with `pgvector`?
- **Unified Relational + Vector Storage:** Housing relational metadata and face embeddings in a single database eliminates distributed synchronization lag, prevents dangling vector references, and allows atomic SQL transactions across media records and embeddings.
- **HNSW Index Acceleration:** PostgreSQL's `pgvector` extension provides Hierarchical Navigable Small World (HNSW) graph indexing, delivering sub-15ms approximate nearest neighbor (ANN) similarity search across millions of vectors.
- **Mathematical Event Isolation:** Vector searches are directly filtered at the query layer via `WHERE event_id = :current_event_id`, ensuring mathematically impossible cross-event leakage.

---

## 2. Entity-Relationship Diagram

```mermaid
erDiagram
    PHOTOGRAPHER ||--o{ EVENTS : "owns (1:N)"
    EVENTS ||--o{ FOLDERS : "contains (1:N)"
    EVENTS ||--o{ MEDIA : "contains (1:N)"
    FOLDERS ||--o{ MEDIA : "categorizes (1:N nullable)"
    MEDIA ||--o{ FACE_EMBEDDINGS : "generates (1:N)"
    EVENTS ||--o{ FACE_EMBEDDINGS : "isolates (1:N direct FK)"
    EVENTS ||--o{ PROCESSING_JOBS : "tracks (1:N)"
    MEDIA ||--o{ PROCESSING_JOBS : "targets (1:1 nullable)"
    EVENTS ||--o{ DOWNLOAD_JOBS : "tracks (1:N)"
    EVENTS ||--o{ GUEST_SESSIONS : "authorizes (1:N)"
    EVENTS ||--o{ STORAGE_USAGE : "measures (1:1)"

    PHOTOGRAPHER {
        int id PK
        string email UK
        string password_hash
        string business_name
        string tagline
        text bio
        string website
        string instagram
        string avatar_url
        timestamp created_at
        timestamp updated_at
    }

    EVENTS {
        uuid id PK
        int owner_id FK
        string slug UK
        string name
        string client_name
        string client_email
        date event_date
        string location
        text description
        uuid cover_photo_id FK
        string status "active | archived | deleting"
        string visibility "public | private"
        timestamp public_start
        timestamp public_until
        boolean pin_enabled
        string pin_hash
        boolean allow_downloads
        boolean watermark_enabled
        string watermark_text
        boolean face_search_enabled
        timestamp created_at
        timestamp updated_at
    }

    FOLDERS {
        uuid id PK
        uuid event_id FK
        string name
        int sort_order
        timestamp created_at
        timestamp updated_at
    }

    MEDIA {
        uuid id PK
        uuid event_id FK
        uuid folder_id FK "nullable for safe deletion"
        string type "photo | video"
        string filename
        string original_name
        string mime_type
        bigint file_size
        int width
        int height
        string storage_key_original
        string storage_key_preview
        string storage_key_thumbnail
        bigint thumbnail_size "Phase 11"
        bigint preview_size "Phase 11"
        text processing_error "Phase 11"
        timestamp processed_at "Phase 11"
        real video_duration
        string checksum
        string camera_make
        string camera_model
        string focal_length
        string aperture
        string shutter_speed
        int iso
        timestamp date_taken
        string status "uploaded | processing | ready | failed"
        int faces_detected
        timestamp created_at
        timestamp updated_at
    }

    FACE_EMBEDDINGS {
        uuid id PK
        uuid event_id FK "strict isolation"
        uuid photo_id FK
        int face_index
        real box_x
        real box_y
        real box_w
        real box_h
        real confidence
        string model_name
        string model_version
        vector_128 embedding "L2 normalized"
        timestamp created_at
    }

    PROCESSING_JOBS {
        uuid id PK
        uuid event_id FK
        uuid media_id FK
        string type "photo_processing | face_indexing | video_processing | zip_generation"
        string status "pending | processing | completed | failed"
        int progress
        int total_items
        int processed_items
        text error_message
        timestamp created_at
        timestamp updated_at
    }

    DOWNLOAD_JOBS {
        uuid id PK
        uuid event_id FK
        string status "pending | processing | completed | failed"
        string storage_key
        bigint file_size
        timestamp expires_at
        timestamp created_at
        timestamp completed_at
    }

    GUEST_SESSIONS {
        uuid id PK
        uuid event_id FK
        string token_hash UK
        string ip_address_hash
        timestamp expires_at
        timestamp created_at
        timestamp last_used_at
    }

    STORAGE_USAGE {
        uuid id PK
        uuid event_id FK UK
        bigint original_bytes
        bigint preview_bytes
        bigint thumbnail_bytes
        bigint video_bytes
        bigint total_bytes
        timestamp last_calculated_at
    }
```

---

## 3. Clear State & Lifecycle Separation

To eliminate race conditions and ambiguous domain states, the architecture strictly decouples three independent concepts:

1. **Event Operational Status (`events.status`):**
   - `draft`: Initial unlisted stage during event preparation. Safe default upon creation.
   - `active`: Operational event, accessible by photographer and potentially by guests when published.
   - `archived`: Inactive historical event. Hidden from primary dashboard views; completely inaccessible to guests. All media and data preserved.
   - `deleting`: Locked state during two-phase permanent deletion. Blocks all uploads, guest queries, and queues while Cloudflare R2 files are purged.
2. **Gallery Visibility (`events.visibility`):**
   - `public`: Accessible via public shareable slug or QR code, bounded by `public_until`.
   - `private`: Default safe state upon creation. Accessible exclusively by the authenticated photographer. Guest access is blocked.
3. **Media / Processing Status (`media.status`, `processing_jobs.status`, `download_jobs.status`):**
   - `uploaded` / `pending`: Master file written to R2; awaiting worker pickup.
   - `processing`: Derivatives or AI embeddings currently being computed.
   - `ready` / `completed`: Thumbnails, previews, and face vectors successfully generated.
   - `failed`: Processing encountered an error; original preserved for diagnostics.

---

## 4. Detailed Entity Specifications

### 4.1 `photographer`
- **Purpose:** Represents the sole owner and administrator of the entire platform.
- **Fields:**
  - `id`: Primary key (serial integer). Exactly one record exists in production.
  - `email`: Administrative login email (unique, validated format).
  - `password_hash`: Salted bcrypt (cost factor 10+) hash. Plaintext password is never stored.
  - `business_name`: Studio display name (e.g., "Studio Lumina").
  - `tagline`: Editorial tagline for gallery headers.
  - `bio`: Photographer biography.
  - `website`: Portfolio URL.
  - `instagram`: Social link.
  - `avatar_url`: Optional avatar profile URL.
  - `created_at` / `updated_at`: Audit timestamps.
- **Ownership:** Top-level root entity.

### 4.2 `events`
- **Purpose:** Core container for a client gallery.
- **Fields:**
  - `id`: UUID primary key.
  - `owner_id`: Foreign key referencing `photographer.id` (`ON DELETE RESTRICT`).
  - `slug`: Public URL-safe unique token (e.g., `rahul-priya-wedding-4a9f`).
  - `name`: Display title (e.g., "Rahul & Priya Wedding").
  - `client_name`: Client name for personalized greetings.
  - `client_email`: Client notification address.
  - `event_date`: Date of the wedding/ceremony.
  - `location`: Venue location string.
  - `description`: Editorial summary.
  - `cover_photo_id`: Nullable UUID referencing `media.id` for gallery hero banner.
  - `status`: Lifecycle state (`active`, `archived`, `deleting`).
  - `visibility`: Access gate (`public` | `private`). Strictly constrained via SQL `CHECK (visibility IN ('public', 'private'))` with default `'private'`. Indexed via `idx_events_visibility_public_until` for high-throughput gate checks and future expiry queries. Orthogonal to `status` and `pin_enabled`.
  - `public_start`: Start of public viewing window.
  - `public_until`: End of public viewing window (strictly capped at 30 days from start in application layer).
  - `public_duration_days`: Configurable public availability duration in whole days (integer 1..30, default 30), constrained via `CHECK (public_duration_days >= 1 AND public_duration_days <= 30)`.
  - `expired_at`: Nullable `TIMESTAMPTZ` audit timestamp recorded when the gallery is transitioned to private upon expiry.
  - `pin_enabled`: Boolean flag toggling PIN protection.
  - `pin_hash`: Salted bcrypt hash of 4-8 digit numeric PIN. Null if disabled.
  - `allow_downloads`: Boolean toggle permitting guest downloads.
  - `watermark_enabled`: Boolean toggle applying typographical studio watermark on previews.
  - `watermark_text`: Custom watermark string (defaults to studio business name).
  - `face_search_enabled`: Boolean toggle enabling guest "Find My Photos".
  - `created_at` / `updated_at`: Audit timestamps.

### 4.3 `folders`
- **Purpose:** Ceremony or category breakdown within an event (e.g., *Haldi*, *Mehndi*, *Wedding Ceremony*, *Reception*). Flat hierarchy per event.
- **Fields:**
  - `id`: UUID primary key.
  - `event_id`: Foreign key referencing `events.id` (`ON DELETE CASCADE`).
  - `name`: Folder display name (1-100 characters).
  - `sort_order`: Integer sorting index for UI presentation (default 0).
  - `created_at` / `updated_at`: Audit timestamps.
- **Constraints & Indexes:**
  - `uq_folders_event_name`: `UNIQUE(event_id, name)` prevents duplicate folder names within the same event container while allowing identical folder names across separate events.
  - `idx_folders_event_id`: Index on `(event_id)` for high-performance folder retrieval during event gallery rendering.
- **Critical Safe Deletion Rule & Multi-Layer Defense:**
  - **Relational Level:** `media.folder_id` references `folders.id` with **`ON DELETE SET NULL`**.
  - **Application Service Level:** `folderService.deleteFolder` executes inside an explicit database transaction (`withTransaction`):
    1. Executes `UPDATE media SET folder_id = NULL, updated_at = NOW() WHERE event_id = $1 AND folder_id = $2;`
    2. Executes `DELETE FROM folders WHERE id = $1 AND event_id = $2;`
    3. Commits transaction or cleanly rolls back on any error.
  - **Inviolable Guarantee:** **Photos and videos are NEVER deleted when a folder is deleted.** Media remains safely preserved in the event container under the unassigned/root pool.


### 4.4 `media` (Photos & Videos)
- **Purpose:** Catalog of visual assets belonging to an event.
- **Fields:**
  - `id`: UUID primary key.
  - `event_id`: Foreign key referencing `events.id` (`ON DELETE CASCADE`).
  - `folder_id`: Nullable foreign key referencing `folders.id` (`ON DELETE SET NULL`).
  - `type`: Asset discriminator (`photo`, `video`).
  - `filename`: Unique stored file identifier (UUID + extension).
  - `original_name`: Original client filename (e.g., `DSC_0042.jpg`).
  - `mime_type`: Validated MIME format (`image/jpeg`, `image/png`, `image/webp`, `video/mp4`).
  - `file_size`: Master file byte size (bigint, `CHECK (file_size > 0)`).
  - `width` / `height`: Master pixel dimensions.
  - `storage_key_original`: Deterministic R2 key (`events/{eventId}/originals/{filename}`).
  - `storage_key_preview`: WebP 1600px preview key (`events/{eventId}/previews/{filename}.webp`).
  - `storage_key_thumbnail`: WebP 400px thumbnail key (`events/{eventId}/thumbnails/{filename}.webp`).
  - `video_duration`: Floating point duration in seconds (for video assets).
  - `checksum`: SHA-256 hash for file integrity.
  - `camera_make`, `camera_model`, `focal_length`, `aperture`, `shutter_speed`, `iso`, `date_taken`: Parsed EXIF camera parameters.
  - `status`: Processing state (`uploaded`, `processing`, `ready`, `failed`).
  - `faces_detected`: Count of indexed human faces in this photo.
  - `created_at` / `updated_at`: Asset registration timestamps.
- **R2 Storage Key Hierarchy (Phase 8 Standard):**
  - All media paths adhere to `events/{eventId}/{category}/{filename}` where `category` is one of `originals`, `previews`, `thumbnails`, `videos`, `exports`.
  - Keys are generated via server-controlled helper `buildStorageKey(eventId, category, filename)` with strict UUID and path-traversal sanitization.
- **PostgreSQL & Cloudflare R2 Consistency Model:**
  - SQL transactions (`BEGIN...COMMIT`) cannot atomically encompass external Cloudflare R2 operations.
  - The application follows a **metadata-first / two-phase lifecycle** to eliminate orphaned data:
    1. Upload: Client uploads binary directly to R2 via temporary presigned PUT URL; backend creates `media` record only after S3 upload confirmation via `storageAdapter.headObject` (Phase 10).
    2. Deletion: Destructive event/media deletion follows a two-phase soft-lock protocol (`status = 'deleting'`), purges R2 objects, and commits database cascading deletes (Phase 24).
    3. Missing Object Resilience: `StorageAdapter.headObject` and `objectExists` explicitly handle missing R2 objects as non-fatal, typed conditions (`null` metadata, `StorageObjectNotFoundError`) rather than unhandled crashes.
- **Phase 10 Upload Lifecycle & Idempotency:**
  - Original media records enter the database with `status = 'uploaded'` upon successful confirmation (`POST /api/events/:eventId/media/confirm-upload`).
  - Idempotent upsert (`ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`) prevents duplicate rows or storage calculation corruption if client retries confirmation after network timeouts.
  - Live storage aggregation filters (`status != 'failed'`) to ensure abandoned or failed uploads never inflate application-tracked storage metrics.

### 4.5 `face_embeddings`
- **Purpose:** Biometric vector representation of a detected human face.
- **Fields:**
  - `id`: UUID primary key.
  - `event_id`: Direct foreign key referencing `events.id` (`ON DELETE CASCADE`). **MANDATORY for strict event-scoped querying.**
  - `photo_id`: Foreign key referencing `media.id` (`ON DELETE CASCADE`).
  - `face_index`: Index of this face within the photo (0-indexed).
  - `box_x`, `box_y`, `box_w`, `box_h`: Normalized bounding box coordinates (0.0 to 1.0).
  - `confidence`: YuNet detection confidence score (0.0 to 1.0).
  - `model_name`: Detection model identifier (default `'SFace'`).
  - `model_version`: Detection model version (default `'v1'`).
  - `embedding`: 128-dimensional L2-normalized dense float vector (`vector(128)`).
  - `created_at`: Extraction timestamp.
- **Indexes:**
  - `idx_face_embeddings_event_id`: B-Tree on `(event_id)` for event boundary filtering.
  - `idx_face_embeddings_photo_id`: B-Tree on `(photo_id)` for fast lookups and cascade operations.
  - `idx_face_embeddings_hnsw`: HNSW index on `embedding vector_cosine_ops` for fast nearest-neighbor search.
- **Phase 16 Event-Scoped Vector Search & Group Photo Deduplication Query:**
  ```sql
  SELECT
    m.id AS media_id,
    m.filename,
    m.width,
    m.height,
    m.storage_key_preview,
    m.storage_key_thumbnail,
    m.created_at,
    MIN(fe.embedding <=> $1::vector) AS min_distance
  FROM face_embeddings fe
  JOIN media m ON m.id = fe.photo_id
  WHERE fe.event_id = $2
    AND fe.model_name = 'SFace'
    AND fe.model_version = 'v1'
    AND m.event_id = $2
    AND m.status = 'ready'
    AND (fe.embedding <=> $1::vector) <= $3
  GROUP BY m.id, m.filename, m.width, m.height, m.storage_key_preview, m.storage_key_thumbnail, m.created_at
  ORDER BY min_distance ASC
  LIMIT $4 OFFSET $5;
  ```
  - Enforces `fe.event_id = $2 AND m.event_id = $2` to guarantee zero cross-event data leakage.
  - `GROUP BY m.id` with `MIN(fe.embedding <=> $1::vector)` prevents duplicate rows for group photos containing multiple matching faces.


### 4.6 `processing_jobs`
- **Purpose:** Tracks asynchronous background worker operations and dashboard progress meters.
- **Fields:**
  - `id`: UUID primary key.
  - `event_id`: Foreign key referencing `events.id` (`ON DELETE CASCADE`).
  - `media_id`: Optional foreign key referencing `media.id` (`ON DELETE CASCADE`).
  - `type`: Job category (`photo_processing`, `face_indexing`, `video_processing`, `zip_generation`).
  - `status`: Execution state (`pending`, `processing`, `completed`, `failed`).
  - `progress`: Percentage completed (0 to 100).
  - `total_items`: Total items in batch.
  - `processed_items`: Items completed so far.
  - `error_message`: Sanitized error diagnosis if failed.
  - `created_at` / `updated_at`: Audit timestamps.

### 4.7 `download_jobs`
- **Purpose:** Persistent bulk ZIP export generation and Cloudflare R2 download tracking.
- **Fields:**
  - `id`: UUID primary key.
  - `event_id`: Foreign key referencing `events.id` (`ON DELETE CASCADE`).
  - `status`: Execution state (`pending`, `processing`, `completed`, `failed`).
  - `storage_key`: Deterministic R2 key for temporary ZIP export.
  - `file_size`: Final archive byte size.
  - `expires_at`: Download link expiry timestamp (24 hours).
  - `created_at` / `completed_at`: Timestamps.

### 4.8 `guest_sessions` (Phase 18)
- **Purpose:** Ephemeral authorization sessions for guests accessing PIN-protected galleries. Guests have no accounts; sessions are event-scoped, temporary (12h TTL), and validated via cryptographic token hashes.
- **Fields:**
  - `id`: UUID primary key.
  - `event_id`: Foreign key referencing `events.id` (`ON DELETE CASCADE`).
  - `token_hash`: SHA-256 hash (64 hex characters) of the issued ephemeral guest JWT. The raw JWT is never stored.
  - `ip_address_hash`: Salted SHA-256 hash of guest IP (for brute-force and rate-limit tracking, preserving privacy).
  - `expires_at`: Expiration timestamp (`TIMESTAMPTZ`, default `NOW() + INTERVAL '12 hours'`).
  - `created_at` / `last_used_at`: Audit timestamps.
- **Indexes & Constraints:**
  - `idx_guest_sessions_event_id`: B-Tree on `(event_id)` for batch revocation when photographer updates or disables PIN.
  - `idx_guest_sessions_token_hash`: B-Tree on `(token_hash)` for O(1) session lookups during `verifyEventAccess` middleware checks.
  - `idx_guest_sessions_expires_at`: B-Tree on `(expires_at)` for periodic background cleanup of expired session records.
- **Revocation Rules:**
  - When the photographer updates an event's PIN or disables PIN protection (`pin_enabled = false`), all active sessions for that event are atomically revoked via `DELETE FROM guest_sessions WHERE event_id = $1`.
  - When a guest explicitly clears their session or an event is deleted, session records are immediately purged.

### 4.9 `storage_usage`
- **Purpose:** Aggregated byte tracking and breakdown for Cloudflare R2 reporting.
- **Fields:**
  - `id`: UUID primary key.
  - `event_id`: Unique foreign key referencing `events.id` (`ON DELETE CASCADE`).
  - `original_bytes`: Total byte sum of master originals.
  - `preview_bytes`: Total byte sum of WebP previews.
  - `thumbnail_bytes`: Total byte sum of WebP thumbnails.
  - `video_bytes`: Total byte sum of video masters.
  - `total_bytes`: Sum of all media assets for this event.
  - `last_calculated_at`: Timestamp of last incremental or reconciliation run.

---

## 5. Vector Search Strategy & HNSW Indexing

### 5.1 Vector Dimensions & Normalization
- **Vector Dimensions:** Exactly **128 dimensions** (produced by OpenCV SFace).
- **Normalization:** Vectors are strictly L2-normalized (`||v|| = 1.0`) during extraction in the Python AI microservice.
- **Distance Metric:** Cosine distance (`<=>` operator in `pgvector`).
- **Cosine Similarity Formula:** `similarity = 1 - (embedding <=> selfie_vector)`.

### 5.2 HNSW Index Configuration
```sql
CREATE INDEX idx_face_embeddings_hnsw 
ON face_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```
- `m = 16`: Number of bidirectional links per vector node in the HNSW graph (balances memory vs recall).
- `ef_construction = 64`: Size of the dynamic candidate list during graph construction (ensures high search quality).
- At query time: `SET hnsw.ef_search = 40;` to guarantee sub-15ms search across 50,000+ faces.

### 5.3 Mathematical Event-Scoped Query
Vector similarity queries **MUST NEVER** execute globally and filter in application code. The event constraint is evaluated at the database engine level:

```sql
SELECT 
    fe.photo_id,
    fe.face_index,
    fe.box_x, fe.box_y, fe.box_w, fe.box_h,
    1 - (fe.embedding <=> $selfie_embedding) AS similarity_score
FROM face_embeddings fe
WHERE fe.event_id = $current_event_id
  AND (fe.embedding <=> $selfie_embedding) < $cosine_threshold
ORDER BY fe.embedding <=> $selfie_embedding ASC
LIMIT 100;
```
- `$cosine_threshold`: Benchmark calibrated to `0.38` (corresponding to cosine similarity >= `0.62`).

---

## 6. Indexing Architecture & Query Patterns

| Query Pattern | Intended Index | Purpose |
| :--- | :--- | :--- |
| **Owner Events Lookup** | `INDEX idx_events_owner ON events(owner_id)` | Fast photographer event catalog loading |
| **Public Guest Slug Lookup** | `UNIQUE INDEX idx_events_slug ON events(slug)` | Instant sub-1ms event resolution |
| **Active/Archived Filtering** | `INDEX idx_events_status ON events(status)` | Dashboard event filtering |
| **Public Expiry Sweeper** | `INDEX idx_events_visibility_public_until ON events(visibility, public_until)` | High-speed 15-minute cron sweep |
| **Folder Event Listing** | `INDEX idx_folders_event_id ON folders(event_id)` | Quick folder tab rendering |
| **Folder Media Listing** | `INDEX idx_media_event_folder ON media(event_id, folder_id)` | Fast masonry grid folder switching |
| **Media Processing Queries** | `INDEX idx_media_event_status ON media(event_id, status)` | Worker queue pickup & batch monitoring |
| **Media Type & Status Queries** | `INDEX idx_media_event_type_status ON media(event_id, type, status)` | Fast filtering by media type (photo vs video) and status |
| **Event Face Scoping** | `INDEX idx_face_embeddings_event_id ON face_embeddings(event_id)` | Strict event filtering for vector queries |
| **Photo Face Lookup** | `INDEX idx_face_embeddings_photo_id ON face_embeddings(photo_id)` | Multi-face group photo resolution |
| **Vector Similarity Search** | `INDEX idx_face_embeddings_hnsw ON face_embeddings USING hnsw (...)` | Sub-15ms biometric similarity search |
| **Active Processing Jobs** | `INDEX idx_processing_jobs_event_status ON processing_jobs(event_id, status)` | Dashboard progress tracking |
| **Download Jobs by Event** | `INDEX idx_download_jobs_event_id ON download_jobs(event_id)` | Bulk ZIP download polling |
| **Guest Sessions by Token** | `INDEX idx_guest_sessions_token_hash ON guest_sessions(token_hash)` | Ephemeral token verification |
| **Overdue Public Events** | `INDEX idx_events_public_due ON events(public_until ASC) WHERE visibility = 'public' AND public_until IS NOT NULL` | Bounded batch reconciliation of overdue public galleries |

---

## 7. Foreign Key Cascade & Safe Deletion Rules

```
events (DELETE CASCADE)
  ├── folders (ON DELETE CASCADE)
  ├── media (ON DELETE CASCADE)
  │     ├── face_embeddings (ON DELETE CASCADE)
  │     └── processing_jobs (ON DELETE CASCADE)
  ├── processing_jobs (ON DELETE CASCADE)
  ├── download_jobs (ON DELETE CASCADE)
  ├── guest_sessions (ON DELETE CASCADE)
  └── storage_usage (ON DELETE CASCADE)

folders (DELETE)
  └── media.folder_id (ON DELETE SET NULL)  <-- SAFE FOLDER DELETION: Photos survive!
```

1. **Deleting an Event:** Permanently cascades to remove all associated folders, media, face embeddings, jobs, guest sessions, and storage records. (Preceded by Cloudflare R2 object deletion in the Two-Phase Soft-Lock protocol).
2. **Deleting a Folder:** Sets `media.folder_id = NULL`. Media records and their storage objects remain completely preserved in the event.

---

## 8. Migration Engine & CLI Commands

Migrations are tracked transactionally via the `schema_migrations` table:
```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Migration History
| Migration | Description | Status |
| :--- | :--- | :--- |
| `001_initial_schema.sql` | Baseline PostgreSQL schema, tables, foreign keys, triggers, and indexes. | Applied (Phase 3) |
| `002_event_lifecycle_and_defaults.sql` | Adds `'draft'` status, sets safe defaults (`status = 'draft'`, `visibility = 'private'`, `allow_downloads = FALSE`), and creates `idx_events_owner_status_created`. | Applied (Phase 6) |
| `003_media_derivatives.sql` | Adds `thumbnail_size`, `preview_size`, `processing_error`, and `processed_at` columns to `media`, plus `idx_media_status` and `idx_media_event_status`. | Applied (Phase 11) |
| `004_video_processing.sql` | Adds `video_codec` and `audio_codec` columns to `media`, plus `idx_media_event_type_status`. | Applied (Phase 12) |
| `005_guest_sessions.sql` | Creates `guest_sessions` table and indexes for ephemeral PIN-authorized guest tokens. | Applied (Phase 18) |
| `006_event_visibility.sql` | Adds `visibility` check constraint, sets safe defaults, and adds `idx_events_visibility_public_until`. | Applied (Phase 19) |
| `007_gallery_expiry.sql` | Adds `public_duration_days` (1..30), `expired_at`, check constraint `chk_events_public_duration_days`, and partial index `idx_events_public_due`. | Applied (Phase 20) |
| `008_download_jobs_enhancement.sql` | Adds `media_ids`, `requested_count`, `processed_count`, `progress`, `error_message`, `download_type` to `download_jobs`, and creates partial index `idx_download_jobs_cleanup`. | Applied (Phase 21) |
| `009_event_watermark_system.sql` | Adds `watermark_opacity`, `watermark_size`, `watermark_position`, `watermark_color`, `watermark_version` to `events`, and `watermark_applied`, `watermark_version`, `idx_media_event_watermark` to `media`. | Applied (Phase 22) |

---

## 9. Phase 21: Bulk Download Jobs Schema (`download_jobs`)

```sql
CREATE TABLE IF NOT EXISTS download_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed, expired
    media_ids UUID[] NULL,                         -- optional array of selected media item UUIDs
    requested_count INT NOT NULL DEFAULT 0,        -- total items requested
    processed_count INT NOT NULL DEFAULT 0,        -- items successfully packed into archive
    progress INT NOT NULL DEFAULT 0,               -- progress percentage (0-100)
    download_type VARCHAR(50) NOT NULL DEFAULT 'bulk_zip', -- bulk_zip, selection_zip
    storage_key VARCHAR(500) NULL,                 -- events/{eventId}/exports/{jobId}.zip
    file_size BIGINT NULL,                         -- total size of generated zip in bytes
    error_message TEXT NULL,                       -- diagnostics on job failure
    expires_at TIMESTAMPTZ NOT NULL,               -- 24 hours retention from creation
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for high-throughput bounded retention cleanup
CREATE INDEX IF NOT EXISTS idx_download_jobs_cleanup 
ON download_jobs (expires_at ASC) 
WHERE status = 'completed' OR storage_key IS NOT NULL;
```

---

## 10. Phase 22: Watermark System Schema (`009_event_watermark_system.sql`)

### 10.1 Event Watermark Columns & Constraints
```sql
ALTER TABLE events
ADD COLUMN IF NOT EXISTS watermark_opacity DECIMAL(3, 2) NOT NULL DEFAULT 0.40,
ADD COLUMN IF NOT EXISTS watermark_size VARCHAR(20) NOT NULL DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS watermark_position VARCHAR(20) NOT NULL DEFAULT 'bottom-right',
ADD COLUMN IF NOT EXISTS watermark_color VARCHAR(20) NOT NULL DEFAULT 'white',
ADD COLUMN IF NOT EXISTS watermark_version INTEGER NOT NULL DEFAULT 1;

-- Check constraints enforcing strict boundaries
ALTER TABLE events
ADD CONSTRAINT chk_events_watermark_opacity 
    CHECK (watermark_opacity >= 0.05 AND watermark_opacity <= 1.00),
ADD CONSTRAINT chk_events_watermark_size 
    CHECK (watermark_size IN ('small', 'medium', 'large')),
ADD CONSTRAINT chk_events_watermark_position 
    CHECK (watermark_position IN ('bottom-right', 'bottom-center', 'center')),
ADD CONSTRAINT chk_events_watermark_color 
    CHECK (watermark_color IN ('white', 'black')),
ADD CONSTRAINT chk_events_watermark_version 
    CHECK (watermark_version >= 1);
```

### 10.2 Media Derivative Tracking & Concurrency Index
```sql
ALTER TABLE media
ADD COLUMN IF NOT EXISTS watermark_applied BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS watermark_version INTEGER NOT NULL DEFAULT 0;

-- Composite index for fast synchronization status and worker idempotency lookups
CREATE INDEX IF NOT EXISTS idx_media_event_watermark 
ON media(event_id, watermark_version);
```




