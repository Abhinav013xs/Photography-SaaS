# Biometric Privacy & Data Flow Specification

**System:** Studio Lumina Photography Platform  
**Document Classification:** Biometric Privacy Architecture  
**Author:** Principal Privacy Engineer & Biometric Security Specialist  
**Standards Compliance:** GDPR Article 9 (Special Category Data), BIPA, CCPA/CPRA  
**Date:** October 16, 2026  

---

## 1. Biometric Data Flow Architectures

The platform strictly differentiates between two completely distinct classes of biometric data:
1. **Guest Selfies (Temporary / Ephemeral):** Submitted solely to find photos of oneself at a specific event.
2. **Photographer Event Photos (Persistent / Controlled):** High-resolution photographs containing event attendees.

```
==========================================================================================
FLOW 1: EPHEMERAL GUEST SELFIE WORKFLOW (ZERO-RETENTION BIOMETRIC SEARCH)
==========================================================================================

   [ GUEST MOBILE DEVICE ]
             |
             | 1. Capture Live Camera Selfie (Base64 JPEG)
             v
   [ INGRESS API GATEWAY ]
             |
             | 2. In-Memory Validation (Magic bytes, < 10MB, max 4096x4096)
             |    *BUFFER NEVER WRITTEN TO DISK OR DATABASE*
             v
   [ TRANSIENT RAM BUFFER ]
             |
             | 3. Out-of-Process Inference Call to Python AI Microservice
             v
   [ PYTHON YUNET + SFACE ]
             |
             | 4. YuNet Detects Face (Enforces EXACTLY ONE face)
             | 5. SFace Extracts 128-D Unit-Normalized Vector Embedding
             | 6. SFace Embedding returned via secure local loopback
             v
   [ PGVECTOR EVENT QUERY ]
             |
             | 7. Cosine Distance Query strictly scoped:
             |    SELECT media_id, MIN(embedding <=> :query_vec)
             |    WHERE event_id = :current_event_id AND status = 'ready'
             v
   [ IN-MEMORY CLEANUP ]
             |
             | 8. Query vector immediately dereferenced in finally block
             | 9. Selfie RAM buffer released for garbage collection
             v
   [ MATCH RESULT TO GUEST ]
   Returns: Array of { mediaId, filename, thumbnailDownloadUrl, matchScore }
   *RAW EMBEDDINGS AND SELFIE IMAGES ARE NEVER STORED OR RETURNED*
```

```
==========================================================================================
FLOW 2: PHOTOGRAPHER EVENT PHOTO EMBEDDING WORKFLOW (CONTROLLED LIFECYCLE)
==========================================================================================

   [ PHOTOGRAPHER UPLOAD ]
             |
             | 1. High-Resolution Batch Uploaded to Cloudflare R2
             v
   [ CLOUDFLARE R2 ]
             |
             | 2. Media record created: status = 'uploaded'
             v
   [ REDIS PRIORITY QUEUE ]
             |
             | 3. Enqueued to photo-processing queue
             v
   [ AI WORKER PIPELINE ]
             |
             | 4. YuNet detects all attendee faces in single & group photos
             | 5. SFace computes 128-D vector for each detected face
             v
   [ NEON POSTGRESQL (PGVECTOR) ]
             |
             | 6. INSERT INTO face_embeddings (id, event_id, photo_id, embedding, bbox)
             |    Strictly linked to event_id and photo_id foreign keys
             v
   [ PERMANENT DELETION CASCADE ]
             |
             | 7. If Photo Deleted: Cascade DELETE FROM face_embeddings WHERE photo_id = :id
             | 8. If Event Purged: Cascade DELETE FROM face_embeddings WHERE event_id = :id
             |    *ZERO ORPHAN BIOMETRIC VECTORS PERMITTED*
```

---

## 2. Failure Scenarios & Zero-Retention Proof

| Failure Scenario | System State During Failure | Verification of Biometric Zero-Retention |
| :--- | :--- | :--- |
| **Guest Abandons Search** | Client disconnects before response sent | Ephemeral buffer is scoped locally to request handler; Node.js V8 garbage collector frees memory immediately. Zero disk/DB writes. |
| **AI Worker Crash (SIGSEGV/OOM)**| Python worker crashes during inference | Memory socket closed; Express catch block handles error; scratch buffer cleaned in `finally` block. |
| **Event Deleted During Search** | Event transitions to `deleting` soft-lock | `faceSearchService.ts` checks event status prior to and after inference; query aborts immediately. |
| **Event Expiration During Search**| Event public window elapses | Real-time check in `isEventExpired()` rejects query with `HTTP 410 Gallery Expired`. |
| **Database Transaction Failure** | PostgreSQL drops connection | Search returns HTTP 503; zero query vectors are stored. |
| **Repeated / Flood Searches** | Attacker scripts 1,000 selfie searches | Sliding-window rate-limiter rejects after 10 searches/min with HTTP 429; no biometric build-up. |

---

## 3. Data Minimization & Retention Table

The platform enforces strict data minimization: every stored field must have an explicit business and legal necessity.

| Data Category | Field Name | Purpose / Justification | Retention Limit | Destruction Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **Guest Selfie** | In-Memory Image Buffer | Immediate face detection | **0 Seconds (RAM only)** | Immediate dereferencing in `finally` block |
| **Query Embedding**| 128-D Float Vector | Cosine distance evaluation | **Transient (< 400ms)** | Never persisted; freed after query execution |
| **Photo Face Embedding**| `face_embeddings.embedding`| Enables guest "Find My Photos" | **Event Lifecycle** | Hard cascade delete upon photo/event purge |
| **Face Bounding Box**| `face_embeddings.bbox` | Bounding box for crop thumbnail | **Event Lifecycle** | Hard cascade delete upon photo/event purge |
| **Guest Session** | `guest_sessions` table | Rate limiting and PIN sessions | **15 Minutes to 24 Hours** | Automated cron cleanup |
| **Public Gallery**| `events.public_until` | Enforce 30-day viewing window | **Max 30 Days Public** | Auto-transition to `private` after 30 days |
| **Recycle Bin Event**| `events.status = 'trashed'` | Accidental deletion grace window | **30 Days in Trash** | Automated cron permanent purge |
| **Application Logs** | Structured JSON logs | Operational security & debugging | **30 Days** | Automated log rotation & truncation |

---

## 4. Biometric Regulatory Compliance Certification

1. **GDPR Article 9 (Special Category Data):**
   - Guest facial data is processed strictly with explicit consent (user actively uploads or captures selfie to search).
   - Zero retention ensures data is erased immediately following the singular execution of the requested search service.
2. **Illinois Biometric Information Privacy Act (BIPA):**
   - The platform never persits, sells, leases, or trades biometric identifiers.
   - Permanent photographer-managed face embeddings are destroyed upon client gallery deletion without residual copies.
