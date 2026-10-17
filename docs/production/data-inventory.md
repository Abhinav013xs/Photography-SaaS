# Studio Lumina Photography SaaS — Production Data Inventory & Retention Matrix

**Standard:** GDPR (Art. 5, Art. 9, Art. 17), BIPA, CCPA / CPRA  
**Document Version:** 1.0.0  
**Classification:** Internal Production Governance Document  

---

## 1. Data Classification Hierarchy

- **Level 1 — Public:** Publicly accessible when gallery is active (event name, date, photographer studio name, public watermarked photos).
- **Level 2 — Internal:** System telemetry, anonymous diagnostic counts, performance timers.
- **Level 3 — Private:** Non-biometric private data, photographer email, client contact info, event PIN hashes, unwatermarked master photos.
- **Level 4 — Highly Sensitive (Biometrics & Credentials):** Raw guest selfies, facial vector embeddings (128-D), photographer password hashes, R2 private credentials.

---

## 2. Production Data Inventory Matrix

| Data Entity | Physical Location | Purpose | Legal / Data Owner | Retention Period | Deletion / Destruction Mechanism | Sensitivity Level |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **Photographer Account** | Neon PostgreSQL (`photographer` table) | Authentication & studio profile management | Sole Photographer | Lifetime of account | Explicit account reset or database wipe | `Level 4` (Password Hash: `Level 4`, Bio: `Level 1`) |
| **Event Records** | Neon PostgreSQL (`events` table) | Event container, gallery settings, PIN hashes | Photographer & Event Client | Active + 30 days in Recycle Bin | Soft-delete `deleted_at`, purged after 30 days via scheduled cleanup | `Level 3` |
| **Master Photos** | Cloudflare R2 (`events/{id}/originals/`) | Client photo delivery and high-res downloads | Photographer | Up to event deletion | Deleted via S3 API `DeleteObjectsCommand` when event is permanently deleted | `Level 3` |
| **Preview Derivatives** | Cloudflare R2 (`events/{id}/previews/`) | High-speed responsive web gallery display | Photographer | Synchronized with master photo | Cleaned up with master photo | `Level 1` (When public) / `Level 3` (When private) |
| **Thumbnails** | Cloudflare R2 (`events/{id}/thumbnails/`) | Masonry grid fast navigation | Photographer | Synchronized with master photo | Cleaned up with master photo | `Level 1` (When public) / `Level 3` (When private) |
| **Video Files** | Cloudflare R2 (`events/{id}/videos/`) | Event video streaming and download | Photographer | Synchronized with event lifecycle | Cleaned up with event deletion | `Level 3` |
| **Media Metadata (EXIF)**| Neon PostgreSQL (`media` table) | Camera make, model, aperture, shutter, focal length | Photographer | Lifetime of media record | Cascades on `media` row deletion (`ON DELETE CASCADE`) | `Level 2` |
| **Permanent Face Embeddings** | Neon PostgreSQL (`face_embeddings` table) | 128-D vector indexing for guest similarity matching | Photographer | Lifetime of photo or event | Cascades automatically when photo or event is deleted | `Level 4` (Biometric Vector) |
| **Temporary Guest Selfies** | Ephemeral RAM only (`Buffer` / Python microservice) | Face detection and vector generation for query | Guest | **0 seconds (Immediate destruction in `finally` block)** | In-memory buffer unreferenced and collected by GC; zero disk/R2 writes | `Level 4` (Ephemeral Biometric) |
| **Temporary Query Embeddings** | Ephemeral RAM only (Node.js query parameter) | Distance comparison in pgvector query | Guest | **0 seconds (Released post-query)** | In-memory variable discarded immediately after query completion | `Level 4` (Ephemeral Biometric) |
| **Guest PIN Session Tokens** | JWT in Client Session Storage / Memory | Temporary read access to PIN-protected gallery | Guest | Max 24 hours | Expires automatically via JWT `exp` claim | `Level 3` |
| **Structured API Logs** | Node.js stdout / Docker log collector | Observability, health monitoring, security debugging | Platform Infrastructure | 14 days | Rotated and truncated via Docker log max-size (10MB, max 3 files) | `Level 2` (Deeply sanitized; secrets redacted) |
| **Database Backups** | Encrypted Cloud Storage (`backups/`) | Disaster recovery and business continuity | Sole Photographer | 30 daily snapshots, 12 monthly snapshots | Automated lifecycle deletion policy in backup bucket | `Level 4` (AES-256-GCM encrypted) |

---

## 3. Strict Biometric Data Lifecycle Guarantees

```
+---------------------------------------------------------------------------------+
|                       GUEST SELFIE LIFECYCLE (ZERO RETENTION)                   |
|                                                                                 |
| 1. Live Capture  -->  2. In-Memory Transfer  -->  3. Local Python Embedding     |
|    (Browser RAM)      (HTTPS POST Payload)        (YuNet + SFace in RAM)        |
|                              |                               |                  |
|                              |                               v                  |
|                              |                     4. pgvector Search (RAM)     |
|                              |                               |                  |
|                              v                               v                  |
|                      =====================================================      |
|                      GARBAGE COLLECTION: Buffers destroyed, Vectors deleted     |
|                      ZERO PERSISTENCE: 0 bytes written to disk, DB, or R2       |
|                      =====================================================      |
+---------------------------------------------------------------------------------+
```

### 3.1 Regulatory Compliance Mapping:
- **GDPR Art. 9 (Special Category Data):** Processing is transient, consent-driven via explicit user action ("Find My Photos"), with zero biometric retention.
- **Illinois BIPA (740 ILCS 14/):** The platform does not store biometric identifiers or information from guests. No biometric database of guest faces is created or maintained.
- **GDPR Art. 17 (Right to Erasure):** Photographer deletion of a photo or event triggers clean cascaded deletion of all associated 128-D face embeddings in Neon PostgreSQL and all media derivatives in Cloudflare R2.
