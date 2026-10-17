# OPERATIONAL GUIDE & INFRASTRUCTURE MANUAL

**Document Version:** 1.0.0 (Phase 21 Implementation)  
**System Classification:** Single-Tenant Professional Photography & Biometric Platform  
**Target Environment:** Node.js 20+ / PostgreSQL 16 / Redis 7+ / Cloudflare R2  

---

## 1. Background Queue Architecture & Worker Pools

The background job processing infrastructure uses **BullMQ** backed by **Redis** (`apps/api/src/services/queue/`). Workloads are strictly partitioned across isolated queues to guarantee that long-running operations (such as bulk ZIP archive generation or 4K video transcoding) never starve real-time guest face searches or image indexing.

### 1.1 Queue Inventory & Concurrency Limits

| Queue Name | Worker Concurrency | Max Attempts | Backoff Strategy | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `photo-processing` | 4 workers | 3 | Exponential (2s, 4s, 8s) | Sharp WebP thumbnail (480px) & preview (1920px) generation. |
| `video-processing` | 1 worker | 2 | Exponential (5s, 10s) | FFprobe metadata probing, WebP poster extraction, 1080p MP4 transcoding. |
| `zip-generation` | 2 workers | 2 | Exponential (3s, 6s) | Streaming bulk media download ZIP packaging and Cloudflare R2 export upload. |
| `gallery-expiry` | 1 worker | 3 | Fixed (5s) | Proactive event expiry transition when 30-day public window closes. |

---

## 2. Bulk ZIP Generation Pipeline (Phase 21)

### 2.1 Operational Flow
1. **Request Intake:** Client submits `POST /api/guest/gallery/:slug/download-zip` with up to 500 media IDs.
2. **Database Job Registration:** An atomic record is inserted into `download_jobs` (`status = 'queued'`).
3. **Queue Handoff:** Job is dispatched to BullMQ `zip-generation` queue with `{ jobId, eventId, mediaIds, representation }`.
4. **Processing Worker:**
   - Marks job `processing` in database.
   - Creates a temporary local disk scratch file (`/scratch/downloads/<jobId>.zip`).
   - Streams media objects sequentially from Cloudflare R2 using S3 `GetObjectCommand`.
   - Pipes streams into `archiver` (`ZipArchive` v8) with standard compression (`zlib level 6`).
   - Streams the assembled archive directly to Cloudflare R2 at `events/{eventId}/exports/{jobId}.zip`.
   - Records final archive byte size and sets `expires_at = NOW() + INTERVAL '24 hours'`.
   - Removes local scratch file immediately.
5. **Client Polling & Retrieval:** Client polls job status every 2 seconds. When `completed`, client retrieves a short-lived (15-minute) presigned R2 GET URL.

### 2.2 Resource Safety & Guardrails
- **Selection Ceiling:** Maximum 500 items per bulk request (`MAX_BULK_DOWNLOAD_ITEMS = 500`). Requests exceeding 500 are rejected immediately with `HTTP 400 DOWNLOAD_LIMIT_EXCEEDED`.
- **Heap Memory Protection:** Individual files are streamed directly into the archiver rather than loaded simultaneously into V8 heap RAM. Peak memory footprint remains bounded even for 500-item archives.
- **Worker Concurrency Limit:** Bounded to 2 concurrent ZIP generation workers to avoid saturated network I/O or disk scratch contention.

---

## 3. Temporary Archive Retention & Bounded Cleanup Sweeper

### 3.1 Retention Policy
- All generated bulk ZIP archives have a **24-hour retention period** from the moment of creation (`expires_at = NOW() + INTERVAL '24 hours'`).
- Archives older than 24 hours become unavailable to download (`HTTP 410 ARCHIVE_EXPIRED`).

### 3.2 Automated Cleanup Sweeper
- **Schedule:** Runs every 60 minutes via `setInterval` in `workerManager.ts`.
- **Bounded Query:** Queries PostgreSQL `download_jobs` using index `idx_download_jobs_cleanup` for overdue archives:
  ```sql
  SELECT id, event_id, storage_key
  FROM download_jobs
  WHERE expires_at <= NOW() AND status != 'expired'
  ORDER BY expires_at ASC
  LIMIT 50;
  ```
- **Storage Deletion:** Calls `storageAdapter.deleteObject(job.storage_key)`.
- **Database Reconciliation:** Updates job status to `'expired'`.
- **Zero Media Deletion Invariant:** The cleanup sweeper exclusively deletes objects under `events/{eventId}/exports/`. Master photographs, master videos, and WebP derivatives are structurally isolated and can never be deleted by the cleanup worker.

---

## 4. Monitoring & Diagnostics

### 4.1 Subsystem Health Endpoint (`/health`)
The unified `/health` route inspects all system dependencies:
- **Database:** PostgreSQL connection pool and query execution.
- **Redis & Queues:** BullMQ Redis connection and active worker counts.
- **Cloudflare R2:** S3 bucket reachability and credentials.
- **AI Daemon:** Python FastAPI face detection daemon reachability.

### 4.2 Logging Standards
- All logs use structured JSON formatting including `requestId` and `jobId`.
- **Strictly Redacted:** R2 secret keys, database connection credentials, signed URL tokens, guest JWTs, and face embeddings are NEVER output to logs.
