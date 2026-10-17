# Biometric Privacy & Zero-Retention Architecture Specification

**Status:** APPROVED FOR PRODUCTION & CONTROLLED PILOT  
**Document Revision:** 1.0.0  
**Phase:** 34 — Face Recognition Accuracy, Event Isolation & Biometric Privacy Validation  
**Target Architecture:** Python/FastAPI (`apps/ai`), Node.js/Express (`apps/api`), Neon PostgreSQL (`pgvector`), Cloudflare R2  

---

## 1. Executive Summary & Privacy Principles

The platform is architected around strict privacy-by-design principles for guest face recognition. Unlike conventional photo tagging or biometric surveillance systems:
1. **Zero Guest Biometric Retention:** Guest query selfies and query embeddings are **never** persisted to persistent storage (no disk, no database, no object storage, no backups).
2. **Ephemeral In-Memory Processing:** Processing occurs exclusively in volatile RAM during the active HTTP request lifecycle. Once the similarity search completes or aborts, all allocated memory buffers are freed.
3. **No Guest Profiles:** Guests have zero accounts, zero persistent identifiers, and zero tracking cookies. The system cannot track a guest across events or construct an individual identity timeline.
4. **Strict Event Isolation:** Face vector searches strictly enforce SQL `WHERE event_id = :current_event_id`. Cross-event leakage is prevented at both the database query layer and the API authorization layer.
5. **Regulatory Alignment:** Engineered to comply with global biometric privacy frameworks, including:
   - **GDPR Article 9** (Processing of Special Categories of Personal Data — transient execution on explicit user action, zero retention, no secondary profiling).
   - **Illinois Biometric Information Privacy Act (BIPA, 740 ILCS 14/)** (Zero capture or storage of guest biometric identifiers without persistent retention; instantaneous destruction).
   - **California Consumer Privacy Act / CPRA** (Biometric data not sold, shared, or retained beyond the immediate service request).

---

## 2. End-to-End Guest Selfie Lifecycle

The complete lifecycle of a guest query image is traced through 10 deterministic steps:

```
[Guest Mobile Browser]
      │
      ▼ (1) Camera capture / file select (in-memory Blob)
      │ (2) Base64 Data URL conversion in JavaScript RAM
      │
      ├─── HTTPS POST /api/guest/events/:id/face-search (JSON payload)
      │
[Node.js API Gateway (apps/api)]
      │ (3) Event authorization & status check (Active, Not Expired, Not Deleted)
      │ (4) Rate limit check (e.g., 10 req/min per IP)
      │ (5) Forward in-memory JSON payload to AI service via private network / loopback
      │
[Python AI Microservice (apps/ai)]
      │ (6) Decode base64 string to numpy.ndarray in RAM (cv2.imdecode)
      │ (7) Face Detection (YuNet) & Feature Extraction (SFace) in RAM
      │ (8) Produce 128-D L2-normalized float32 embedding vector
      │ (9) Return vector to Node.js in HTTP response body
      │     * Python triggers garbage collection / buffer deallocation
      │
[Node.js API Gateway (apps/api)]
      │ (10) Execute pgvector similarity query:
      │      SELECT photo_id, 1 - (embedding <=> $1::vector) AS score
      │      FROM face_embeddings fe
      │      JOIN photos p ON p.id = fe.photo_id
      │      WHERE fe.event_id = $2
      │        AND p.deleted_at IS NULL
      │        AND (1 - (embedding <=> $1::vector)) >= $3
      │      ORDER BY score DESC LIMIT $4
      │
      ▼ Return authorized photo metadata array (IDs, preview URLs) to Guest
        * Memory holding query vector is garbage-collected.
```

---

## 3. Storage Audit: Verification of Zero Retention

### 3.1 Cloudflare R2 Object Storage
- **Finding:** Photographers' uploaded event photos are stored deterministically under:
  - `events/{event_id}/originals/{filename}`
  - `events/{event_id}/previews/{filename}`
  - `events/{event_id}/thumbnails/{filename}`
- **Selfie Audit:** At no point during the guest face-search request is any Cloudflare R2 `PutObject` or multipart upload call invoked.
- **Verification:** Source code audit of `apps/api/src/routes/guest.ts`, `apps/api/src/services/faceSearch.ts`, and `apps/ai/app.py` confirmed 0 S3/R2 client calls on guest search paths.

### 3.2 Neon PostgreSQL Database
- **Schema Audit:** The `face_embeddings` table schema is strictly event-photo bound:
  ```sql
  CREATE TABLE face_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      face_index INTEGER NOT NULL,
      bounding_box JSONB NOT NULL,
      confidence REAL NOT NULL,
      embedding vector(128) NOT NULL,
      model_version VARCHAR(32) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
- **Selfie Audit:** No guest query vectors, guest biometric signatures, or guest selfies are ever written to `face_embeddings` or any other database table.
- **Verification:** Integration tests (`tests/integration/face_recognition_validation.test.ts`) assert that `face_embeddings` record count before and after 100 guest searches remains identical.

### 3.3 File System & Local Scratch Disk
- **Audit:** The Python microservice uses `cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)` exclusively in volatile RAM.
- **Temporary Files:** No temporary files (`/tmp`, `tempfile.NamedTemporaryFile`) are created on disk.
- **Operating System Memory:** In Linux/Windows container environments, process memory is reclaimed by the OS upon variable dereferencing and process lifecycle termination.

---

## 4. Biometric Data Protection in Logs & Observability

### 4.1 Log Redaction Rules
To prevent accidental leakage of biometric material into log aggregators (e.g., Datadog, CloudWatch, Papertrail):
1. **Request Body Redaction:** Morgan/Winston/FastAPI request loggers redact the `image` field in `POST /face-search`. The log output records only:
   ```json
   {"method": "POST", "path": "/api/guest/events/.../face-search", "content_length": 451204, "status": 200}
   ```
2. **Embedding Redaction:** Raw 128-dimensional floating point vectors are never printed to `stdout` or `stderr`. Logging statements capture only aggregate diagnostics (e.g., `faces_detected=1`, `inference_ms=284`, `match_count=8`).
3. **Error Reporting:** Stack traces generated during unhandled exceptions strip binary payloads and multipart boundaries before logging.

### 4.2 Error Masking
- When a search fails because no face is detected or multiple faces are detected, the API returns a generic domain error code (`NO_FACE_DETECTED`, `MULTIPLE_FACES_DETECTED`) with a helpful UX message. It does not output raw coordinate tensors or facial landmark points.

---

## 5. Denial-of-Service & Input Attack Mitigations

Biometric processing endpoints are computationally intensive and must be defended against resource exhaustion attacks:

| Threat Vector | Mitigation Strategy | Implementation Details |
| :--- | :--- | :--- |
| **Oversized Uploads (ZIP bombs / high-res files)** | Strict payload size limit | Body parser capped at 10 MB (`express.raw` / `express.json` limit: `10mb`). Images exceeding 10MB are rejected at gateway with HTTP 413. |
| **Decompression Bombs (Pixel floods)** | Maximum resolution clamping | Python `apps/ai` decodes image shape and rejects images exceeding 50 megapixels or downscales exceeding 1920x1080 before inference. |
| **API Brute-Force / Abuse** | Strict IP Rate Limiting | `express-rate-limit` enforces max 15 face searches per minute per IP address. |
| **Invalid Mime Types / Corrupt Data** | Pre-inference validation | Magic byte inspection validates JPEG/PNG headers; `cv2.imdecode` returning `None` immediately terminates request with HTTP 400 (`INVALID_IMAGE`). |
| **Model Thread Starvation** | Inference timeout | FastAPI request handler wrapped in an asynchronous 5.0s timeout to prevent thread hangs on malicious inputs. |

---

## 6. Client-Side Biometric Hygiene

The guest user interface (`client/src/components/FaceSearchModal.jsx`) implements strict client-side data hygiene:
1. **Ephemeral State:** When the user captures a selfie via webcam or file picker, the image resides only in the React component's local state.
2. **Immediate Cleanup on Close:** Closing the modal, navigating away, or completing a search resets the file input and releases the canvas context:
   ```javascript
   const handleClose = () => {
     setSelfie(null);
     setPreviewUrl(null);
     setResults([]);
     onClose();
   };
   ```
3. **No LocalStorage or SessionStorage:** Biometric images and base64 strings are never written to `localStorage`, `sessionStorage`, or IndexedDB.
4. **No Third-Party Analytics Transmission:** Google Analytics, PostHog, or Sentry tracking scripts are strictly prohibited from recording input file blobs or canvas elements.

---

## 7. Compliance Verification Checklist

- [x] **Zero persistent selfie storage** verified in Cloudflare R2.
- [x] **Zero persistent selfie storage** verified in Neon PostgreSQL.
- [x] **Zero persistent selfie storage** verified on host filesystem.
- [x] **Query embeddings excluded** from `face_embeddings` table index.
- [x] **Biometric payloads omitted** from all application logs.
- [x] **Event-scoped isolation (`WHERE event_id = :id`)** strictly enforced at SQL level.
- [x] **Deleted and expired galleries inaccessible** to face search.
- [x] **Client-side state wiped** upon modal dismissal.
- [x] **Plain-language privacy disclosure** displayed to guests before selfie capture.
