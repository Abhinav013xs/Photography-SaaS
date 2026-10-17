# Studio Lumina API Security Matrix

**Phase:** 38 (Autonomous Full Codebase Audit, Vulnerability Hunt & Production Hardening)  
**Standard:** OWASP API Security Top 10 (2023 Edition)  
**Audit Scope:** 100% of Exposed Application REST Endpoints  

---

## 1. Exhaustive API Endpoint Security Evaluation

| Endpoint | Method | Authentication | Authorization Scope | Input Validation | Rate Limit | Sensitive Data Returned | Risk Level | Hardening Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/login` | `POST` | None (Public) | None | Email format, non-empty password | 5 attempts / 15m (IP lockout) | JWT Bearer Token | Low | **SECURE** (Constant-time dummy bcrypt comparison) |
| `/api/auth/me` | `GET` | Bearer JWT | Photographer Owner | None | Global | Email, studio profile (hashes omitted) | Low | **SECURE** |
| `/api/auth/profile` | `PUT` | Bearer JWT | Photographer Owner | Min 8-char password, bcrypt verification | Global | Profile metadata | Low | **SECURE** |
| `/api/events` | `GET` | Bearer JWT | Photographer Owner | Query params (status, search, sort) | Global | Event list, metrics (hashes omitted) | Low | **SECURE** (Parameterized SQL) |
| `/api/events` | `POST` | Bearer JWT | Photographer Owner | Date, name, client name required | Global | Created event object | Low | **SECURE** |
| `/api/events/bin` | `GET` | Bearer JWT | Photographer Owner | None | Global | Soft-deleted events | Low | **SECURE** |
| `/api/events/bin/empty` | `POST` | Bearer JWT | Photographer Owner | None | Global | Purge summary | Low | **SECURE** |
| `/api/events/:id` | `GET` | Bearer JWT | Photographer Owner | UUID parameter | Global | Full event metadata | Low | **SECURE** |
| `/api/events/:id` | `PUT` | Bearer JWT | Photographer Owner | Duration clamped 1-30, PIN hashed | Global | Updated event metadata | Low | **SECURE** |
| `/api/events/:id/visibility` | `PATCH` | Bearer JWT | Photographer Owner | 'public' \| 'private' enum | Global | Updated visibility state | Low | **SECURE** |
| `/api/events/:id/publish` | `POST` | Bearer JWT | Photographer Owner | Duration clamped 1-30 | Global | Published event state | Low | **SECURE** |
| `/api/events/:id/unpublish` | `POST` | Bearer JWT | Photographer Owner | None | Global | Unpublished event state | Low | **SECURE** |
| `/api/events/:id/archive` | `POST` | Bearer JWT | Photographer Owner | None | Global | Status response | Low | **SECURE** |
| `/api/events/:id/unarchive` | `POST` | Bearer JWT | Photographer Owner | None | Global | Status response | Low | **SECURE** |
| `/api/events/:id/trash` | `POST` | Bearer JWT | Photographer Owner | None | Global | Recycle bin confirmation | Low | **SECURE** |
| `/api/events/:id/restore` | `POST` | Bearer JWT | Photographer Owner | None | Global | Restoration confirmation | Low | **SECURE** |
| `/api/events/:id/permanent` | `DELETE` | Bearer JWT | Photographer Owner | None | Global | Purge confirmation | Medium | **SECURE** (Storage & DB cascade) |
| `/api/events/:id` | `DELETE` | Bearer JWT | Photographer Owner | None | Global | Purge confirmation | Medium | **SECURE** (Storage & DB cascade) |
| `/api/events/:id/qr` | `GET` | Bearer JWT | Photographer Owner | None | Global | PNG DataURL, SVG (PIN omitted) | Low | **SECURE** |
| `/api/events/:id/folders` | `GET` | Bearer JWT | Photographer Owner | Event UUID | Global | Folder list | Low | **SECURE** |
| `/api/events/:id/folders` | `POST` | Bearer JWT | Photographer Owner | Folder name non-empty | Global | Created folder | Low | **SECURE** |
| `/api/events/:id/folders/:folderId` | `PUT` | Bearer JWT | Photographer Owner | Folder name, sort order | Global | Updated folder | High | **HARDENED** (Enforces `WHERE event_id = :id`) |
| `/api/events/:id/folders/:folderId` | `DELETE` | Bearer JWT | Photographer Owner | Target folder UUID | Global | Deletion confirmation | High | **HARDENED** (Verifies target folder belongs to `:id`) |
| `/api/media/stream` | `GET` | Bearer JWT / Guest Token | Event Scoped | Storage key format assertion | Global | Raw image / video bytes | High | **SECURE** (Path traversal blocked, expiry checked) |
| `/api/media/event/:eventId` | `GET` | Bearer JWT | Photographer Owner | Event UUID, folderId, type | Global | Media list with EXIF | Low | **SECURE** |
| `/api/media/upload/:eventId` | `POST` | Bearer JWT | Photographer Owner | Magic bytes, safe filename, 50MP | Global | Upload confirmation & jobId | High | **SECURE** (Decompression & shell defense) |
| `/api/media/move` | `PUT` | Bearer JWT | Photographer Owner | Max 500 items, target folder UUID | Global | Move count | High | **HARDENED** (Cross-event target folder blocked) |
| `/api/media/batch` | `DELETE` | Bearer JWT | Photographer Owner | Max 500 items | Global | Deleted count | Medium | **HARDENED** (Capped batch size at 500) |
| `/api/media/download/:mediaId` | `GET` | Bearer JWT / Guest Token | Event Scoped | Media UUID | Global | Original binary download | High | **SECURE** (Visibility, PIN, expiry, toggles checked) |
| `/api/media/download-zip/:eventId` | `POST` | Bearer JWT / Guest Token | Event Scoped | Event UUID, mediaIds array | Global | Streamed ZIP archive | High | **SECURE** (Scoped to event media, auth checked) |
| `/api/guest/event/:slug` | `GET` | None (Public) | Public Active Only | URL slug | Global | Safe event metadata (no hashes) | Low | **SECURE** (Fails closed on private/expired) |
| `/api/guest/verify-pin/:slug` | `POST` | None (Public) | Event Scoped | 4-8 numeric digits | 5 attempts / 15m (IP lockout) | Ephemeral Guest JWT | Medium | **SECURE** (Bcrypt check, fails closed if unconfigured) |
| `/api/guest/session/clear/:eventId` | `POST` | None (Public) | Event Scoped | Event UUID | Global | Cookie clearance | Low | **SECURE** |
| `/api/guest/gallery/:slug` | `GET` | Guest Token / Public | Event Scoped | URL slug | Global | Media thumbnails/previews | Medium | **SECURE** (verifyGuestAccess guard) |
| `/api/guest/face-search/:slug` | `POST` | Guest Token / Public | Event Scoped | Selfie multipart stream | 10 searches / 1m (IP lockout) | Matched photo list & scores | High | **HARDENED** (Rate limited, ephemeral zero-retention) |
| `/api/storage/overview` | `GET` | Bearer JWT | Photographer Owner | None | Global | Storage bytes & truncated ID | Low | **SECURE** (Zero quota fakes, secrets omitted) |
| `/api/health` | `GET` | None (Public) | Public | None | Global | Health status | Low | **SECURE** |
