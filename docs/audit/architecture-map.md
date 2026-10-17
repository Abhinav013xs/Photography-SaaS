# Studio Lumina Architecture & Trust Boundary Map

**Phase:** 38 (Autonomous Full Codebase Audit, Vulnerability Hunt & Production Hardening)  
**Standard:** NIST SP 800-160 System Security Engineering, OWASP Threat Modeling Standard  
**Document Status:** Complete Architecture Topology  

---

## 1. System Topology Overview

Studio Lumina is structured into five distinct operational planes:
1. **Presentation Plane (Client SPA):** React 18, Vite, Lucide Icons, and Vanilla CSS with cinematic glassmorphism.
2. **Gateway & API Plane (Node.js/Express & TypeScript Apps):** Express 4 REST API handling authentication, authorization, event lifecycles, and media streaming.
3. **Data Plane (PostgreSQL & SQLite):** Neon PostgreSQL 16+ with `pgvector` for vector similarity searches, supplemented by SQLite for local development.
4. **Storage Plane (Cloudflare R2):** S3-compatible, multi-AZ object store for original media, previews, thumbnails, and transcoded videos.
5. **Inference Plane (Python AI Microservice):** FastAPI service hosting OpenCV YuNet (face detection) and SFace (128-D vector embeddings).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION PLANE (CLIENT)                     │
│   Photographer Dashboard (/dashboard)     Guest Gallery (/gallery/:slug)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS (Bearer JWT / x-guest-token)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  GATEWAY & API PLANE (EXPRESS / NODE.JS)               │
│   Rate Limiter ──► Helmet Headers ──► CORS Whitelist ──► Auth Guard    │
├──────────────────────┬──────────────────────┬──────────────────────────┤
│ Auth & Profile       │ Events & Lifecycle   │ Media & Streaming        │
│ /api/auth            │ /api/events          │ /api/media               │
├──────────────────────┴──────────────────────┴──────────────────────────┤
│ Guest Access: /api/guest (Metadata, PIN Session, Face Search)          │
│ Background Queues: BullMQ / In-Memory Worker Loop                      │
└───────────┬───────────────────────────┬──────────────────────────┬─────┘
            │ SQL Queries               │ S3 / R2 API              │ HTTP
            ▼                           ▼                          ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐
│      DATA PLANE      │  │    STORAGE PLANE     │  │  INFERENCE PLANE   │
│ Neon PostgreSQL 16+  │  │    Cloudflare R2     │  │ Python FastAPI     │
│  - pgvector (128-D)  │  │  - originals/        │  │  - OpenCV YuNet    │
│  - Events & Media    │  │  - previews/         │  │  - OpenCV SFace    │
│  - Face Embeddings   │  │  - thumbnails/       │  │  - 128-D Vectors   │
│  - Recycle Bin       │  │  - videos/           │  │ (Ephemeral in RAM) │
└──────────────────────┘  └──────────────────────┘  └────────────────────┘
```

---

## 2. Boundaries & Isolation Layers

### 2.1 Trust Boundary 1: Client to Gateway (External Boundary)
- **Untrusted Input Ingestion:**
  - Login credentials, PIN inputs, file uploads, selfie uploads, query parameters, URL slugs.
- **Enforced Security Controls:**
  - Rate limiting on login (5 attempts / 15m), PIN verification (5 attempts / 15m), and guest face search (10 requests / 1m).
  - Multer upload filters enforcing true binary magic bytes (JPEG, PNG, WebP, MP4) and rejecting dangerous double extensions (e.g. `exploit.php.jpg`).
  - Helmet security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
  - CORS whitelist strictly blocking unapproved cross-origin requests.

### 2.2 Trust Boundary 2: Gateway to Storage (Cloudflare R2 Boundary)
- **Access Protocol:** Controlled server-side S3 client via `@aws-sdk/client-s3`.
- **Enforced Security Controls:**
  - Zero browser exposure of `R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY`.
  - Deterministic key validation via `assertValidStorageKey(key)`: strictly enforces `events/{eventId}/{category}/{filename}`, preventing directory traversal (`..`, `\`, null bytes).
  - Controlled signed URL generation or server proxy streaming (`/api/media/stream?key=...`) with event authorization validation.

### 2.3 Trust Boundary 3: Gateway to Database (Relational & Vector Boundary)
- **Access Protocol:** Server-side connection pool (`pg.Pool` or `better-sqlite3`).
- **Enforced Security Controls:**
  - Parameterized queries across 100% of routes; zero dynamic SQL string concatenation.
  - Strict event isolation: All media and vector search queries enforce `WHERE event_id = :authenticated_event_id`.
  - Cascade constraints: Deleting an event cascades safely to folders, media, and embeddings.

### 2.4 Trust Boundary 4: Gateway to AI Microservice (Biometric Boundary)
- **Access Protocol:** Internal loopback HTTP (`127.0.0.1:8000`) or direct Python engine.
- **Enforced Security Controls:**
  - Microservice restricted to internal loopback callers; never exposed to public internet.
  - Zero guest biometric persistence: Guest selfies are converted to embeddings in RAM and immediately unlinked/destroyed upon query completion.
  - Image dimension ceilings: Enforced maximum of 50 megapixels (`MAX_IMAGE_PIXELS = 50_000_000`) to prevent memory exhaustion decompression bombs.

---

## 3. Data Entry Points & Validation Matrix

| Entry Point | Protocol / Route | Ingested Data Types | Validation & Sanitization Applied |
| :--- | :--- | :--- | :--- |
| **Photographer Login** | `POST /api/auth/login` | Email, password string | Lowercase trimming, constant-time dummy bcrypt hashing on non-existent accounts, IP rate limiting. |
| **Event Creation / Edit** | `POST /api/events`, `PUT /api/events/:id` | Name, dates, PIN, visibility, watermark settings | String sanitization, bcrypt hashing on PINs, public duration clamped to 1-30 days. |
| **Media Upload** | `POST /api/media/upload/:eventId` | Multipart file streams | Magic byte validation (`FF D8 FF`, `89 50 4E 47`, etc.), safe filename validation, Sharp 50MP limits. |
| **Media Move** | `PUT /api/media/move` | `mediaIds` array, `targetFolderId` | Batch size capped at 500, target folder validated to exist and match media event container. |
| **Guest PIN Verification** | `POST /api/guest/verify-pin/:slug` | 4-8 digit PIN code | Regex `/^\d{4,8}$/`, bcrypt comparison, failed attempt lockout (5 in 15m), ephemeral 12h JWT token. |
| **Guest Face Search** | `POST /api/guest/face-search/:slug` | Selfie image buffer | Rate limiting (10/min), single-face verification in RAM, immediate scratch deletion in `finally`. |
| **Media Download** | `GET /api/media/download/:mediaId` | Media UUID | Active status check, public visibility check, non-expired window check, PIN verification check. |
