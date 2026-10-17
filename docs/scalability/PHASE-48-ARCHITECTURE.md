# PHASE 48 — HIGH-CONCURRENCY ARCHITECTURE & DATA FLOW AUDIT

============================================================
STUDIO LUMINA — SYSTEM ARCHITECTURE SPECIFICATION
============================================================

This document establishes the end-to-end data flow mapping, component topology, resource boundaries, and capacity limits of the Studio Lumina Photography Platform as audited during **Phase 48: Large-Scale Load, Concurrency, Auto-Scaling, Queue Balancing & High-Traffic Optimization**.

---

## 1. END-TO-END DATA FLOW MAPPINGS

### 1.1 Guest Access & Face Search Workflow
```mermaid
sequenceDiagram
    autonumber
    actor Guest as Event Guest
    participant Frontend as Web Client (Vite / React)
    participant API as Express API Server
    participant DB as SQLite / PostgreSQL Database
    participant Queue as Processing Queue
    participant FaceWorker as Face Engine (YuNet + SFace)
    participant Storage as Cloudflare R2 / CDN

    Guest->>Frontend: Scans QR / Navigates to /gallery/:slug
    Frontend->>API: GET /api/guest/event/:slug
    API->>DB: Query event metadata & PIN requirement
    DB-->>API: Return event details
    API-->>Frontend: Render gallery header & lock status

    alt Gallery PIN Protected
        Guest->>Frontend: Submits PIN
        Frontend->>API: POST /api/guest/verify-pin/:slug
        API->>DB: Compare bcrypt PIN hash
        DB-->>API: PIN match verified
        API-->>Frontend: Return ephemeral guest JWT (scoped to eventId)
    end

    Guest->>Frontend: Initiates "Find My Photos" (Captures Selfie)
    Frontend->>API: POST /api/guest/face-search/:slug (Selfie Buffer)
    API->>API: Check Face Search Rate Limiter (Max 10 / min / IP)
    API->>FaceWorker: Extract 128-D embedding from selfie (in-memory)
    FaceWorker-->>API: Return single 128-D Float32 vector
    API->>API: Immediately destroy/unlink temporary selfie (Privacy Invariant)
    API->>DB: SELECT embedding vectors WHERE event_id = :eventId
    DB-->>API: Return candidate embeddings for current event
    API->>API: Compute in-memory cosine similarities (SFace threshold >= 0.60)
    API->>DB: SELECT media details for matched photo IDs WHERE event_id = :eventId
    DB-->>API: Return matching photos
    API-->>Frontend: Render personalized photo stream (Photo IDs + match boxes)
    Frontend->>Storage: Stream preview WebP assets via CDN / Presigned URLs
    Storage-->>Guest: Instant high-speed image delivery
```

---

### 1.2 Photographer Upload & Asynchronous Processing Workflow
```mermaid
sequenceDiagram
    autonumber
    actor Photog as Authenticated Photographer
    participant API as Express API Server
    participant Storage as Cloudflare R2
    participant DB as Database (SQLite/Postgres)
    participant Queue as Dynamic Auto-Scaling Queue
    participant Sharp as Sharp Image Processing
    participant FaceAI as OpenCV YuNet + SFace

    Photog->>API: POST /api/media/upload/:eventId (Batch of 50-100 files)
    API->>API: Verify photographer JWT & active account status
    API->>API: Validate MIME magic bytes & sanitize filenames
    API->>DB: INSERT media records (status = 'uploaded')
    API->>Queue: createJob(eventId, mediaIds) -> status = 'pending'
    API-->>Photog: HTTP 200 OK (mediaIds, jobId, status: 'uploaded')
    Note over Photog,API: HTTP loop unblocked immediately!

    loop Queue Worker Loop (Dynamic Concurrency 2-8)
        Queue->>DB: Fetch pending media (Round-robin multi-event fair scheduling)
        DB-->>Queue: Return media items for processing
        Queue->>DB: UPDATE media SET status = 'processing'
        Queue->>Sharp: Generate 480px thumbnail & 1600px preview (WebP + Watermark)
        Sharp->>Storage: PUT previews & thumbnails to Cloudflare R2
        Storage-->>Queue: S3 ETag confirmed
        opt Face Search Enabled for Event
            Queue->>FaceAI: Detect faces & generate 128-D embeddings
            FaceAI-->>Queue: Detected bounding boxes & L2-normalized vectors
            Queue->>DB: INSERT INTO face_embeddings (event_id, photo_id, embedding)
        end
        Queue->>DB: UPDATE media SET status = 'ready', dimensions, EXIF
        Queue->>API: Unlink temporary upload file on disk (Guarantee in finally block)
        Queue->>DB: UPDATE processing_jobs SET progress, processed_items
    end
```

---

## 2. COMPONENT TOPOLOGY & RESOURCE BOUNDARIES

| Subsystem | Technology | Current Limits | Scalability Bottleneck |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | React 18, Vite, Vanilla CSS | Virtualization recommended for > 2,000 DOM nodes | Large galleries without pagination consume client DOM memory |
| **Backend API** | Node.js Express 4.x, Helmet | Single-process ~4,000 req/sec | Multi-table Cartesian `COUNT(DISTINCT)` joins in event listing |
| **Background Queue** | In-process Async Queue | Fixed 2-thread concurrency | Lack of dynamic scaling under batch upload surges; event starvation |
| **Image Processing** | Sharp (libvips) | ~40–80ms per 24MP image | Heavy simultaneous CPU usage if worker concurrency is unbounded |
| **Face Engine** | OpenCV YuNet + SFace | ~80ms per photo detection | Disk file serialization if candidate embeddings written to disk |
| **Database** | SQLite WAL / PostgreSQL pgvector | ~20,000 read queries/sec | Cartesian joins on multi-table `LEFT JOIN` aggregations |
| **Object Storage** | Cloudflare R2 | Unlimited egress, 1,000 ops/sec | Direct API proxying instead of signed URL / CDN delivery |

---

## 3. REALISTIC SCALE TARGETS

- **Photographers:** 500+ active single-photographer accounts.
- **Events:** 5,000+ total events with strict event-level isolation.
- **Photos:** 10,000–50,000 photos per large wedding/conference event.
- **Concurrent Guests:** 100 to 1,000 concurrent guests browsing and searching galleries.
- **Face Search Throughput:** 50 concurrent searches across multi-event containers with P95 latency < 100ms.

---

## 4. RECOMMENDED ARCHITECTURAL IMPROVEMENTS (PHASE 48)

1. **Subquery Query Aggregations:** Replace Cartesian `LEFT JOIN ... GROUP BY` with indexed correlated subqueries.
2. **Backwards-Compatible Gallery & Media Pagination:** Add `limit`, `page`, and `offset` query parameters to prevent monolithic multi-megabyte JSON payloads.
3. **Queue Dynamic Auto-Scaling (2 to 8 concurrency):** Adapt worker pool size dynamically based on queue depth backpressure.
4. **Fair Round-Robin Event Interleaving:** Prevent large uploads from Event A starving concurrent uploads from Event B.
5. **In-Memory Zero-Disk Vector Matching:** Compute 128-D cosine similarities directly in Node.js V8 memory, eliminating candidate disk file I/O.
6. **Tiered Rate Limiting:** Enforce strict limits on brute-force vectors and moderate limits on computationally heavy face searches.
