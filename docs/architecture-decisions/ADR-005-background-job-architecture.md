# ADR-005: Background Job & Queue Architecture

## Status
Accepted

## Context
Professional photographers routinely upload batches of 1,000 to 5,000+ RAW/JPEG photos per wedding or commercial event. Processing these photos involves Sharp image resizing, color profile extraction, watermark composition, neural face detection, and vector embedding generation. These workloads must never block HTTP web requests, and heavy upload queues must never delay an interactive guest performing a face search.

## Decision
We select **Redis + BullMQ** as the background job and message broker engine:

### 1. Dedicated Queue Partitioning & Priorities
To prevent head-of-line blocking, background workloads are partitioned into isolated queues with explicit concurrency and priority rules:

| Queue Name | Responsibilities | Concurrency | Priority | Retry Strategy |
| :--- | :--- | :--- | :--- | :--- |
| `queue:photo-processing` | Sharp thumbnail/preview generation & EXIF parsing | 4 workers | Normal (5) | 3 retries, exponential backoff (2s, 8s, 30s) |
| `queue:face-indexing` | Python AI service face detection & embedding extraction | 2 workers | Normal (5) | 2 retries, linear backoff |
| `queue:video-processing` | Video poster extraction & metadata parsing | 1 worker | Low (1) | 2 retries |
| `queue:zip-generation` | Bulk client photo ZIP packaging | 2 workers | High (10) | 1 retry (fail fast with user notification) |
| `queue:gallery-expiry` | Automated 30-day public window enforcement sweep | 1 worker | Periodic | Cron: every 15 minutes |
| `queue:maintenance` | R2 orphan object cleanup & storage reconciliation | 1 worker | Low (1) | Cron: daily at 03:00 UTC |

### 2. Interactive Search Isolation Guarantee
Guest **"Find My Photos"** face searches bypass background job queues entirely. When a guest submits a selfie:
1. The API server routes the ephemeral selfie image directly to the running Python AI Service via low-latency local HTTP/socket.
2. The Python service extracts the 128-D vector in ~80ms.
3. PostgreSQL queries the HNSW index filtered by `event_id` in ~15ms.
4. Total round-trip latency is < 250ms, completely unaffected by whether 5,000 photos are currently queued in `queue:photo-processing`.

```mermaid
graph TD
    subgraph Heavy_Background_Workloads["Heavy Upload Workloads (Asynchronous)"]
        BatchUpload["Photographer Uploads 5,000 Photos"] --> BullMQ["BullMQ Worker Queue"]
        BullMQ --> Q1["queue:photo-processing (Sharp)"]
        BullMQ --> Q2["queue:face-indexing (Python AI)"]
    end

    subgraph Interactive_Guest_Requests["Interactive Guest Face Search (Real-Time)"]
        GuestSelfie["Guest Submits Selfie"] --> FastAPI["API Server"]
        FastAPI -->|Direct Local Socket (<80ms)| PythonService["Python AI Service"]
        PythonService -->|Selfie 128D Vector| FastAPI
        FastAPI -->|HNSW Vector Query (<15ms)| PG[("PostgreSQL pgvector")]
        PG -->|Matching Photos| GuestResult["Instant Guest Results (<250ms)"]
    end
```

### 3. Job State Persistence
Job progress is mirrored from BullMQ into the relational `processing_jobs` table:
- Provides the photographer dashboard with live progress meters (`processed_items` / `total_items`, percentage completed).
- Persists error diagnostics if any specific media file fails processing.

## Alternatives Considered
- **In-Memory JavaScript SetTimeout / Microtask Queue:** Rejected. In-memory queues drop uncompleted jobs on server restart or crash, lack concurrency throttling, and cause catastrophic memory exhaustion when processing thousands of high-resolution images.
- **RabbitMQ / Kafka:** Rejected. Excessive operational complexity for a single-owner application. Redis is lightweight, fast, and already standard for caching and rate limiting.

## Consequences
- **Positive:** Rock-solid reliability; crash resilience; zero impact on interactive guest face searches; clear progress visibility for photographer uploads.
- **Negative:** Requires running a Redis instance alongside PostgreSQL.
