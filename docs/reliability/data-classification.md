# Data Classification & Resilience Policy

**Application:** Studio Lumina — Production Photography SaaS  
**Phase:** 37 (Backup, Disaster Recovery & Data Resilience)  
**Standard:** Enterprise Data Governance, NIST SP 800-88, GDPR/CCPA Biometric Minimization  

---

## 1. Overview & Classification Principles

Data in Studio Lumina is classified into four distinct operational tiers to establish clear recovery objectives, retention rules, and cost-effective backup architectures:

1. **Tier A — Critical Data:** Cannot be lost without irreparable harm to the business or photographer. Requires rigorous backup schedules, point-in-time recovery, and immediate restoration capability.
2. **Tier B — Large Object Data:** High-value primary customer media. Relies on Cloudflare R2 multi-datacenter durability (11 9's) and deterministic key mapping.
3. **Tier C — Temporary Data:** Ephemeral computational state and sensitive guest biometric inputs. **Strictly excluded** from long-term backups and destroyed upon request completion.
4. **Tier D — Regeneratable Data:** Derivative assets and machine learning embeddings that can be reconstructed deterministically from primary source data if destroyed.

---

## 2. Detailed Data Classification Matrix

| Data Tier | Category / Entities | Storage Engine | Loss Impact | RPO Target | Backup / Protection Mechanism |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier A (Critical)** | Photographer accounts, auth credentials, event metadata, ceremony folders, photo metadata, video metadata, event settings, PIN hashes, share tokens, storage tracking | PostgreSQL (Neon) / SQLite | **CRITICAL** (Loss of gallery configuration, customer orders, or access) | **< 1 hour** (Continuous WAL PITR) | Automated daily logical dump (`pg_dump` / JSON export) + Neon continuous WAL archiving (7-day PITR). |
| **Tier B (Large Object)** | Original client photographs, original 4K/1080p videos | Cloudflare R2 | **CRITICAL** (Loss of primary photographer source media) | **Near Zero** | Cloudflare R2 automatic multi-AZ erasure coding (11 9's durability). Two-stage Recycle Bin protection against accidental deletion. |
| **Tier C (Temporary)** | Guest face-search selfies, temporary guest embeddings, worker scratch files, temporary ZIP downloads | Server RAM / `/tmp` / Redis cache | **NONE** (Ephemeral request inputs) | **N/A** (Zero Retention) | **EXCLUDED FROM ALL BACKUPS.** Destroyed in `finally` execution blocks. Retention < 5 minutes. |
| **Tier D (Regeneratable)** | Image previews (2048px), thumbnails (400px), transcoded MP4 playback videos, poster frames, AI face embeddings (when originals exist) | Cloudflare R2 / PostgreSQL | **LOW to MODERATE** (Temporary degraded performance or search outage until re-indexed) | **N/A** (Can be rebuilt from originals) | Re-generated on demand via Sharp / FFmpeg / OpenCV pipelines from Tier B original media. |

---

## 3. Tier Deep-Dive & Retention Specifications

### 3.1 Tier A: Critical Application & Relational Data

- **Entities:**
  - `photographer`: Owner profile, bcrypt password hash, business details.
  - `events`: UUID, slug, client names, event date, location, visibility, public expiry timestamp, PIN hashes, watermark configurations.
  - `folders`: Ceremony groupings (e.g., *Haldi*, *Reception*, *Portraits*).
  - `media`: Dimensions, camera EXIF, MIME type, storage key references, upload timestamps.
  - `system_settings`: Studio branding, watermark defaults, storage configurations.
- **Integrity Rule:** All relational foreign keys must be strictly preserved during backup and restore. An event cannot exist without its photographer; a media item cannot exist without its event.

### 3.2 Tier B: Large Object Data (Primary Media)

- **Entities:**
  - `events/{eventId}/originals/{filename}`: Raw high-resolution photographer uploads (JPEG, PNG, WebP).
  - `events/{eventId}/videos/{filename}`: Raw high-resolution video recordings.
- **Durability Guarantee:** Cloudflare R2 stores objects across geographically distributed datacenters with automated erasure coding, designed for 99.999999999% (11 9's) annual object durability.
- **Accidental Deletion Protection:** Deleting an event in the application moves it to the **Recycle Bin** for 30 days. Media objects in R2 are NOT deleted until the photographer explicitly confirms permanent deletion after the grace period.

### 3.3 Tier C: Temporary & Biometric Data

- **Entities:**
  - Guest face-search selfies uploaded to `/api/events/:eventId/face-search`.
  - Ephemeral 128-D guest face vectors generated in RAM by Python SFace.
  - Ephemeral scratch files in `/temp` or `/tmp`.
  - Ephemeral guest session tokens (`guest_sessions`).
- **Privacy Standard:** Temporary guest selfies are sensitive biometric data under GDPR Article 9 and CCPA/CPRA. They **must never be written to persistent backup archives**. The backup engine explicitly filters out any transient tables or scratch directories.

### 3.4 Tier D: Regeneratable Derivatives & Embeddings

- **Derived Assets:**
  - `events/{eventId}/thumbnails/{filename}`: 400px WebP images generated via Sharp.
  - `events/{eventId}/previews/{filename}`: 2048px WebP images generated via Sharp.
  - `events/{eventId}/videos/{filename}_poster.jpg`: Video poster frames extracted via FFmpeg.
  - `face_embeddings`: 128-D floating-point vectors generated by OpenCV YuNet + SFace.
- **Recovery Pipeline:**
  If a catastrophic corruption affects derivatives or embeddings while Tier B originals remain intact:
  1. Trigger batch image pipeline: Sharp reads originals from R2 and outputs thumbnails/previews.
  2. Trigger batch AI indexing worker: YuNet detects faces and SFace re-generates 128-D vectors into `face_embeddings`.
  3. No customer data is permanently lost.

---

## 4. Disaster Recovery Retention Schedule

| Data Type | Active Retention | Recycle Bin Retention | Disaster Backup Retention | Deletion Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| Active Event Data | Unlimited (Owner managed) | N/A | 30 days rolling snapshots | Owner action |
| Soft-Deleted Events | N/A | 30 days | 30 days from snapshot date | Automated cron purge |
| Permanently Deleted Events | 0 seconds | 0 seconds | Retained in pre-existing snapshots until snapshot expires | Instant DB & R2 purge |
| Guest Biometric Selfies | 0 seconds (ephemeral) | N/A | **0 seconds (NEVER BACKED UP)** | Immediate `fs.unlinkSync` |
| Bulk ZIP Exports | 24 hours | N/A | Excluded from backups | Automated TTL cleanup |
